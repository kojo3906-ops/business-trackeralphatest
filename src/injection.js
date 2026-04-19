/**
 * injection.js — Lorebook-style silent entity injection
 * Checks which entities are relevant to the current context,
 * then injects their formatted cards as silent messages at the configured depth.
 */

import { getGlobalSettings, getChatState } from './store.js';
import { getRelevantEntityIds } from './parser.js';
import { interpolate } from './utils.js';

// ─── Main Injection Hook ──────────────────────────────────────────────────────

/**
 * Called before each message generation.
 * Builds and registers injections into ST's context via the injection API.
 */
export async function runInjection() {
    const settings = getGlobalSettings();
    if (!settings.enabled) return;
    if (!settings.features.injection) return;

    const state = getChatState();
    if (state.persons.length === 0 && state.companies.length === 0) return;

    // Determine which entities are relevant
    let relevantIds;
    try {
        relevantIds = await getRelevantEntityIds();
    } catch (e) {
        console.error('[BT] Injection relevance check failed:', e);
        return;
    }

    if (relevantIds.length === 0) return;

    const injectionDepth = settings.injection.injectionDepth ?? 4;
    const personTemplate = settings.templates.person;
    const companyTemplate = settings.templates.company;

    const injectionBlocks = [];

    // Inject relevant persons
    for (const person of state.persons) {
        if (!relevantIds.includes(person.id)) continue;
        const text = formatPersonCard(person, state, personTemplate);
        if (text) injectionBlocks.push(text);
    }

    // Inject relevant companies
    for (const company of state.companies) {
        if (!relevantIds.includes(company.id)) continue;
        const text = formatCompanyCard(company, state, companyTemplate);
        if (text) injectionBlocks.push(text);
    }

    if (injectionBlocks.length === 0) return;

    const combinedInjection = injectionBlocks.join('\n\n');

    // Use ST's setExtensionPrompt API to inject as a lorebook-style entry
    if (typeof window.setExtensionPrompt === 'function') {
        window.setExtensionPrompt(
            'BUSINESS_TRACKER',         // unique key
            combinedInjection,
            injectionDepth,             // position/depth
            injectionDepth,             // scan depth
        );
    }
}

/**
 * Clear all injections (e.g. when extension is disabled or chat changes).
 */
export function clearInjection() {
    if (typeof window.setExtensionPrompt === 'function') {
        window.setExtensionPrompt('BUSINESS_TRACKER', '', 0, 0);
    }
}

// ─── Template Formatters ──────────────────────────────────────────────────────

function formatPersonCard(person, state, template) {
    // Build affiliations string
    const affiliations = (person.affiliations ?? [])
        .map(aff => {
            const company = state.companies.find(c => c.id === aff.companyId);
            const name = company?.name ?? aff.companyName ?? aff.companyId ?? '?';
            return `${name} (${aff.relationshipType ?? 'affiliated'})`;
        })
        .join(', ') || '—';

    // Build balances string
    const balances = buildBalanceSummary(person.id, state);

    return interpolate(template, {
        name: person.name ?? '?',
        type: person.type === 'pc' ? 'Player Character' : 'NPC',
        role: person.role ?? '—',
        affiliations,
        balances: balances || '—',
        notes: person.notes ?? '—',
    });
}

function formatCompanyCard(company, state, template) {
    // Build employee list
    const employees = state.persons
        .filter(p => p.affiliations?.some(a => a.companyId === company.id))
        .map(p => {
            const aff = p.affiliations.find(a => a.companyId === company.id);
            return `${p.name} (${aff?.relationshipType ?? 'affiliated'})`;
        })
        .join(', ') || '—';

    // Revenue estimate
    let revenueStr = '—';
    if (company.revenueEstimate) {
        const rev = company.revenueEstimate;
        const currency = state.economy.currencies.find(c => c.id === rev.currencyId);
        revenueStr = `${currency?.symbol ?? ''}${rev.amount ?? '?'} / ${rev.period ?? 'period'}`;
    }

    return interpolate(template, {
        name: company.name ?? '?',
        industry: company.industry ?? '—',
        description: company.description ?? '—',
        economicTier: company.economicTier ?? '—',
        employees,
        revenueEstimate: revenueStr,
        notes: company.notes ?? '—',
    });
}

function buildBalanceSummary(entityId, state) {
    const totals = {};
    for (const entry of state.ledger) {
        if (entry.entityId !== entityId) continue;
        totals[entry.currencyId] = (totals[entry.currencyId] ?? 0) + entry.amount;
    }
    return Object.entries(totals)
        .map(([cid, bal]) => {
            const cur = state.economy.currencies.find(c => c.id === cid);
            return `${cur?.symbol ?? ''}${bal.toLocaleString()} ${cur?.name ?? cid}`;
        })
        .join(', ');
}
