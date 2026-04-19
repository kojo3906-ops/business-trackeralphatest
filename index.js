/**
 * index.js — Business Tracker extension entry point
 * Registers the extension with SillyTavern, wires up all event hooks.
 */

import { getGlobalSettings, getChatState } from './src/store.js';
import { buildPanel, registerTab, showPanel, refreshActiveTab } from './src/panel.js';
import { renderPeople } from './src/tab-people.js';
import { renderCompanies } from './src/tab-companies.js';
import { renderLedger } from './src/tab-ledger.js';
import { renderWork } from './src/tab-work.js';
import { renderEconomy } from './src/tab-economy.js';
import { renderSettings } from './src/tab-settings.js';
import { onNewMessage } from './src/parser.js';
import { runInjection, clearInjection } from './src/injection.js';
import { registerCommands } from './src/commands.js';

// ─── ST API Imports ───────────────────────────────────────────────────────────
// These are ST's module paths — adjust if your ST version differs.

import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../../scripts/extensions.js';

// ─── Extension Init ───────────────────────────────────────────────────────────

(function initBusinessTracker() {
    console.log('[Business Tracker] Initialising…');

    const settings = getGlobalSettings();
    if (!settings.enabled) {
        console.log('[Business Tracker] Disabled in settings, skipping init.');
        return;
    }

    // ── Register tabs ──
    registerTab('people',    'People',    '👤', renderPeople);
    registerTab('companies', 'Companies', '🏢', renderCompanies);
    registerTab('ledger',    'Ledger',    '📒', renderLedger);
    registerTab('work',      'Work',      '📋', renderWork);
    registerTab('economy',   'Economy',   '📈', renderEconomy);
    registerTab('settings',  'Settings',  '⚙️',  renderSettings);

    // ── Build panel DOM (hidden by default) ──
    buildPanel();

    // ── Register slash commands ──
    registerCommands();

    // ── Wire ST event hooks ──
    wireEventHooks();

    // ── Add extension settings button to ST UI ──
    addSettingsButton();

    console.log('[Business Tracker] Ready.');
})();

// ─── Event Hooks ──────────────────────────────────────────────────────────────

function wireEventHooks() {
    // New message received — trigger auto-parse check
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        const settings = getGlobalSettings();
        if (!settings.enabled || !settings.parse.autoParse) return;
        try {
            await onNewMessage(false);
            // Refresh the active tab if the panel is open
            if (settings.panel.visible) refreshActiveTab();
        } catch (e) {
            console.error('[BT] Auto-parse on MESSAGE_RECEIVED failed:', e);
        }
    });

    // Message sent by user — also count toward parse threshold
    eventSource.on(event_types.MESSAGE_SENT, async () => {
        const settings = getGlobalSettings();
        if (!settings.enabled || !settings.parse.autoParse) return;
        try {
            await onNewMessage(false);
        } catch (e) {
            console.error('[BT] Auto-parse on MESSAGE_SENT failed:', e);
        }
    });

    // Before prompt generation — run injection
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, async () => {
        const settings = getGlobalSettings();
        if (!settings.enabled || !settings.features.injection) {
            clearInjection();
            return;
        }
        try {
            await runInjection();
        } catch (e) {
            console.error('[BT] Injection hook failed:', e);
        }
    });

    // Chat changed — reload state, clear injections from previous chat
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearInjection();
        // getChatState() auto-detects the new chat ID on next call
        const settings = getGlobalSettings();
        if (settings.panel.visible) refreshActiveTab();
    });

    // Character changed — same handling
    eventSource.on(event_types.CHARACTER_CHANGED, () => {
        clearInjection();
    });
}

// ─── Settings Button in ST UI ─────────────────────────────────────────────────

function addSettingsButton() {
    // Add a button to ST's extensions panel so users can open the tracker from there
    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) return;

    const btn = document.createElement('div');
    btn.id = 'bt-extensions-btn';
    btn.className = 'list-group-item flex-container flexGap5';
    btn.innerHTML = `
        <span>💼</span>
        <span>Business Tracker</span>
    `;
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
        showPanel();
        // Switch to settings tab if this is the first open (panel was never configured)
        const settings = getGlobalSettings();
        if (!settings.api.endpoint && !settings.api.useSTConnection) {
            import('./src/panel.js').then(({ switchTab }) => switchTab('settings'));
        }
    });

    extensionsMenu.appendChild(btn);
}
