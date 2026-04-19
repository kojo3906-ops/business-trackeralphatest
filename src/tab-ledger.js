/**
 * tab-ledger.js — Ledger tab
 * Full transaction log, filterable by entity, currency, category, date.
 */

import { getChatState, addLedgerEntry } from './store.js';
import { el, clearEl, uuid, isoNow, formatDate, formatAmount, truncate } from './utils.js';

const CATEGORIES = ['salary','contract','purchase','sale','bribe','gift','debt','repayment','fine','other'];

export function renderLedger(container) {
    clearEl(container);

    const state = getChatState();

    // ── Toolbar ──
    const toolbar = el('div', { class: 'bt-toolbar' });
    const addBtn = el('button', { class: 'bt-btn bt-btn-primary' }, '+ Add Entry');
    addBtn.addEventListener('click', () => openLedgerEditor(null, container));
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    // ── Filters ──
    const filters = buildFilters(state, () => renderLedgerTable(state, tableContainer, getFilters()));
    container.appendChild(filters);

    // ── Table ──
    const tableContainer = el('div', { class: 'bt-ledger-table-wrap' });
    container.appendChild(tableContainer);

    function getFilters() {
        return {
            entityId: filters.querySelector('[data-filter="entity"]')?.value ?? '',
            currencyId: filters.querySelector('[data-filter="currency"]')?.value ?? '',
            category: filters.querySelector('[data-filter="category"]')?.value ?? '',
        };
    }

    renderLedgerTable(state, tableContainer, getFilters());
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function buildFilters(state, onChange) {
    const wrap = el('div', { class: 'bt-filters' });

    // Entity filter
    const entitySel = el('select', { class: 'bt-filter-select', 'data-filter': 'entity' });
    entitySel.appendChild(el('option', { value: '' }, 'All entities'));
    for (const p of state.persons) {
        entitySel.appendChild(el('option', { value: p.id }, p.name ?? 'Unnamed'));
    }
    for (const c of state.companies) {
        entitySel.appendChild(el('option', { value: c.id }, c.name ?? 'Unnamed'));
    }
    entitySel.addEventListener('change', onChange);

    // Currency filter
    const currSel = el('select', { class: 'bt-filter-select', 'data-filter': 'currency' });
    currSel.appendChild(el('option', { value: '' }, 'All currencies'));
    for (const cur of state.economy.currencies) {
        currSel.appendChild(el('option', { value: cur.id }, cur.name));
    }
    currSel.addEventListener('change', onChange);

    // Category filter
    const catSel = el('select', { class: 'bt-filter-select', 'data-filter': 'category' });
    catSel.appendChild(el('option', { value: '' }, 'All categories'));
    for (const cat of CATEGORIES) {
        catSel.appendChild(el('option', { value: cat }, cat.charAt(0).toUpperCase() + cat.slice(1)));
    }
    catSel.addEventListener('change', onChange);

    wrap.append(entitySel, currSel, catSel);
    return wrap;
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderLedgerTable(state, container, filters) {
    clearEl(container);

    let entries = [...state.ledger];

    // Apply filters
    if (filters.entityId) entries = entries.filter(e => e.entityId === filters.entityId);
    if (filters.currencyId) entries = entries.filter(e => e.currencyId === filters.currencyId);
    if (filters.category) entries = entries.filter(e => e.category === filters.category);

    // Most recent first
    entries = entries.slice().reverse();

    if (entries.length === 0) {
        container.appendChild(el('div', { class: 'bt-empty' }, 'No transactions match the current filters.'));
        return;
    }

    const table = el('table', { class: 'bt-table' });
    const thead = el('thead');
    thead.appendChild(el('tr', {},
        ...['Entity', 'Amount', 'Currency', 'Category', 'Description', 'Balance', ''].map(h =>
            el('th', {}, h)
        )
    ));
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const entry of entries) {
        const entity = findEntity(entry.entityId, state);
        const currency = state.economy.currencies.find(c => c.id === entry.currencyId);
        const tr = el('tr', { class: entry.amount < 0 ? 'bt-row-expense' : 'bt-row-income' });

        tr.appendChild(el('td', { class: 'bt-td-entity' }, entity?.name ?? entry.entityName ?? '?'));
        tr.appendChild(el('td', { class: `bt-td-amount${entry.amount < 0 ? ' negative' : ''}` },
            formatAmount(entry.amount, currency?.symbol ?? '')));
        tr.appendChild(el('td', {}, currency?.name ?? entry.currencyId ?? '?'));
        tr.appendChild(el('td', {}, el('span', { class: 'bt-tag' }, entry.category)));
        tr.appendChild(el('td', { class: 'bt-td-desc' }, truncate(entry.description, 50)));
        tr.appendChild(el('td', { class: entry.runningBalance < 0 ? 'negative' : '' },
            formatAmount(entry.runningBalance, currency?.symbol ?? '')));

        const delTd = el('td');
        const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Delete' }, '✕');
        delBtn.addEventListener('click', () => {
            if (confirm('Delete this ledger entry?')) {
                const chatState = getChatState();
                chatState.ledger = chatState.ledger.filter(e => e.id !== entry.id);
                // Re-save via store
                import('./store.js').then(({ saveChatState }) => {
                    saveChatState();
                    renderLedger(container.parentElement);
                });
            }
        });
        delTd.appendChild(delBtn);
        tr.appendChild(delTd);

        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    container.appendChild(table);
}

// ─── Ledger Entry Editor ──────────────────────────────────────────────────────

function openLedgerEditor(entry, container) {
    const state = getChatState();
    const isNew = !entry;

    const data = entry ? { ...entry } : {
        id: uuid(),
        date: isoNow(),
        entityId: '',
        currencyId: state.economy.currencies[0]?.id ?? '',
        amount: 0,
        category: 'other',
        description: '',
        tags: [],
        runningBalance: 0,
    };

    document.getElementById('bt-ledger-editor')?.remove();

    const overlay = el('div', { id: 'bt-ledger-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, isNew ? 'Add Ledger Entry' : 'Edit Entry');
    const form = el('div', { class: 'bt-editor-form' });

    // Entity select
    const entityWrap = el('div', { class: 'bt-field' });
    entityWrap.appendChild(el('label', { class: 'bt-field-label' }, 'Entity'));
    const entitySel = el('select', { class: 'bt-field-input' });
    entitySel.appendChild(el('option', { value: '' }, '— select —'));
    for (const p of state.persons) {
        const opt = el('option', { value: p.id }, p.name);
        if (p.id === data.entityId) opt.selected = true;
        entitySel.appendChild(opt);
    }
    for (const c of state.companies) {
        const opt = el('option', { value: c.id }, c.name);
        if (c.id === data.entityId) opt.selected = true;
        entitySel.appendChild(opt);
    }
    entitySel.addEventListener('change', () => data.entityId = entitySel.value);
    entityWrap.appendChild(entitySel);
    form.appendChild(entityWrap);

    // Currency select
    const curWrap = el('div', { class: 'bt-field' });
    curWrap.appendChild(el('label', { class: 'bt-field-label' }, 'Currency'));
    const curSel = el('select', { class: 'bt-field-input' });
    for (const cur of state.economy.currencies) {
        const opt = el('option', { value: cur.id }, cur.name);
        if (cur.id === data.currencyId) opt.selected = true;
        curSel.appendChild(opt);
    }
    curSel.addEventListener('change', () => data.currencyId = curSel.value);
    curWrap.appendChild(curSel);
    form.appendChild(curWrap);

    // Amount
    const amtWrap = el('div', { class: 'bt-field' });
    amtWrap.appendChild(el('label', { class: 'bt-field-label' }, 'Amount (negative = expense)'));
    const amtInput = el('input', { type: 'number', class: 'bt-field-input', step: 'any' });
    amtInput.value = String(data.amount);
    amtInput.addEventListener('input', () => data.amount = parseFloat(amtInput.value) || 0);
    amtWrap.appendChild(amtInput);
    form.appendChild(amtWrap);

    // Category
    const catWrap = el('div', { class: 'bt-field' });
    catWrap.appendChild(el('label', { class: 'bt-field-label' }, 'Category'));
    const catSel = el('select', { class: 'bt-field-input' });
    for (const cat of CATEGORIES) {
        const opt = el('option', { value: cat }, cat.charAt(0).toUpperCase() + cat.slice(1));
        if (cat === data.category) opt.selected = true;
        catSel.appendChild(opt);
    }
    catSel.addEventListener('change', () => data.category = catSel.value);
    catWrap.appendChild(catSel);
    form.appendChild(catWrap);

    // Description
    const descWrap = el('div', { class: 'bt-field' });
    descWrap.appendChild(el('label', { class: 'bt-field-label' }, 'Description'));
    const descInput = el('input', { type: 'text', class: 'bt-field-input' });
    descInput.value = data.description;
    descInput.addEventListener('input', () => data.description = descInput.value);
    descWrap.appendChild(descInput);
    form.appendChild(descWrap);

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, isNew ? 'Add' : 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');

    saveBtn.addEventListener('click', () => {
        if (!data.entityId) { alert('Please select an entity.'); return; }
        if (!data.currencyId) { alert('Please select a currency.'); return; }
        // Compute running balance
        const priorEntries = state.ledger.filter(
            e => e.entityId === data.entityId && e.currencyId === data.currencyId
        );
        const priorBalance = priorEntries.reduce((sum, e) => sum + e.amount, 0);
        data.runningBalance = priorBalance + data.amount;
        addLedgerEntry(data);
        overlay.remove();
        renderLedger(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());

    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findEntity(id, state) {
    return state.persons.find(p => p.id === id) ?? state.companies.find(c => c.id === id) ?? null;
}
