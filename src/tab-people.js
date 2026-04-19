/**
 * tab-people.js — People tab
 * Shows {{user}} (PC) card at top, then NPCs.
 * Each card expands to show affiliations, balances, and filtered ledger.
 */

import { getChatState, saveChatState, upsertPerson, deletePerson } from './store.js';
import { el, clearEl, uuid, isoNow, formatDate, formatAmount, truncate } from './utils.js';

export function renderPeople(container) {
    clearEl(container);

    const state = getChatState();
    const userName = window.name1 ?? 'User';

    // ── Toolbar ──
    const toolbar = el('div', { class: 'bt-toolbar' });
    const addBtn = el('button', { class: 'bt-btn bt-btn-primary' }, '+ Add Person');
    addBtn.addEventListener('click', () => openPersonEditor(null, container));
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    if (state.persons.length === 0) {
        container.appendChild(el('div', { class: 'bt-empty' }, 'No people tracked yet. They will appear here as the chat is parsed.'));
        return;
    }

    // Sort: PC first (by matching name1), then NPCs alphabetically
    const pcs = state.persons.filter(p => p.type === 'pc' || p.name?.toLowerCase() === userName.toLowerCase());
    const npcs = state.persons.filter(p => !pcs.includes(p));
    npcs.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    if (pcs.length > 0) {
        container.appendChild(el('div', { class: 'bt-section-label' }, '— Player Character —'));
        for (const person of pcs) {
            container.appendChild(buildPersonCard(person, state, container, true));
        }
    }

    if (npcs.length > 0) {
        container.appendChild(el('div', { class: 'bt-section-label' }, '— NPCs —'));
        for (const person of npcs) {
            container.appendChild(buildPersonCard(person, state, container, false));
        }
    }
}

// ─── Person Card ──────────────────────────────────────────────────────────────

