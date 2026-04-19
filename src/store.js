/**
 * store.js — Business Tracker data layer
 * Handles all load/save operations and provides the canonical default state.
 * All data is per-chat. Each new chat starts as a blank slate.
 */

import { extension_settings, saveSettingsDebounced } from '../../../../scripts/extensions.js';
import { saveChat, getCurrentChatId } from '../../../../script.js';

export const EXT_NAME = 'business_tracker';

// ─── Default Prompts ──────────────────────────────────────────────────────────

export const DEFAULT_PROMPTS = {
    parseEntities: `Extract all people and companies from the provided messages.

For each person return:
- name
- type: "pc" or "npc"
- role (job title or occupation if determinable)
- affiliations (company names they are linked to, and the nature of that link)
- notes (any other relevant details)

For each company return:
- name
- industry
- description (what they do or produce)
- economicTier: one of "micro", "small", "mid", "large", "mega" (infer if not stated)
- notes

Cross-reference the provided existing entity list. If a parsed entity matches an existing one, include their ID and only return fields that have changed or can now be filled in.

Return only valid JSON in this shape:
{
  "persons": [],
  "companies": []
}

Do not include explanation, preamble, or markdown.`,

    parseLedger: `Extract all financial transactions from the provided messages.

For each transaction return:
- entityName (who the transaction belongs to)
- counterpartyName (who they transacted with, if determinable)
- amount (positive for income, negative for expense)
- currency (name or symbol as it appears in the text)
- category: one of "salary", "contract", "purchase", "sale", "bribe", "gift", "debt", "repayment", "fine", "other"
- description (brief, factual)
- messageIndex (index of the message this was extracted from)

Only include transactions that are concrete and completed. Do not include offers, negotiations, or hypotheticals.

Return only valid JSON in this shape:
{
  "transactions": []
}

Do not include explanation, preamble, or markdown.`,

    parseJobs: `Extract all jobs and contracts from the provided messages.

For each job return:
- title
- employerName
- employeeName
- status: one of "pending", "active", "completed", "failed"
- agreedPay (amount and currency, if stated)
- actualPaid (amount and currency, if payment has occurred)
- description (what the job entails)
- messageIndex (index of the message this was extracted from)

If an existing job matches, include its ID and return only fields that have changed.

Return only valid JSON in this shape:
{
  "jobs": []
}

Do not include explanation, preamble, or markdown.`,

    parseProjects: `Extract all projects from the provided messages. A project is a multi-stage or ongoing effort distinct from a single job.

For each project return:
- name
- clientName (if determinable)
- status: one of "planning", "active", "on_hold", "completed", "abandoned"
- stages (array of stage names and their status: "pending", "active", or "done")
- budget (amount and currency, if stated)
- spent (amount and currency, if determinable)
- targetDate (if mentioned)
- notes

If an existing project matches, include its ID and return only fields that have changed.

Return only valid JSON in this shape:
{
  "projects": []
}

Do not include explanation, preamble, or markdown.`,

    parseEconomy: `Analyse the provided messages for information about the broader economic conditions of the world.

Return:
- description (a concise factual summary of the current economic climate as implied by the messages)
- indicators (array of named conditions with a value and trend)
  - name (e.g. "Trade stability", "Food scarcity", "Black market activity")
  - value: one of "very_low", "low", "stable", "high", "very_high", "unknown"
  - trend: one of "improving", "stable", "declining"
  - notes (brief, factual)
- currencies (any named currencies, denominations, or exchange references found)
  - name
  - symbol (if determinable)

Only include what can be reasonably inferred from the text. Do not speculate beyond what is implied.

Return only valid JSON in this shape:
{
  "description": "",
  "indicators": [],
  "currencies": []
}

Do not include explanation, preamble, or markdown.`,

    mergeEntities: `You are given two entities that may or may not be the same person or company.

Determine if they refer to the same entity. If they do, return a merged version using the most complete and recent information from both. If they do not, return a flag indicating they are distinct.

Return only valid JSON in this shape:
{
  "match": true or false,
  "merged": { } or null
}

The merged object should follow the same schema as the input entities. Do not include explanation, preamble, or markdown.`,

    relevanceCheck: `Given the provided recent messages and entity list, return the IDs of entities that are directly relevant to the current context.

An entity is relevant if it is mentioned by name, strongly implied, or is the subject of ongoing action in the messages.

Return only valid JSON in this shape:
{
  "relevantIds": []
}

Do not include explanation, preamble, or markdown.`,
};

