/**
 * tab-economy.js — Economy tab
 * AI-generated narrative, indicator table, world currencies, manual re-parse.
 */

import { getChatState, saveChatState, updateEconomy } from './store.js';
import { el, clearEl, uuid, formatDateTime, INDICATOR_VALUE_LABELS, TREND_SYMBOLS } from './utils.js';
import { onNewMessage } from './parser.js';

export function renderEconomy(container) {
    clearEl(container);

    const state = getChatState();
    const economy = state.economy;

    // ── Header / Controls ──
    const toolbar = el('div', { class: 'bt-toolbar' });

    const lastUpdatedEl = el('span', { class: 'bt-economy-updated' },
        economy.lastUpdated
            ? `Last updated: ${formatDateTime(economy.lastUpdated)}`
            : 'Not yet parsed.'
    );

    const parseBtn = el('button', { class: 'bt-btn bt-btn-primary' }, '⟳ Parse Now');
    parseBtn.addEventListener('click', async () => {
        parseBtn.disabled = true;
        parseBtn.textContent = 'Parsing…';
        try {
            await onNewMessage(true);
            renderEconomy(container);
        } catch (e) {
            console.error('[BT] Manual economy parse failed:', e);
        } finally {
            parseBtn.disabled = false;
            parseBtn.textContent = '⟳ Parse Now';
        }
    });

    // Per-chat economy enable toggle
    const toggleWrap = el('div', { class: 'bt-toggle-row' });
    const toggleLabel = el('label', { class: 'bt-toggle-label' }, 'Economy tracking (this chat)');
    const toggleInput = el('input', { type: 'checkbox', class: 'bt-toggle' });
    toggleInput.checked = economy.enabled !== false;
    toggleInput.addEventListener('change', () => {
        economy.enabled = toggleInput.checked;
        saveChatState();
    });
    toggleWrap.append(toggleLabel, toggleInput);

    toolbar.append(lastUpdatedEl, parseBtn, toggleWrap);
    container.appendChild(toolbar);

    // ── Narrative Description ──
    if (economy.description) {
        const section = el('div', { class: 'bt-economy-section' });
        section.appendChild(el('div', { class: 'bt-section-label' }, 'Economic Climate'));
        const desc = el('div', { class: 'bt-economy-narrative' }, economy.description);
        section.appendChild(desc);
        container.appendChild(section);
    } else {
        container.appendChild(el('div', { class: 'bt-empty' },
            'No economic data yet. Parse the chat or add indicators manually.'));
    }

    // ── Indicators ──
    if (economy.indicators?.length > 0) {
        const section = el('div', { class: 'bt-economy-section' });
        section.appendChild(el('div', { class: 'bt-section-label' }, 'Indicators'));

        const table = el('table', { class: 'bt-table' });
        const thead = el('thead');
        thead.appendChild(el('tr', {},
            ...['Indicator', 'Value', 'Trend', 'Notes', ''].map(h => el('th', {}, h))
        ));
        table.appendChild(thead);

        const tbody = el('tbody');
        for (const indicator of economy.indicators) {
            const tr = el('tr');
            tr.appendChild(el('td', {}, indicator.name ?? ''));
            tr.appendChild(el('td', {},
                el('span', { class: `bt-indicator-${indicator.value}` },
                    INDICATOR_VALUE_LABELS[indicator.value] ?? indicator.value ?? '?')
            ));
            tr.appendChild(el('td', { class: 'bt-trend' },
                TREND_SYMBOLS[indicator.trend] ?? '→'));
            tr.appendChild(el('td', { class: 'bt-td-desc' }, indicator.notes ?? ''));

            // Delete button
            const delTd = el('td');
            const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Remove' }, '✕');
            delBtn.addEventListener('click', () => {
                economy.indicators = economy.indicators.filter(i => i !== indicator);
                saveChatState();
                renderEconomy(container);
            });
            delTd.appendChild(delBtn);
            tr.appendChild(delTd);

            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        section.appendChild(table);
        container.appendChild(section);
    }

    // Add indicator button
    const addIndBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, '+ Add Indicator');
    addIndBtn.addEventListener('click', () => openIndicatorEditor(null, economy, container));
    container.appendChild(addIndBtn);

    // ── Currencies ──
    const curSection = el('div', { class: 'bt-economy-section' });
    curSection.appendChild(el('div', { class: 'bt-section-label' }, 'World Currencies'));

    if (economy.currencies?.length > 0) {
        const curList = el('div', { class: 'bt-currency-list' });
        for (const cur of economy.currencies) {
            const row = el('div', { class: 'bt-currency-row' });
            const nameEl = el('span', { class: 'bt-currency-name' }, cur.name);
            const symEl = cur.symbol ? el('span', { class: 'bt-currency-sym' }, `(${cur.symbol})`) : null;
            const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Remove' }, '✕');
            delBtn.addEventListener('click', () => {
                economy.currencies = economy.currencies.filter(c => c.id !== cur.id);
                saveChatState();
                renderEconomy(container);
            });
            row.append(nameEl);
            if (symEl) row.appendChild(symEl);
            row.appendChild(delBtn);
            curList.appendChild(row);
        }
        curSection.appendChild(curList);
    } else {
        curSection.appendChild(el('div', { class: 'bt-empty-inline' }, 'No currencies defined.'));
    }

    const addCurBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, '+ Add Currency');
    addCurBtn.addEventListener('click', () => openCurrencyEditor(economy, container));
    curSection.appendChild(addCurBtn);
    container.appendChild(curSection);

    // ── Edit Narrative ──
    const editNarrBtn = el('button', { class: 'bt-btn bt-btn-ghost' }, '✎ Edit narrative');
    editNarrBtn.addEventListener('click', () => openNarrativeEditor(economy, container));
    container.appendChild(editNarrBtn);
}

