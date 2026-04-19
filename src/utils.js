/**
 * utils.js — Shared helpers for Business Tracker
 */

// ─── UUID ─────────────────────────────────────────────────────────────────────

export function uuid() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
              const r = (Math.random() * 16) | 0;
              return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          });
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export function isoNow() {
    return new Date().toISOString();
}

export function formatDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return iso;
    }
}

export function formatDateTime(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

// ─── Currency / Ledger Math ───────────────────────────────────────────────────

/**
 * Compute running balances for a single entity+currency pair from the ledger.
 * Returns a new array of entries with runningBalance filled in.
 */
export function computeRunningBalances(entries) {
    let balance = 0;
    return entries.map(e => {
        balance += e.amount;
        return { ...e, runningBalance: balance };
    });
}

/**
 * Summarise balances for a given entityId across all currencies.
 * Returns: [{ currencyId, currencyName, currencySymbol, balance }]
 */
export function getEntityBalances(entityId, ledger, currencies) {
    const totals = {};
    for (const entry of ledger) {
        if (entry.entityId !== entityId) continue;
        const cid = entry.currencyId;
        totals[cid] = (totals[cid] ?? 0) + entry.amount;
    }
    return Object.entries(totals).map(([cid, balance]) => {
        const currency = currencies.find(c => c.id === cid) ?? { name: cid, symbol: '' };
        return { currencyId: cid, currencyName: currency.name, currencySymbol: currency.symbol, balance };
    });
}

/**
 * Format a currency amount with symbol.
 */
export function formatAmount(amount, symbol = '') {
    const sign = amount >= 0 ? '+' : '';
    const formatted = Math.abs(amount).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
    return `${sign}${symbol}${formatted}`;
}

// ─── Template Interpolation ───────────────────────────────────────────────────

/**
 * Interpolate a template string with a data object.
 * Replaces {{key}} tokens. Missing keys render as '—'.
 *
 * Supports simple dot paths: {{affiliations.0.name}}
 * Supports array join: if value is an array, joins with ', '
 */
export function interpolate(template, data) {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const value = getNestedValue(data, key.trim());
        if (value === undefined || value === null || value === '') return '—';
        if (Array.isArray(value)) return value.join(', ');
        return String(value);
    });
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((cur, key) => {
        if (cur === null || cur === undefined) return undefined;
        return cur[key];
    }, obj);
}

// ─── String Helpers ───────────────────────────────────────────────────────────

export function truncate(str, maxLen = 60) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

export function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str) {
    return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// ─── Safe JSON Parse ──────────────────────────────────────────────────────────

/**
 * Parse JSON from an API response string.
 * Strips markdown code fences if present.
 * Returns null on failure.
 */
export function safeJsonParse(str) {
    if (!str) return null;
    try {
        // Strip ```json ... ``` or ``` ... ``` wrappers
        const clean = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        return JSON.parse(clean);
    } catch {
        return null;
    }
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

export function el(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
        if (key === 'class') element.className = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(element.style, val);
        else if (key.startsWith('on') && typeof val === 'function') {
            element.addEventListener(key.slice(2).toLowerCase(), val);
        } else {
            element.setAttribute(key, val);
        }
    }
    for (const child of children) {
        if (child === null || child === undefined) continue;
        if (typeof child === 'string') element.appendChild(document.createTextNode(child));
        else element.appendChild(child);
    }
    return element;
}

export function clearEl(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
}

// ─── Entity Display Helpers ───────────────────────────────────────────────────

export function personDisplayName(person) {
    if (!person) return 'Unknown';
    return person.name ?? 'Unnamed Person';
}

export function companyDisplayName(company) {
    if (!company) return 'Unknown';
    return company.name ?? 'Unnamed Company';
}

export const ECONOMIC_TIER_LABELS = {
    micro: 'Micro',
    small: 'Small',
    mid: 'Mid-size',
    large: 'Large',
    mega: 'Mega-corp',
};

export const INDICATOR_VALUE_LABELS = {
    very_low: 'Very Low',
    low: 'Low',
    stable: 'Stable',
    high: 'High',
    very_high: 'Very High',
    unknown: 'Unknown',
};

export const TREND_SYMBOLS = {
    improving: '↑',
    stable: '→',
    declining: '↓',
};

export const JOB_STATUS_LABELS = {
    pending: 'Pending',
    active: 'Active',
    completed: 'Completed',
    failed: 'Failed',
};

export const PROJECT_STATUS_LABELS = {
    planning: 'Planning',
    active: 'Active',
    on_hold: 'On Hold',
    completed: 'Completed',
    abandoned: 'Abandoned',
};
