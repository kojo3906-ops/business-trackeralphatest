/**
 * parser.js — All API calls and parse logic for Business Tracker
 * Reads settings for endpoint/key/model, dispatches prompts, merges results into store.
 */

import {
    getGlobalSettings,
    getChatState,
    saveChatState,
    upsertPerson,
    upsertCompany,
    addLedgerEntry,
    upsertJob,
    upsertProject,
    updateEconomy,
} from './store.js';
import { uuid, isoNow, safeJsonParse } from './utils.js';

// ─── API Call ─────────────────────────────────────────────────────────────────

async function callApi(systemPrompt, userContent) {
    const settings = getGlobalSettings();

    let endpoint = '';
    let apiKey = '';
    let model = '';

    if (settings.api.useSTConnection) {
        // Piggyback on ST's active connection
        endpoint = window.oai_settings?.reverse_proxy || 'https://api.openai.com/v1';
        apiKey = window.oai_settings?.openai_api_key || '';
        model = window.oai_settings?.openai_model || 'gpt-4o-mini';
    } else {
        endpoint = settings.api.endpoint;
        apiKey = settings.api.apiKey;
        model = settings.api.model;
    }

    if (!endpoint) throw new Error('[BT] No API endpoint configured.');

    const url = endpoint.replace(/\/$/, '') + '/chat/completions';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
            ],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`[BT] API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
}

// ─── Message Slice Builder ────────────────────────────────────────────────────

/**
 * Returns a formatted string of chat messages from startIndex to endIndex.
 * Uses SillyTavern's global `chat` array.
 */
function buildMessageSlice(startIndex, endIndex) {
    const chat = window.chat ?? [];
    const slice = chat.slice(startIndex, endIndex + 1);
    return slice
        .map((msg, i) => {
            const speaker = msg.is_user ? (window.name1 ?? 'User') : (msg.name ?? 'Assistant');
            return `[${startIndex + i}] ${speaker}: ${msg.mes}`;
        })
        .join('\n\n');
}

function buildFullHistory() {
    const chat = window.chat ?? [];
    return buildMessageSlice(0, chat.length - 1);
}

// ─── Master Parse Trigger ─────────────────────────────────────────────────────

/**
 * Called on each new message. Increments counters and dispatches parses
 * when thresholds are hit. Can also be called manually (force = true).
 */
export async function onNewMessage(force = false) {
    const settings = getGlobalSettings();
    if (!settings.enabled) return;
    if (!settings.parse.autoParse && !force) return;

    const state = getChatState();
    const chat = window.chat ?? [];
    const latestIndex = chat.length - 1;

    state.meta.messagesSinceLastParse += 1;
    state.meta.messagesSinceEconomyParse += 1;

    const shouldParse = force || state.meta.messagesSinceLastParse >= settings.parse.parseEveryN;
    const shouldParseEconomy = force || state.meta.messagesSinceEconomyParse >= settings.parse.economyEveryN;

    if (shouldParse) {
        const startIndex = state.meta.lastParsedMessageIndex;
        const endIndex = latestIndex;
        const slice = buildMessageSlice(startIndex, endIndex);

        const tasks = [];

        if (settings.features.parseEntities)  tasks.push(parseEntities(slice, state));
        if (settings.features.parseLedger)     tasks.push(parseLedger(slice, state));
        if (settings.features.parseJobs)       tasks.push(parseJobs(slice, state));
        if (settings.features.parseProjects)   tasks.push(parseProjects(slice, state));

        // Run in parallel where possible
        await Promise.allSettled(tasks);

        state.meta.lastParsedMessageIndex = endIndex + 1;
        state.meta.messagesSinceLastParse = 0;
    }

    if (shouldParseEconomy && settings.features.parseEconomy) {
        await parseEconomy(state);
        state.meta.messagesSinceEconomyParse = 0;
    }

    saveChatState();
}

// ─── Parse: Entities ─────────────────────────────────────────────────────────

async function parseEntities(slice, state) {
    const settings = getGlobalSettings();
    const prompt = settings.prompts.parseEntities;

    const existingList = [
        ...state.persons.map(p => ({ id: p.id, name: p.name, type: 'person' })),
        ...state.companies.map(c => ({ id: c.id, name: c.name, type: 'company' })),
    ];

    const userContent = `Existing entities:\n${JSON.stringify(existingList)}\n\nMessages:\n${slice}`;

    let raw;
    try {
        raw = await callApi(prompt, userContent);
    } catch (e) {
        console.error('[BT] parseEntities failed:', e);
        return;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed) { console.warn('[BT] parseEntities: bad JSON', raw); return; }

    // Handle persons
    for (const p of (parsed.persons ?? [])) {
        if (p.id) {
            // Update existing
            upsertPerson({ ...p });
        } else {
            // Potentially new — run merge check against existing persons
            const merged = await tryMerge(p, state.persons, settings.prompts.mergeEntities);
            if (merged) {
                upsertPerson(merged);
            } else {
                upsertPerson({ ...p, id: uuid(), parsedFrom: [] });
            }
        }
    }

    // Handle companies
    for (const c of (parsed.companies ?? [])) {
        if (c.id) {
            upsertCompany({ ...c });
        } else {
            const merged = await tryMerge(c, state.companies, settings.prompts.mergeEntities);
            if (merged) {
                upsertCompany(merged);
            } else {
                upsertCompany({ ...c, id: uuid(), parsedFrom: [] });
            }
        }
    }
}

// ─── Parse: Ledger ────────────────────────────────────────────────────────────

async function parseLedger(slice, state) {
    const settings = getGlobalSettings();
    const prompt = settings.prompts.parseLedger;

    const entityNames = [
        ...state.persons.map(p => ({ id: p.id, name: p.name })),
        ...state.companies.map(c => ({ id: c.id, name: c.name })),
    ];
    const currencies = state.economy.currencies;

    const userContent = `Entities:\n${JSON.stringify(entityNames)}\nCurrencies:\n${JSON.stringify(currencies)}\n\nMessages:\n${slice}`;

    let raw;
    try {
        raw = await callApi(prompt, userContent);
    } catch (e) {
        console.error('[BT] parseLedger failed:', e);
        return;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed) { console.warn('[BT] parseLedger: bad JSON', raw); return; }

    for (const tx of (parsed.transactions ?? [])) {
        // Resolve entity ID by name
        const entity = findEntityByName(tx.entityName, state);
        const counterparty = tx.counterpartyName ? findEntityByName(tx.counterpartyName, state) : null;
        const currency = findOrCreateCurrency(tx.currency, state);

        // Compute running balance for this entity+currency
        const priorEntries = state.ledger.filter(
            e => e.entityId === (entity?.id ?? tx.entityName) && e.currencyId === currency.id
        );
        const priorBalance = priorEntries.reduce((sum, e) => sum + e.amount, 0);

        addLedgerEntry({
            id: uuid(),
            date: isoNow(),
            entityId: entity?.id ?? tx.entityName,
            entityName: tx.entityName,
            counterpartyId: counterparty?.id ?? null,
            currencyId: currency.id,
            amount: tx.amount,
            category: tx.category ?? 'other',
            description: tx.description ?? '',
            linkedJobId: null,
            linkedProjectId: null,
            messageIndex: tx.messageIndex ?? null,
            tags: [],
            runningBalance: priorBalance + tx.amount,
        });
    }
}

// ─── Parse: Jobs ─────────────────────────────────────────────────────────────

async function parseJobs(slice, state) {
    const settings = getGlobalSettings();
    const prompt = settings.prompts.parseJobs;

    const entityNames = [
        ...state.persons.map(p => ({ id: p.id, name: p.name })),
        ...state.companies.map(c => ({ id: c.id, name: c.name })),
    ];

    const userContent = `Entities:\n${JSON.stringify(entityNames)}\nExisting jobs:\n${JSON.stringify(state.jobs)}\n\nMessages:\n${slice}`;

    let raw;
    try {
        raw = await callApi(prompt, userContent);
    } catch (e) {
        console.error('[BT] parseJobs failed:', e);
        return;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed) { console.warn('[BT] parseJobs: bad JSON', raw); return; }

    for (const job of (parsed.jobs ?? [])) {
        const employer = job.employerName ? findEntityByName(job.employerName, state) : null;
        const employee = job.employeeName ? findEntityByName(job.employeeName, state) : null;
        upsertJob({
            id: job.id ?? uuid(),
            title: job.title ?? 'Untitled Job',
            employerId: employer?.id ?? null,
            employerName: job.employerName ?? null,
            employeeId: employee?.id ?? null,
            employeeName: job.employeeName ?? null,
            status: job.status ?? 'pending',
            agreedPay: job.agreedPay ?? null,
            actualPaid: job.actualPaid ?? null,
            description: job.description ?? '',
            notes: job.notes ?? '',
        });
    }
}

// ─── Parse: Projects ──────────────────────────────────────────────────────────

async function parseProjects(slice, state) {
    const settings = getGlobalSettings();
    const prompt = settings.prompts.parseProjects;

    const entityNames = [
        ...state.persons.map(p => ({ id: p.id, name: p.name })),
        ...state.companies.map(c => ({ id: c.id, name: c.name })),
    ];

    const userContent = `Entities:\n${JSON.stringify(entityNames)}\nExisting projects:\n${JSON.stringify(state.projects)}\n\nMessages:\n${slice}`;

    let raw;
    try {
        raw = await callApi(prompt, userContent);
    } catch (e) {
        console.error('[BT] parseProjects failed:', e);
        return;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed) { console.warn('[BT] parseProjects: bad JSON', raw); return; }

    for (const proj of (parsed.projects ?? [])) {
        const client = proj.clientName ? findEntityByName(proj.clientName, state) : null;
        upsertProject({
            id: proj.id ?? uuid(),
            name: proj.name ?? 'Untitled Project',
            clientId: client?.id ?? null,
            clientName: proj.clientName ?? null,
            status: proj.status ?? 'planning',
            stages: (proj.stages ?? []).map(s => ({
                id: s.id ?? uuid(),
                name: s.name ?? '',
                status: s.status ?? 'pending',
                payout: s.payout ?? null,
                completedDate: s.completedDate ?? null,
            })),
            budget: proj.budget ?? null,
            spent: proj.spent ?? null,
            targetDate: proj.targetDate ?? null,
            notes: proj.notes ?? '',
        });
    }
}

// ─── Parse: Economy ───────────────────────────────────────────────────────────

async function parseEconomy(state) {
    const settings = getGlobalSettings();
    if (!state.economy.enabled) return;

    const prompt = settings.prompts.parseEconomy;
    const history = buildFullHistory();
    const userContent = `Current economy state:\n${JSON.stringify(state.economy)}\n\nFull chat history:\n${history}`;

    let raw;
    try {
        raw = await callApi(prompt, userContent);
    } catch (e) {
        console.error('[BT] parseEconomy failed:', e);
        return;
    }

    const parsed = safeJsonParse(raw);
    if (!parsed) { console.warn('[BT] parseEconomy: bad JSON', raw); return; }

    // Merge currencies into economy state
    const existingCurrencyNames = new Set(state.economy.currencies.map(c => c.name.toLowerCase()));
    for (const cur of (parsed.currencies ?? [])) {
        if (!existingCurrencyNames.has(cur.name.toLowerCase())) {
            state.economy.currencies.push({ id: uuid(), name: cur.name, symbol: cur.symbol ?? '' });
        }
    }

    updateEconomy({
        description: parsed.description ?? state.economy.description,
        indicators: parsed.indicators ?? state.economy.indicators,
        currencies: state.economy.currencies,
    });
}

// ─── Merge Helper ─────────────────────────────────────────────────────────────

/**
 * Try to merge a newly parsed entity with the closest match in existingList.
 * Returns the merged entity (with ID) if a match is found, null otherwise.
 */
async function tryMerge(newEntity, existingList, mergePrompt) {
    // Simple name-based pre-filter before sending to API
    const candidates = existingList.filter(e =>
        e.name && newEntity.name &&
        e.name.toLowerCase().includes(newEntity.name.toLowerCase().split(' ')[0])
    );

    if (candidates.length === 0) return null;

    for (const candidate of candidates.slice(0, 3)) {
        let raw;
        try {
            raw = await callApi(
                mergePrompt,
                `Entity A:\n${JSON.stringify(candidate)}\n\nEntity B:\n${JSON.stringify(newEntity)}`
            );
        } catch (e) {
            console.error('[BT] mergeEntities failed:', e);
            continue;
        }

        const result = safeJsonParse(raw);
        if (result?.match && result.merged) {
            return { ...result.merged, id: candidate.id };
        }
    }

    return null;
}

// ─── Relevance Check ─────────────────────────────────────────────────────────

/**
 * Returns an array of entity IDs relevant to the last N messages.
 * Returns all entity IDs if the feature is disabled.
 */
export async function getRelevantEntityIds() {
    const settings = getGlobalSettings();
    const state = getChatState();

    if (!settings.features.injection) return [];
    if (!settings.injection.relevanceCheckEnabled) {
        return [
            ...state.persons.map(p => p.id),
            ...state.companies.map(c => c.id),
        ];
    }

    const chat = window.chat ?? [];
    const lookback = settings.injection.relevanceLookback;
    const startIndex = Math.max(0, chat.length - lookback);
    const slice = buildMessageSlice(startIndex, chat.length - 1);

    const entityList = [
        ...state.persons.map(p => ({ id: p.id, name: p.name })),
        ...state.companies.map(c => ({ id: c.id, name: c.name })),
    ];

    const userContent = `Entities:\n${JSON.stringify(entityList)}\n\nRecent messages:\n${slice}`;

    let raw;
    try {
        raw = await callApi(settings.prompts.relevanceCheck, userContent);
    } catch (e) {
        console.error('[BT] relevanceCheck failed:', e);
        return [];
    }

    const parsed = safeJsonParse(raw);
    return parsed?.relevantIds ?? [];
}

// ─── Utility: Entity Lookup ───────────────────────────────────────────────────

function findEntityByName(name, state) {
    if (!name) return null;
    const lower = name.toLowerCase();
    return (
        state.persons.find(p => p.name?.toLowerCase() === lower) ??
        state.companies.find(c => c.name?.toLowerCase() === lower) ??
        null
    );
}

function findOrCreateCurrency(nameOrSymbol, state) {
    if (!nameOrSymbol) return { id: 'unknown', name: 'Unknown', symbol: '' };
    const lower = nameOrSymbol.toLowerCase();
    const existing = state.economy.currencies.find(
        c => c.name.toLowerCase() === lower || c.symbol.toLowerCase() === lower
    );
    if (existing) return existing;

    // Create on the fly and add to economy currencies
    const newCur = { id: uuid(), name: nameOrSymbol, symbol: nameOrSymbol.slice(0, 3) };
    state.economy.currencies.push(newCur);
    return newCur;
}
