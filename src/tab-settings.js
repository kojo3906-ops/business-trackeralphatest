/**
 * tab-settings.js — Settings & Prompt Editor tab
 * Every feature can be toggled or adjusted here.
 */

import { getGlobalSettings, saveGlobalSettings, DEFAULT_PROMPTS, DEFAULT_TEMPLATES } from './store.js';
import { el, clearEl } from './utils.js';

// ─── Render ───────────────────────────────────────────────────────────────────

export function renderSettings(container) {
    clearEl(container);

    const settings = getGlobalSettings();

    container.appendChild(buildSection('Extension', buildExtensionToggles(settings)));
    container.appendChild(buildSection('API Connection', buildApiConfig(settings)));
    container.appendChild(buildSection('Parse Cadence', buildParseCadence(settings)));
    container.appendChild(buildSection('Feature Toggles', buildFeatureToggles(settings)));
    container.appendChild(buildSection('Injection', buildInjectionConfig(settings)));
    container.appendChild(buildSection('Prompts', buildPromptEditor(settings)));
    container.appendChild(buildSection('Injection Templates', buildTemplateEditor(settings)));
}

// ─── Section Wrapper ──────────────────────────────────────────────────────────

function buildSection(title, content) {
    const section = el('div', { class: 'bt-settings-section' });
    const heading = el('div', { class: 'bt-settings-heading' }, title);
    section.append(heading, content);
    return section;
}

// ─── Extension Toggles ────────────────────────────────────────────────────────

function buildExtensionToggles(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });
    wrap.appendChild(buildToggle(
        'Enable Business Tracker',
        settings.enabled,
        val => { settings.enabled = val; saveGlobalSettings(); }
    ));
    return wrap;
}

// ─── API Config ───────────────────────────────────────────────────────────────

function buildApiConfig(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });

    // Use ST connection toggle
    wrap.appendChild(buildToggle(
        'Use active SillyTavern connection',
        settings.api.useSTConnection,
        val => {
            settings.api.useSTConnection = val;
            saveGlobalSettings();
            // Show/hide manual fields
            manualFields.style.display = val ? 'none' : '';
        }
    ));

    // Copy from ST button
    const copyBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, '⬇ Copy from ST connection');
    copyBtn.addEventListener('click', () => copyFromSTConnection(settings));
    wrap.appendChild(copyBtn);

    // Manual fields
    const manualFields = el('div', { class: 'bt-settings-manual-fields' });
    manualFields.style.display = settings.api.useSTConnection ? 'none' : '';

    manualFields.appendChild(buildTextInput('Endpoint URL', settings.api.endpoint, val => {
        settings.api.endpoint = val;
        saveGlobalSettings();
    }, 'https://api.openai.com/v1'));

    manualFields.appendChild(buildTextInput('API Key', settings.api.apiKey, val => {
        settings.api.apiKey = val;
        saveGlobalSettings();
    }, 'sk-...', true));

    manualFields.appendChild(buildTextInput('Model', settings.api.model, val => {
        settings.api.model = val;
        saveGlobalSettings();
    }, 'gpt-4o-mini'));

    wrap.appendChild(manualFields);
    return wrap;
}

function copyFromSTConnection(settings) {
    try {
        // Read ST's active connection settings from the global scope
        const stSettings = window.power_user ?? {};
        const apiUrl = window.main_api === 'openai'
            ? (window.oai_settings?.reverse_proxy || 'https://api.openai.com/v1')
            : (stSettings.proxy_url || '');
        const apiKey = window.oai_settings?.openai_api_key || '';
        const model = window.oai_settings?.openai_model || '';

        settings.api.endpoint = apiUrl;
        settings.api.apiKey = apiKey;
        settings.api.model = model;
        saveGlobalSettings();

        // Re-render the settings tab to show updated values
        const container = document.querySelector('#bt-panel .bt-tab-content');
        if (container) renderSettings(container);

        showToast('Copied ST connection settings.');
    } catch (e) {
        showToast('Could not read ST connection settings.', true);
        console.error('[BT] copyFromSTConnection error:', e);
    }
}

// ─── Parse Cadence ────────────────────────────────────────────────────────────

function buildParseCadence(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });

    wrap.appendChild(buildToggle(
        'Auto-parse on new messages',
        settings.parse.autoParse,
        val => { settings.parse.autoParse = val; saveGlobalSettings(); }
    ));

    wrap.appendChild(buildNumberInput(
        'Parse entities/ledger/jobs/projects every N messages',
        settings.parse.parseEveryN,
        1, 200,
        val => { settings.parse.parseEveryN = val; saveGlobalSettings(); }
    ));

    wrap.appendChild(buildNumberInput(
        'Parse economy every N messages',
        settings.parse.economyEveryN,
        1, 500,
        val => { settings.parse.economyEveryN = val; saveGlobalSettings(); }
    ));

    return wrap;
}

// ─── Feature Toggles ─────────────────────────────────────────────────────────

function buildFeatureToggles(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });

    const features = [
        ['parseEntities', 'Parse entities (people & companies)'],
        ['parseLedger',   'Parse ledger (transactions)'],
        ['parseJobs',     'Parse jobs & contracts'],
        ['parseProjects', 'Parse projects'],
        ['parseEconomy',  'Parse economy'],
        ['injection',     'Lorebook-style entity injection'],
    ];

    for (const [key, label] of features) {
        wrap.appendChild(buildToggle(
            label,
            settings.features[key],
            val => { settings.features[key] = val; saveGlobalSettings(); }
        ));
    }

    return wrap;
}