// ─── Default Injection Templates ─────────────────────────────────────────────

export const DEFAULT_TEMPLATES = {
    person: `[Person: {{name}}]
Type: {{type}}
Role: {{role}}
Affiliations: {{affiliations}}
Balance: {{balances}}
Notes: {{notes}}`,

    company: `[Company: {{name}}]
Industry: {{industry}}
Description: {{description}}
Scale: {{economicTier}}
Employees: {{employees}}
Revenue Estimate: {{revenueEstimate}}
Notes: {{notes}}`,
};

// ─── Default Global Settings ──────────────────────────────────────────────────
// These persist across all chats in extension_settings.

export const DEFAULT_GLOBAL_SETTINGS = {
    enabled: true,

    // API configuration
    api: {
        endpoint: '',
        apiKey: '',
        model: '',
        useSTConnection: false,      // if true, piggyback on ST's active connection
    },

    // Parse cadence
    parse: {
        autoParse: true,
        parseEveryN: 10,             // messages between entity/ledger/job/project parses
        economyEveryN: 30,           // messages between economy parses
    },

    // Feature toggles — each can be disabled independently
    features: {
        parseEntities: true,
        parseLedger: true,
        parseJobs: true,
        parseProjects: true,
        parseEconomy: true,
        injection: true,
    },

    // Injection settings
    injection: {
        relevanceCheckEnabled: true,
        relevanceLookback: 5,        // how many recent messages to check for relevance
        injectionDepth: 4,           // how deep in chat history to inject (ST lorebook depth)
    },

    // Panel UI state
    panel: {
        visible: false,
        x: 80,
        y: 80,
        width: 480,
        height: 600,
        collapsed: false,
        activeTab: 'people',
    },

    // Editable prompts — user can override any of these
    prompts: { ...DEFAULT_PROMPTS },

    // Editable injection templates
    templates: { ...DEFAULT_TEMPLATES },
};

// ─── Default Per-Chat State ───────────────────────────────────────────────────
// This is the blank slate for every new chat.

export function makeBlankChatState() {
    return {
        version: 1,
        meta: {
            lastParsedMessageIndex: 0,
            messagesSinceLastParse: 0,
            messagesSinceEconomyParse: 0,
        },
        economy: {
            lastUpdated: null,
            enabled: true,           // per-chat override
            description: '',
            indicators: [],
            currencies: [],
        },
        persons: [],      // { id, type, name, role, affiliations, currencies, notes, parsedFrom }
        companies: [],    // { id, name, industry, description, economicTier, revenueEstimate, employees, notes, parsedFrom }
        ledger: [],       // { id, date, entityId, currencyId, amount, category, description, linkedJobId, linkedProjectId, linkedEntityId, messageIndex, tags, runningBalance }
        jobs: [],         // { id, title, employerId, employeeId, status, agreedPay, actualPaid, description, notes }
        projects: [],     // { id, name, clientId, status, stages, budget, spent, targetDate, notes }
    };
}

// ─── Global Settings Accessors ────────────────────────────────────────────────

export function getGlobalSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(DEFAULT_GLOBAL_SETTINGS);
    }
    // Fill in any missing keys from defaults (handles extension updates)
    extension_settings[EXT_NAME] = deepMergeDefaults(
        DEFAULT_GLOBAL_SETTINGS,
        extension_settings[EXT_NAME]
    );
    return extension_settings[EXT_NAME];
}

export function saveGlobalSettings() {
    saveSettingsDebounced();
}

export function updateGlobalSetting(path, value) {
    const settings = getGlobalSettings();
    setNestedValue(settings, path, value);
    saveGlobalSettings();
}

