/**
 * tab-companies.js — Companies tab
 * Shows company cards with industry, description, employees, revenue estimate.
 */

import { getChatState, upsertCompany, deleteCompany } from './store.js';
import { el, clearEl, uuid, truncate, ECONOMIC_TIER_LABELS } from './utils.js';

export function renderCompanies(container) {
    clearEl(container);

    const state = getChatState();

    // ── Toolbar ──
    const toolbar = el('div', { class: 'bt-toolbar' });
    const addBtn = el('button', { class: 'bt-btn bt-btn-primary' }, '+ Add Company');
    addBtn.addEventListener('click', () => openCompanyEditor(null, container));
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    if (state.companies.length === 0) {
        container.appendChild(el('div', { class: 'bt-empty' }, 'No companies tracked yet. They will appear here as the chat is parsed.'));
        return;
    }

    const sorted = [...state.companies].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    for (const company of sorted) {
        container.appendChild(buildCompanyCard(company, state, container));
    }
}

// ─── Company Card ─────────────────────────────────────────────────────────────

function buildCompanyCard(company, state, container) {
    const card = el('div', { class: 'bt-card' });
    let expanded = false;

    // ── Header ──
    const header = el('div', { class: 'bt-card-header' });
    const nameEl = el('span', { class: 'bt-card-name' }, company.name ?? 'Unnamed');
    const subEl = el('span', { class: 'bt-card-sub' },
        [company.industry, ECONOMIC_TIER_LABELS[company.economicTier]].filter(Boolean).join(' · '));
    const chevron = el('span', { class: 'bt-chevron' }, '▶');

    const actions = el('div', { class: 'bt-card-actions' });
    const editBtn = el('button', { class: 'bt-icon-btn', title: 'Edit' }, '✎');
    const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Delete' }, '✕');
    editBtn.addEventListener('click', e => { e.stopPropagation(); openCompanyEditor(company, container); });
    delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Delete ${company.name}?`)) {
            deleteCompany(company.id);
            renderCompanies(container);
        }
    });
    actions.append(editBtn, delBtn);
    header.append(chevron, nameEl, subEl, actions);

    // ── Detail ──
    const detail = el('div', { class: 'bt-card-detail' });
    detail.style.display = 'none';
    buildCompanyDetail(company, state, detail);

    header.addEventListener('click', () => {
        expanded = !expanded;
        detail.style.display = expanded ? '' : 'none';
        chevron.textContent = expanded ? '▼' : '▶';
        card.classList.toggle('expanded', expanded);
    });

    card.append(header, detail);
    return card;
}

function buildCompanyDetail(company, state, container) {
    clearEl(container);

    if (company.description) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'What they do'));
        s.appendChild(el('div', { class: 'bt-detail-text' }, company.description));
        container.appendChild(s);
    }

    // Revenue estimate
    if (company.revenueEstimate) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Revenue Estimate'));
        const rev = company.revenueEstimate;
        const currency = state.economy.currencies.find(c => c.id === rev.currencyId);
        s.appendChild(el('div', { class: 'bt-detail-row' },
            `${currency?.symbol ?? ''}${rev.amount ?? '?'} / ${rev.period ?? 'period'}`));
        container.appendChild(s);
    }

    // Employees
    const employees = state.persons.filter(p =>
        p.affiliations?.some(a => a.companyId === company.id)
    );
    if (employees.length > 0) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Known Personnel'));
        for (const emp of employees) {
            const aff = emp.affiliations.find(a => a.companyId === company.id);
            s.appendChild(el('div', { class: 'bt-detail-row' },
                `${emp.name} — ${aff?.relationshipType ?? 'affiliated'}`));
        }
        container.appendChild(s);
    }

    // Parent company
    if (company.parentCompanyId) {
        const parent = state.companies.find(c => c.id === company.parentCompanyId);
        if (parent) {
            const s = el('div', { class: 'bt-detail-section' });
            s.appendChild(el('div', { class: 'bt-detail-label' }, 'Parent Company'));
            s.appendChild(el('div', { class: 'bt-detail-row' }, parent.name));
            container.appendChild(s);
        }
    }

    if (company.notes) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Notes'));
        s.appendChild(el('div', { class: 'bt-detail-text' }, company.notes));
        container.appendChild(s);
    }
}

// ─── Company Editor ───────────────────────────────────────────────────────────

function openCompanyEditor(company, container) {
    const isNew = !company;
    const data = company ? { ...company } : {
        id: uuid(),
        name: '',
        industry: '',
        description: '',
        economicTier: 'small',
        revenueEstimate: null,
        parentCompanyId: null,
        notes: '',
    };

    document.getElementById('bt-company-editor')?.remove();

    const overlay = el('div', { id: 'bt-company-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, isNew ? 'Add Company' : 'Edit Company');

    const form = el('div', { class: 'bt-editor-form' });
    form.appendChild(buildField('Name', 'text', data.name, v => data.name = v));
    form.appendChild(buildField('Industry', 'text', data.industry, v => data.industry = v));
    form.appendChild(buildField('Description (what they do)', 'textarea', data.description, v => data.description = v));
    form.appendChild(buildSelectField('Economic Scale', ['micro','small','mid','large','mega'], data.economicTier, v => data.economicTier = v));
    form.appendChild(buildField('Notes', 'textarea', data.notes, v => data.notes = v));

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, isNew ? 'Add' : 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');

    saveBtn.addEventListener('click', () => {
        if (!data.name.trim()) { alert('Name is required.'); return; }
        upsertCompany(data);
        overlay.remove();
        renderCompanies(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());

    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Field Helpers ────────────────────────────────────────────────────────────

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
        const option = el('option', { value: opt }, ECONOMIC_TIER_LABELS[opt] ?? opt);
        if (opt === value) option.selected = true;
        select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    wrap.append(labelEl, select);
    return wrap;
}