// ─── Injection Config ─────────────────────────────────────────────────────────

function buildInjectionConfig(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });

    wrap.appendChild(buildToggle(
        'Use relevance check before injecting',
        settings.injection.relevanceCheckEnabled,
        val => { settings.injection.relevanceCheckEnabled = val; saveGlobalSettings(); }
    ));

    wrap.appendChild(buildNumberInput(
        'Messages to look back for relevance check',
        settings.injection.relevanceLookback,
        1, 50,
        val => { settings.injection.relevanceLookback = val; saveGlobalSettings(); }
    ));

    wrap.appendChild(buildNumberInput(
        'Injection depth (lorebook position)',
        settings.injection.injectionDepth,
        1, 20,
        val => { settings.injection.injectionDepth = val; saveGlobalSettings(); }
    ));

    return wrap;
}

// ─── Prompt Editor ────────────────────────────────────────────────────────────

const PROMPT_LABELS = {
    parseEntities:  'Parse Entities',
    parseLedger:    'Parse Ledger',
    parseJobs:      'Parse Jobs',
    parseProjects:  'Parse Projects',
    parseEconomy:   'Parse Economy',
    mergeEntities:  'Merge Entities',
    relevanceCheck: 'Relevance Check',
};

function buildPromptEditor(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });

    for (const [key, label] of Object.entries(PROMPT_LABELS)) {
        wrap.appendChild(buildPromptEntry(
            label,
            settings.prompts[key] ?? DEFAULT_PROMPTS[key],
            val => { settings.prompts[key] = val; saveGlobalSettings(); },
            () => {
                settings.prompts[key] = DEFAULT_PROMPTS[key];
                saveGlobalSettings();
                // Re-render
                const container = document.querySelector('#bt-panel .bt-tab-content');
                if (container) renderSettings(container);
            }
        ));
    }

    return wrap;
}

function buildPromptEntry(label, value, onChange, onReset) {
    const wrap = el('div', { class: 'bt-prompt-entry' });
    const header = el('div', { class: 'bt-prompt-header' });
    const labelEl = el('span', { class: 'bt-prompt-label' }, label);
    const resetBtn = el('button', { class: 'bt-btn bt-btn-ghost bt-btn-sm' }, '↩ Reset');
    resetBtn.addEventListener('click', onReset);
    header.append(labelEl, resetBtn);

    // Collapsible textarea
    const toggle = el('button', { class: 'bt-btn bt-btn-ghost bt-btn-sm' }, '▼ Edit');
    let expanded = false;
    const textarea = el('textarea', { class: 'bt-prompt-textarea', rows: '10', style: { display: 'none' } });
    textarea.value = value;
    textarea.addEventListener('input', () => onChange(textarea.value));

    toggle.addEventListener('click', () => {
        expanded = !expanded;
        textarea.style.display = expanded ? '' : 'none';
        toggle.textContent = expanded ? '▲ Collapse' : '▼ Edit';
    });

    wrap.append(header, toggle, textarea);
    return wrap;
}

// ─── Template Editor ──────────────────────────────────────────────────────────

const TEMPLATE_LABELS = {
    person:  'Person Injection Template',
    company: 'Company Injection Template',
};

function buildTemplateEditor(settings) {
    const wrap = el('div', { class: 'bt-settings-group' });

    for (const [key, label] of Object.entries(TEMPLATE_LABELS)) {
        wrap.appendChild(buildPromptEntry(
            label,
            settings.templates[key] ?? DEFAULT_TEMPLATES[key],
            val => { settings.templates[key] = val; saveGlobalSettings(); },
            () => {
                settings.templates[key] = DEFAULT_TEMPLATES[key];
                saveGlobalSettings();
                const container = document.querySelector('#bt-panel .bt-tab-content');
                if (container) renderSettings(container);
            }
        ));
    }

    return wrap;
}

// ─── Reusable Input Components ────────────────────────────────────────────────

function buildToggle(label, value, onChange) {
    const wrap = el('div', { class: 'bt-toggle-row' });
    const labelEl = el('label', { class: 'bt-toggle-label' }, label);
    const input = el('input', { type: 'checkbox', class: 'bt-toggle' });
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    wrap.append(labelEl, input);
    return wrap;
}

function buildTextInput(label, value, onChange, placeholder = '', masked = false) {
    const wrap = el('div', { class: 'bt-input-row' });
    const labelEl = el('label', { class: 'bt-input-label' }, label);
    const input = el('input', {
        type: masked ? 'password' : 'text',
        class: 'bt-input',
        placeholder,
    });
    input.value = value;
    input.addEventListener('change', () => onChange(input.value.trim()));
    wrap.append(labelEl, input);
    return wrap;
}

function buildNumberInput(label, value, min, max, onChange) {
    const wrap = el('div', { class: 'bt-input-row' });
    const labelEl = el('label', { class: 'bt-input-label' }, label);
    const input = el('input', { type: 'number', class: 'bt-input bt-input-number', min: String(min), max: String(max) });
    input.value = String(value);
    input.addEventListener('change', () => {
        const v = Math.min(max, Math.max(min, parseInt(input.value, 10) || min));
        input.value = String(v);
        onChange(v);
    });
    wrap.append(labelEl, input);
    return wrap;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, isError = false) {
    const toast = el('div', { class: `bt-toast${isError ? ' bt-toast-error' : ''}` }, message);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}
