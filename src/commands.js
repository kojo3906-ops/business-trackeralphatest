/**
 * commands.js — Slash command registration for Business Tracker
 * All commands can be used in chat to interact with the tracker.
 */

import { getChatState, saveChatState, addLedgerEntry, upsertJob, upsertProject } from './store.js';
import { onNewMessage } from './parser.js';
import { togglePanel, showPanel, refreshActiveTab } from './panel.js';
import { uuid, isoNow } from './utils.js';

/**
 * Register all slash commands with SillyTavern's slash command system.
 * Called once during extension init.
 */
export function registerCommands() {
    if (typeof window.registerSlashCommand !== 'function') {
        console.warn('[BT] registerSlashCommand not available — commands not registered.');
        return;
    }

    // ── /bt — toggle panel ──
    window.registerSlashCommand('bt', () => {
        togglePanel();
    }, [], '(Business Tracker) Toggle the Business Tracker panel.', true, true);

    // ── /bt-parse — force a full parse ──
    window.registerSlashCommand('bt-parse', async () => {
        toastInChat('Business Tracker: Parsing chat…');
        try {
            await onNewMessage(true);
            toastInChat('Business Tracker: Parse complete.');
            refreshActiveTab();
        } catch (e) {
            toastInChat('Business Tracker: Parse failed. Check console.', true);
            console.error('[BT] /bt-parse error:', e);
        }
    }, [], '(Business Tracker) Force a full parse of the current chat.', true, true);

    // ── /bt-add-money [amount] [currency] [entity] [category] [description] ──
    window.registerSlashCommand('bt-add-money', (args, value) => {
        const parts = (value ?? '').trim().split('|').map(s => s.trim());
        // Format: amount | currency | entity name | category | description
        const [amountStr, currencyName, entityName, category, ...descParts] = parts;
        const amount = parseFloat(amountStr);
        if (isNaN(amount)) {
            toastInChat('Usage: /bt-add-money amount | currency | entity | category | description', true);
            return;
        }
        addTransactionFromCommand(amount, currencyName, entityName, category ?? 'other', descParts.join('|'));
    }, [], '(Business Tracker) Add income. Format: /bt-add-money amount | currency | entity | category | description', true, true);

    // ── /bt-spend [amount] | [currency] | [entity] | [category] | [description] ──
    window.registerSlashCommand('bt-spend', (args, value) => {
        const parts = (value ?? '').trim().split('|').map(s => s.trim());
        const [amountStr, currencyName, entityName, category, ...descParts] = parts;
        const amount = parseFloat(amountStr);
        if (isNaN(amount)) {
            toastInChat('Usage: /bt-spend amount | currency | entity | category | description', true);
            return;
        }
        addTransactionFromCommand(-Math.abs(amount), currencyName, entityName, category ?? 'other', descParts.join('|'));
    }, [], '(Business Tracker) Add expense. Format: /bt-spend amount | currency | entity | category | description', true, true);

    // ── /bt-job-complete [job name] ──
    window.registerSlashCommand('bt-job-complete', (args, value) => {
        const jobName = (value ?? '').trim();
        if (!jobName) { toastInChat('Usage: /bt-job-complete job name', true); return; }
        const state = getChatState();
        const job = state.jobs.find(j => j.title?.toLowerCase().includes(jobName.toLowerCase()));
        if (!job) { toastInChat(`No job found matching "${jobName}"`, true); return; }
        job.status = 'completed';
        saveChatState();
        toastInChat(`Job "${job.title}" marked as completed.`);
        refreshActiveTab();
    }, [], '(Business Tracker) Mark a job as completed by name.', true, true);

    // ── /bt-stage-done [project name] | [stage name] ──
    window.registerSlashCommand('bt-stage-done', (args, value) => {
        const parts = (value ?? '').split('|').map(s => s.trim());
        const [projectName, stageName] = parts;
        if (!projectName || !stageName) {
            toastInChat('Usage: /bt-stage-done project name | stage name', true);
            return;
        }
        const state = getChatState();
        const project = state.projects.find(p => p.name?.toLowerCase().includes(projectName.toLowerCase()));
        if (!project) { toastInChat(`No project found matching "${projectName}"`, true); return; }
        const stage = project.stages?.find(s => s.name?.toLowerCase().includes(stageName.toLowerCase()));
        if (!stage) { toastInChat(`No stage found matching "${stageName}"`, true); return; }
        stage.status = 'done';
        stage.completedDate = isoNow();
        saveChatState();
        toastInChat(`Stage "${stage.name}" in "${project.name}" marked as done.`);
        refreshActiveTab();
    }, [], '(Business Tracker) Mark a project stage as done. Format: /bt-stage-done project | stage', true, true);

    // ── /bt-balance ──
    window.registerSlashCommand('bt-balance', () => {
        const state = getChatState();
        const userName = window.name1 ?? 'User';
        const pc = state.persons.find(p =>
            p.type === 'pc' || p.name?.toLowerCase() === userName.toLowerCase()
        );
        if (!pc) { toastInChat('No player character found in tracker.', true); return; }

        const totals = {};
        for (const entry of state.ledger) {
            if (entry.entityId !== pc.id) continue;
            totals[entry.currencyId] = (totals[entry.currencyId] ?? 0) + entry.amount;
        }
        const lines = Object.entries(totals).map(([cid, bal]) => {
            const cur = state.economy.currencies.find(c => c.id === cid);
            return `${cur?.symbol ?? ''}${bal.toLocaleString()} ${cur?.name ?? cid}`;
        });

        const summary = lines.length > 0
            ? `[Business Tracker] ${pc.name}'s balance: ${lines.join(' | ')}`
            : `[Business Tracker] ${pc.name} has no recorded transactions.`;

        // Post as a system-style message in chat
        if (typeof window.sendSystemMessage === 'function') {
            window.sendSystemMessage(window.system_message_types?.GENERIC, summary);
        } else {
            toastInChat(summary);
        }
    }, [], '(Business Tracker) Post the player character\'s current balance to chat.', true, true);

    // ── /bt-reset — reset this chat's tracker data ──
    window.registerSlashCommand('bt-reset', () => {
        if (!confirm('Reset all Business Tracker data for this chat? This cannot be undone.')) return;
        import('./store.js').then(({ resetChatState }) => {
            resetChatState();
            toastInChat('Business Tracker: Chat data reset.');
            refreshActiveTab();
        });
    }, [], '(Business Tracker) Reset all tracker data for the current chat.', true, true);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addTransactionFromCommand(amount, currencyName, entityName, category, description) {
    const state = getChatState();

    const entity = entityName
        ? (state.persons.find(p => p.name?.toLowerCase() === entityName.toLowerCase()) ??
           state.companies.find(c => c.name?.toLowerCase() === entityName.toLowerCase()) ??
           // Fall back to PC if not found
           state.persons.find(p => p.type === 'pc'))
        : state.persons.find(p => p.type === 'pc');

    if (!entity) {
        toastInChat('Business Tracker: No matching entity found. Add people first.', true);
        return;
    }

    const currency = state.economy.currencies.find(
        c => c.name.toLowerCase() === (currencyName ?? '').toLowerCase() ||
             c.symbol.toLowerCase() === (currencyName ?? '').toLowerCase()
    ) ?? state.economy.currencies[0] ?? { id: 'unknown', name: currencyName ?? 'Unknown', symbol: '' };

    const priorBalance = state.ledger
        .filter(e => e.entityId === entity.id && e.currencyId === currency.id)
        .reduce((sum, e) => sum + e.amount, 0);

    addLedgerEntry({
        id: uuid(),
        date: isoNow(),
        entityId: entity.id,
        entityName: entity.name,
        counterpartyId: null,
        currencyId: currency.id,
        amount,
        category,
        description: description || (amount >= 0 ? 'Manual income entry' : 'Manual expense entry'),
        linkedJobId: null,
        linkedProjectId: null,
        messageIndex: null,
        tags: ['manual'],
        runningBalance: priorBalance + amount,
    });

    const sign = amount >= 0 ? '+' : '';
    toastInChat(`Business Tracker: ${sign}${currency.symbol}${Math.abs(amount)} ${currency.name} logged for ${entity.name}.`);
    refreshActiveTab();
}

function toastInChat(message, isError = false) {
    // Try ST's toastr if available, fall back to console
    if (typeof window.toastr !== 'undefined') {
        if (isError) window.toastr.error(message);
        else window.toastr.info(message);
    } else {
        console.log(`[BT] ${message}`);
    }
}