// ─── Indicator Editor ─────────────────────────────────────────────────────────

function openIndicatorEditor(indicator, economy, container) {
    const isNew = !indicator;
    const data = indicator ? { ...indicator } : {
        name: '', value: 'stable', trend: 'stable', notes: '',
    };

    document.getElementById('bt-indicator-editor')?.remove();
    const overlay = el('div', { id: 'bt-indicator-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, isNew ? 'Add Indicator' : 'Edit Indicator');
    const form = el('div', { class: 'bt-editor-form' });

    form.appendChild(buildTextField('Name', data.name, v => data.name = v));
    form.appendChild(buildSelectField('Value',
        ['very_low','low','stable','high','very_high','unknown'],
        data.value, v => data.value = v, INDICATOR_VALUE_LABELS));
    form.appendChild(buildSelectField('Trend',
        ['improving','stable','declining'],
        data.trend, v => data.trend = v,
        { improving: '↑ Improving', stable: '→ Stable', declining: '↓ Declining' }));
    form.appendChild(buildTextField('Notes', data.notes, v => data.notes = v));

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, isNew ? 'Add' : 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');
    saveBtn.addEventListener('click', () => {
        if (!data.name.trim()) { alert('Name is required.'); return; }
        if (isNew) {
            economy.indicators = economy.indicators ?? [];
            economy.indicators.push(data);
        } else {
            Object.assign(indicator, data);
        }
        saveChatState();
        overlay.remove();
        renderEconomy(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Currency Editor ──────────────────────────────────────────────────────────

function openCurrencyEditor(economy, container) {
    document.getElementById('bt-currency-editor')?.remove();
    const overlay = el('div', { id: 'bt-currency-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, 'Add Currency');
    const form = el('div', { class: 'bt-editor-form' });

    const data = { name: '', symbol: '' };
    form.appendChild(buildTextField('Currency Name', data.name, v => data.name = v));
    form.appendChild(buildTextField('Symbol (optional)', data.symbol, v => data.symbol = v));

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, 'Add');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');
    saveBtn.addEventListener('click', () => {
        if (!data.name.trim()) { alert('Name is required.'); return; }
        economy.currencies = economy.currencies ?? [];
        economy.currencies.push({ id: uuid(), name: data.name.trim(), symbol: data.symbol.trim() });
        saveChatState();
        overlay.remove();
        renderEconomy(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Narrative Editor ─────────────────────────────────────────────────────────

function openNarrativeEditor(economy, container) {
    document.getElementById('bt-narrative-editor')?.remove();
    const overlay = el('div', { id: 'bt-narrative-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, 'Edit Economic Narrative');
    const form = el('div', { class: 'bt-editor-form' });

    const ta = el('textarea', { class: 'bt-field-input', rows: '8' });
    ta.value = economy.description ?? '';
    form.appendChild(ta);

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');
    saveBtn.addEventListener('click', () => {
        economy.description = ta.value;
        saveChatState();
        overlay.remove();
        renderEconomy(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Field Helpers ────────────────────────────────────────────────────────────

function buildTextField(label, value, onChange) {
    const wrap = el('div', { class: 'bt-field' });
    wrap.appendChild(el('label', { class: 'bt-field-label' }, label));
    const input = el('input', { type: 'text', class: 'bt-field-input' });
    input.value = value ?? '';
    input.addEventListener('input', () => onChange(input.value));
    wrap.appendChild(input);
    return wrap;
}

function buildSelectField(label, options, value, onChange, labels = {}) {
    const wrap = el('div', { class: 'bt-field' });
    wrap.appendChild(el('label', { class: 'bt-field-label' }, label));
    const select = el('select', { class: 'bt-field-input' });
    for (const opt of options) {
        const option = el('option', { value: opt }, labels[opt] ?? opt);
        if (opt === value) option.selected = true;
        select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
}