// ─── Per-Chat State Accessors ─────────────────────────────────────────────────
// ST stores per-chat extension data in the chat metadata object.
// We read/write from chat_metadata.business_tracker.

let _chatState = null;
let _chatId = null;

export function getChatState() {
    const currentId = getCurrentChatId();

    // If chat changed or no state loaded, init fresh
    if (currentId !== _chatId || _chatState === null) {
        _chatId = currentId;
        _chatState = loadChatState();
    }
    return _chatState;
}

export function saveChatState() {
    if (_chatState === null) return;
    // Write into ST's chat metadata — ST will persist this when it saves the chat
    if (typeof window.chat_metadata === 'undefined') {
        window.chat_metadata = {};
    }
    window.chat_metadata[EXT_NAME] = _chatState;
    saveChat();
}

export function resetChatState() {
    _chatState = makeBlankChatState();
    saveChatState();
    return _chatState;
}

function loadChatState() {
    if (typeof window.chat_metadata !== 'undefined' && window.chat_metadata[EXT_NAME]) {
        // Merge with blank state to fill any missing keys from new versions
        return deepMergeDefaults(makeBlankChatState(), window.chat_metadata[EXT_NAME]);
    }
    return makeBlankChatState();
}

// ─── Entity Helpers ───────────────────────────────────────────────────────────

export function getPersonById(id) {
    return getChatState().persons.find(p => p.id === id) ?? null;
}

export function getCompanyById(id) {
    return getChatState().companies.find(c => c.id === id) ?? null;
}

export function upsertPerson(person) {
    const state = getChatState();
    const idx = state.persons.findIndex(p => p.id === person.id);
    if (idx >= 0) {
        state.persons[idx] = { ...state.persons[idx], ...person };
    } else {
        state.persons.push(person);
    }
    saveChatState();
}

export function upsertCompany(company) {
    const state = getChatState();
    const idx = state.companies.findIndex(c => c.id === company.id);
    if (idx >= 0) {
        state.companies[idx] = { ...state.companies[idx], ...company };
    } else {
        state.companies.push(company);
    }
    saveChatState();
}

export function deletePerson(id) {
    const state = getChatState();
    state.persons = state.persons.filter(p => p.id !== id);
    saveChatState();
}

export function deleteCompany(id) {
    const state = getChatState();
    state.companies = state.companies.filter(c => c.id !== id);
    saveChatState();
}

export function addLedgerEntry(entry) {
    const state = getChatState();
    state.ledger.push(entry);
    saveChatState();
}

export function upsertJob(job) {
    const state = getChatState();
    const idx = state.jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
        state.jobs[idx] = { ...state.jobs[idx], ...job };
    } else {
        state.jobs.push(job);
    }
    saveChatState();
}

export function upsertProject(project) {
    const state = getChatState();
    const idx = state.projects.findIndex(p => p.id === project.id);
    if (idx >= 0) {
        state.projects[idx] = { ...state.projects[idx], ...project };
    } else {
        state.projects.push(project);
    }
    saveChatState();
}

export function updateEconomy(economyData) {
    const state = getChatState();
    state.economy = { ...state.economy, ...economyData, lastUpdated: new Date().toISOString() };
    saveChatState();
}

// ─── Utility: Deep Merge Defaults ─────────────────────────────────────────────
// Fills missing keys from defaults without overwriting existing values.

function deepMergeDefaults(defaults, target) {
    const result = { ...target };
    for (const key of Object.keys(defaults)) {
        if (!(key in result)) {
            result[key] = structuredClone(defaults[key]);
        } else if (
            typeof defaults[key] === 'object' &&
            defaults[key] !== null &&
            !Array.isArray(defaults[key]) &&
            typeof result[key] === 'object' &&
            result[key] !== null &&
            !Array.isArray(result[key])
        ) {
            result[key] = deepMergeDefaults(defaults[key], result[key]);
        }
    }
    return result;
}

// ─── Utility: Set Nested Value by Dot Path ────────────────────────────────────

function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in cur)) cur[keys[i]] = {};
        cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
}