function buildPersonCard(person, state, container, isPC) {
    const card = el('div', { class: `bt-card${isPC ? ' bt-card-pc' : ''}` });
    let expanded = false;

    // ── Card header ──
    const header = el('div', { class: 'bt-card-header' });
    const nameEl = el('span', { class: 'bt-card-name' }, person.name ?? 'Unnamed');
    const roleEl = el('span', { class: 'bt-card-sub' }, person.role ?? '');
    const chevron = el('span', { class: 'bt-chevron' }, '▶');

    const actions = el('div', { class: 'bt-card-actions' });
    const editBtn = el('button', { class: 'bt-icon-btn', title: 'Edit' }, '✎');
    const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Delete' }, '✕');
    editBtn.addEventListener('click', e => { e.stopPropagation(); openPersonEditor(person, container); });
    delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Delete ${person.name}?`)) {
            deletePerson(person.id);
            renderPeople(container);
        }
    });
    actions.append(editBtn, delBtn);
    header.append(chevron, nameEl, roleEl, actions);

    // ── Balance summary row (always visible) ──
    const balances = getPersonBalances(person.id, state);
    if (balances.length > 0) {
        const balRow = el('div', { class: 'bt-balance-row' });
        for (const b of balances) {
            const chip = el('span', { class: `bt-balance-chip${b.balance < 0 ? ' negative' : ''}` },
                `${b.currencySymbol || b.currencyName} ${formatAmount(b.balance)}`);
            balRow.appendChild(chip);
        }
        header.appendChild(balRow);
    }

    // ── Expanded detail ──
    const detail = el('div', { class: 'bt-card-detail' });
    detail.style.display = 'none';
    buildPersonDetail(person, state, detail);

    header.addEventListener('click', () => {
        expanded = !expanded;
        detail.style.display = expanded ? '' : 'none';
        chevron.textContent = expanded ? '▼' : '▶';
        card.classList.toggle('expanded', expanded);
    });

    card.append(header, detail);
    return card;
}

function buildPersonDetail(person, state, container) {
    clearEl(container);

    // Affiliations
    if (person.affiliations?.length > 0) {
        const section = el('div', { class: 'bt-detail-section' });
        section.appendChild(el('div', { class: 'bt-detail-label' }, 'Affiliations'));
        for (const aff of person.affiliations) {
            const company = state.companies.find(c => c.id === aff.companyId);
            const name = company?.name ?? aff.companyName ?? aff.companyId ?? '?';
            section.appendChild(el('div', { class: 'bt-detail-row' },
                `${name} — ${aff.relationshipType ?? 'affiliated'}`
            ));
        }
        container.appendChild(section);
    }

    // Notes
    if (person.notes) {
        const section = el('div', { class: 'bt-detail-section' });
        section.appendChild(el('div', { class: 'bt-detail-label' }, 'Notes'));
        section.appendChild(el('div', { class: 'bt-detail-text' }, person.notes));
        container.appendChild(section);
    }

    // Ledger (filtered to this person)
    const personLedger = state.ledger
        .filter(e => e.entityId === person.id)
        .slice(-10)
        .reverse();

    if (personLedger.length > 0) {
        const section = el('div', { class: 'bt-detail-section' });
        section.appendChild(el('div', { class: 'bt-detail-label' }, 'Recent Transactions'));
        for (const entry of personLedger) {
            const currency = state.economy.currencies.find(c => c.id === entry.currencyId);
            const row = el('div', { class: 'bt-ledger-mini-row' });
            const amtEl = el('span', { class: `bt-amount${entry.amount < 0 ? ' negative' : ''}` },
                `${currency?.symbol ?? ''}${formatAmount(entry.amount)}`);
            const descEl = el('span', { class: 'bt-ledger-desc' }, truncate(entry.description, 40));
            const catEl = el('span', { class: 'bt-tag' }, entry.category);
            row.append(amtEl, descEl, catEl);
            section.appendChild(row);
        }
        container.appendChild(section);
    }
}

// ─── Person Editor ────────────────────────────────────────────────────────────

function openPersonEditor(person, container) {
    const isNew = !person;
    const data = person ? { ...person } : {
        id: uuid(),
        type: 'npc',
        name: '',
        role: '',
        affiliations: [],
        notes: '',
    };

    // Remove any existing editor
    document.getElementById('bt-person-editor')?.remove();

    const overlay = el('div', { id: 'bt-person-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });

    const title = el('h3', { class: 'bt-editor-title' }, isNew ? 'Add Person' : 'Edit Person');

    const form = el('div', { class: 'bt-editor-form' });
    form.appendChild(buildField('Name', 'text', data.name, v => data.name = v));
    form.appendChild(buildField('Role / Occupation', 'text', data.role, v => data.role = v));
    form.appendChild(buildSelectField('Type', ['pc', 'npc'], data.type, v => data.type = v));
    form.appendChild(buildField('Notes', 'textarea', data.notes, v => data.notes = v));

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, isNew ? 'Add' : 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');

    saveBtn.addEventListener('click', () => {
        if (!data.name.trim()) { alert('Name is required.'); return; }
        upsertPerson(data);
        overlay.remove();
        renderPeople(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());

    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPersonBalances(personId, state) {
    const totals = {};
    for (const entry of state.ledger) {
        if (entry.entityId !== personId) continue;
        const cid = entry.currencyId;
        totals[cid] = (totals[cid] ?? 0) + entry.amount;
    }
    return Object.entries(totals).map(([cid, balance]) => {
        const currency = state.economy.currencies.find(c => c.id === cid) ?? { name: cid, symbol: '' };
        return { currencyId: cid, currencyName: currency.name, currencySymbol: currency.symbol, balance };
    });
}

function buildField(label, type, value, onChange) {
    const wrap = el('div', { class: 'bt-field' });
    const labelEl = el('label', { class: 'bt-field-label' }, label);
    let input;
    if (type === 'textarea') {
        input = el('textarea', { class: 'bt-field-input', rows: '3' });
        input.value = value ?? '';
        input.addEventListener('input', () => onChange(input.value));
    } else {
        input = el('input', { type, class: 'bt-field-input' });
        input.value = value ?? '';
        input.addEventListener('input', () => onChange(input.value));
    }
    wrap.append(labelEl, input);
    return wrap;
}

function buildSelectField(label, options, value, onChange) {
    const wrap = el('div', { class: 'bt-field' });
    const labelEl = el('label', { class: 'bt-field-label' }, label);
    const select = el('select', { class: 'bt-field-input' });
    for (const opt of options) {
        const option = el('option', { value: opt }, opt.toUpperCase());
        if (opt === value) option.selected = true;
        select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    wrap.append(labelEl, select);
    return wrap;
}
