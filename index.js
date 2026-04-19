// Business Tracker - SillyTavern Extension
// Tracks money, companies, projects, and jobs per chat with global settings.

import { saveSettingsDebounced, getRequestHeaders } from '../../../../script.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';

const EXT_NAME = 'business_tracker';
const PANEL_ID = 'bt-panel';

// ─── Default structures ────────────────────────────────────────────────────────

const defaultGlobalSettings = {
  realCurrencyCode: 'AUD',
  realCurrencySymbol: '$',
  customCurrencyName: 'Credits',
  customCurrencySymbol: '₢',
  panelWidth: 420,
  panelTop: 80,
  defaultEconomyScope: 'shared', // 'shared' | 'per_character'
};

const defaultChatData = () => ({
  // Economy
  economy: {
    shared: { real: 0, custom: 0 },
    characters: {}, // { [name]: { real: 0, custom: 0 } }
    user: { real: 0, custom: 0 },
    transactions: [], // { id, date, from, to, amount, currency, note }
  },
  // Companies
  companies: [], // { id, name, type, relation, notes, contacts: [] }
  // Projects
  projects: [], // { id, name, company, status, dueDate, budget, earned, notes }
  // Jobs
  jobs: [], // { id, title, company, character, status, pay, payType, startDate, endDate, notes }
});

const STATUS_LIST = ['active', 'pending', 'on_hold', 'completed', 'failed'];
const STATUS_LABELS = {
  active: '▶ Active',
  pending: '◌ Pending',
  on_hold: '⏸ On Hold',
  completed: '✔ Completed',
  failed: '✖ Failed',
};
const STATUS_COLORS = {
  active: '#4ade80',
  pending: '#facc15',
  on_hold: '#60a5fa',
  completed: '#a78bfa',
  failed: '#f87171',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getGlobal() {
  if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = { ...defaultGlobalSettings };
  return extension_settings[EXT_NAME];
}

function getChatData() {
  const ctx = getContext();
  if (!ctx.chatMetadata) return null;
  if (!ctx.chatMetadata[EXT_NAME]) ctx.chatMetadata[EXT_NAME] = defaultChatData();
  return ctx.chatMetadata[EXT_NAME];
}

function saveChat() {
  saveMetadataDebounced();
}

function fmt(amount, currency) {
  const g = getGlobal();
  if (currency === 'real') return `${g.realCurrencySymbol}${Number(amount).toFixed(2)}`;
  return `${g.customCurrencySymbol}${Number(amount).toFixed(2)}`;
}

function getCurrentChars() {
  try {
    const ctx = getContext();
    const chars = new Set();
    if (ctx.characters) ctx.characters.forEach(c => c.name && chars.add(c.name));
    if (ctx.name2) chars.add(ctx.name2);
    return [...chars];
  } catch { return []; }
}

// ─── Panel construction ────────────────────────────────────────────────────────

function buildPanel() {
  const g = getGlobal();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div id="bt-header">
      <span id="bt-drag-handle">⠿</span>
      <span id="bt-title">📊 Business Tracker</span>
      <div id="bt-header-actions">
        <button class="bt-icon-btn" id="bt-settings-btn" title="Global Settings">⚙</button>
        <button class="bt-icon-btn" id="bt-close-btn" title="Close">✕</button>
      </div>
    </div>

    <div id="bt-tabs">
      <button class="bt-tab active" data-tab="economy">💰 Finance</button>
      <button class="bt-tab" data-tab="companies">🏢 Companies</button>
      <button class="bt-tab" data-tab="projects">📁 Projects</button>
      <button class="bt-tab" data-tab="jobs">💼 Jobs</button>
    </div>

    <div id="bt-body">
      <div class="bt-pane active" id="bt-pane-economy"></div>
      <div class="bt-pane" id="bt-pane-companies"></div>
      <div class="bt-pane" id="bt-pane-projects"></div>
      <div class="bt-pane" id="bt-pane-jobs"></div>
    </div>

    <div id="bt-settings-overlay" class="bt-hidden">
      <div id="bt-settings-box">
        <h3>⚙ Global Settings</h3>
        <label>Real Currency Code <input id="bt-set-code" type="text" maxlength="5" placeholder="AUD"></label>
        <label>Real Currency Symbol <input id="bt-set-sym" type="text" maxlength="3" placeholder="$"></label>
        <label>Custom Currency Name <input id="bt-set-cname" type="text" placeholder="Credits"></label>
        <label>Custom Currency Symbol <input id="bt-set-csym" type="text" maxlength="3" placeholder="₢"></label>
        <label>Default Economy Scope
          <select id="bt-set-scope">
            <option value="shared">Shared (world economy)</option>
            <option value="per_character">Per Character</option>
          </select>
        </label>
        <div class="bt-row bt-gap">
          <button id="bt-set-save" class="bt-btn-primary">Save</button>
          <button id="bt-set-cancel" class="bt-btn-ghost">Cancel</button>
        </div>
      </div>
    </div>

    <div id="bt-modal-overlay" class="bt-hidden">
      <div id="bt-modal-box"></div>
    </div>
  `;

  document.body.appendChild(panel);

  // Position from saved setting
  panel.style.top = (g.panelTop || 80) + 'px';
  panel.style.width = (g.panelWidth || 420) + 'px';

  wirePanel(panel, g);
  renderAll();
}

function wirePanel(panel, g) {
  // Drag
  const handle = panel.querySelector('#bt-drag-handle');
  let dragging = false, startY = 0, startTop = 0;
  handle.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startTop = panel.offsetTop;
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const top = Math.max(0, Math.min(window.innerHeight - 60, startTop + (e.clientY - startY)));
    panel.style.top = top + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    getGlobal().panelTop = panel.offsetTop;
    saveSettingsDebounced();
  });

  // Resize (width) via bottom-right corner — CSS handles resize: horizontal
  new ResizeObserver(() => {
    const w = panel.offsetWidth;
    if (w > 280) { getGlobal().panelWidth = w; saveSettingsDebounced(); }
  }).observe(panel);

  // Tabs
  panel.querySelectorAll('.bt-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.bt-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.bt-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      panel.querySelector(`#bt-pane-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Close
  panel.querySelector('#bt-close-btn').addEventListener('click', () => {
    panel.classList.add('bt-hidden');
  });

  // Settings overlay
  const overlay = panel.querySelector('#bt-settings-overlay');
  panel.querySelector('#bt-settings-btn').addEventListener('click', () => {
    const g = getGlobal();
    panel.querySelector('#bt-set-code').value = g.realCurrencyCode;
    panel.querySelector('#bt-set-sym').value = g.realCurrencySymbol;
    panel.querySelector('#bt-set-cname').value = g.customCurrencyName;
    panel.querySelector('#bt-set-csym').value = g.customCurrencySymbol;
    panel.querySelector('#bt-set-scope').value = g.defaultEconomyScope;
    overlay.classList.remove('bt-hidden');
  });
  panel.querySelector('#bt-set-cancel').addEventListener('click', () => overlay.classList.add('bt-hidden'));
  panel.querySelector('#bt-set-save').addEventListener('click', () => {
    const g = getGlobal();
    g.realCurrencyCode = panel.querySelector('#bt-set-code').value.trim() || 'AUD';
    g.realCurrencySymbol = panel.querySelector('#bt-set-sym').value.trim() || '$';
    g.customCurrencyName = panel.querySelector('#bt-set-cname').value.trim() || 'Credits';
    g.customCurrencySymbol = panel.querySelector('#bt-set-csym').value.trim() || '₢';
    g.defaultEconomyScope = panel.querySelector('#bt-set-scope').value;
    saveSettingsDebounced();
    overlay.classList.add('bt-hidden');
    renderAll();
  });
}

// ─── Render functions ──────────────────────────────────────────────────────────

function renderAll() {
  renderEconomy();
  renderCompanies();
  renderProjects();
  renderJobs();
}

// ── Economy ──

function renderEconomy() {
  const pane = document.querySelector('#bt-pane-economy');
  if (!pane) return;
  const data = getChatData();
  if (!data) { pane.innerHTML = '<p class="bt-muted">No active chat.</p>'; return; }
  const g = getGlobal();
  const eco = data.economy;

  // Ensure user wallet exists
  if (!eco.user) eco.user = { real: 0, custom: 0 };

  let charWallets = '';
  const chars = getCurrentChars();
  chars.forEach(name => {
    if (!eco.characters[name]) eco.characters[name] = { real: 0, custom: 0 };
    const w = eco.characters[name];
    charWallets += `
      <div class="bt-wallet-card">
        <div class="bt-wallet-label">🎭 ${escHtml(name)}</div>
        <div class="bt-wallet-amounts">
          <span class="bt-amount-real">${fmt(w.real, 'real')}</span>
          <span class="bt-amount-custom">${fmt(w.custom, 'custom')}</span>
        </div>
        <button class="bt-btn-xs" data-wallet-adj="char" data-name="${escHtml(name)}">± Adjust</button>
      </div>`;
  });

  pane.innerHTML = `
    <div class="bt-section-title">Economy Overview</div>

    <div class="bt-wallet-card bt-wallet-highlight">
      <div class="bt-wallet-label">🌐 Shared Economy</div>
      <div class="bt-wallet-amounts">
        <span class="bt-amount-real">${fmt(eco.shared.real, 'real')}</span>
        <span class="bt-amount-custom">${fmt(eco.shared.custom, 'custom')}</span>
      </div>
      <button class="bt-btn-xs" data-wallet-adj="shared">± Adjust</button>
    </div>

    <div class="bt-wallet-card">
      <div class="bt-wallet-label">👤 User (You)</div>
      <div class="bt-wallet-amounts">
        <span class="bt-amount-real">${fmt(eco.user.real, 'real')}</span>
        <span class="bt-amount-custom">${fmt(eco.user.custom, 'custom')}</span>
      </div>
      <button class="bt-btn-xs" data-wallet-adj="user">± Adjust</button>
    </div>

    ${charWallets}

    <button class="bt-btn-primary bt-full-btn" id="bt-add-transaction">+ Log Transaction</button>

    <div class="bt-section-title">Transaction Log</div>
    <div id="bt-transaction-list">
      ${renderTransactions(eco.transactions)}
    </div>
  `;

  // Wallet adjust buttons
  pane.querySelectorAll('[data-wallet-adj]').forEach(btn => {
    btn.addEventListener('click', () => {
      const scope = btn.dataset.walletAdj;
      const name = btn.dataset.name || null;
      openWalletAdjustModal(scope, name);
    });
  });

  pane.querySelector('#bt-add-transaction')?.addEventListener('click', openTransactionModal);
}

function renderTransactions(txns) {
  if (!txns || !txns.length) return '<p class="bt-muted">No transactions yet.</p>';
  return txns.slice().reverse().map(tx => `
    <div class="bt-tx-row">
      <span class="bt-tx-date">${tx.date}</span>
      <span class="bt-tx-parties">${escHtml(tx.from)} → ${escHtml(tx.to)}</span>
      <span class="bt-tx-amount ${tx.currency === 'real' ? 'bt-amount-real' : 'bt-amount-custom'}">${fmt(tx.amount, tx.currency)}</span>
      <span class="bt-tx-note">${escHtml(tx.note || '')}</span>
      <button class="bt-btn-del" data-del-tx="${tx.id}">✕</button>
    </div>
  `).join('') + '<script>/* del wired below */</scr' + 'ipt>';
}

function openWalletAdjustModal(scope, charName) {
  const g = getGlobal();
  const label = scope === 'shared' ? 'Shared Economy' : scope === 'user' ? 'User' : charName;
  openModal(`
    <h3>± Adjust Wallet — ${escHtml(label)}</h3>
    <label>Amount
      <input id="bt-adj-amount" type="number" step="0.01" placeholder="0.00">
    </label>
    <label>Currency
      <select id="bt-adj-cur">
        <option value="real">${g.realCurrencyCode} (${g.realCurrencySymbol})</option>
        <option value="custom">${g.customCurrencyName} (${g.customCurrencySymbol})</option>
      </select>
    </label>
    <label>Operation
      <select id="bt-adj-op">
        <option value="add">Add (income / deposit)</option>
        <option value="sub">Subtract (expense / withdrawal)</option>
        <option value="set">Set exact value</option>
      </select>
    </label>
    <label>Note <input id="bt-adj-note" type="text" placeholder="Optional note"></label>
    <div class="bt-row bt-gap">
      <button id="bt-adj-confirm" class="bt-btn-primary">Apply</button>
      <button id="bt-modal-cancel" class="bt-btn-ghost">Cancel</button>
    </div>
  `, () => {
    const data = getChatData();
    const eco = data.economy;
    const amount = parseFloat(document.querySelector('#bt-adj-amount').value) || 0;
    const cur = document.querySelector('#bt-adj-cur').value;
    const op = document.querySelector('#bt-adj-op').value;
    const note = document.querySelector('#bt-adj-note').value.trim();

    let wallet;
    if (scope === 'shared') wallet = eco.shared;
    else if (scope === 'user') wallet = eco.user;
    else { if (!eco.characters[charName]) eco.characters[charName] = { real: 0, custom: 0 }; wallet = eco.characters[charName]; }

    if (op === 'add') wallet[cur] += amount;
    else if (op === 'sub') wallet[cur] -= amount;
    else wallet[cur] = amount;

    // Log transaction
    const opLabel = op === 'add' ? 'Deposit' : op === 'sub' ? 'Withdrawal' : 'Set';
    eco.transactions.push({ id: uid(), date: todayStr(), from: opLabel, to: label, amount, currency: cur, note });

    saveChat(); renderEconomy();
  }, '#bt-adj-confirm');
}

function openTransactionModal() {
  const g = getGlobal();
  const data = getChatData();
  const chars = getCurrentChars();
  const walletOptions = ['Shared Economy', 'User (You)', ...chars].map(n => `<option>${escHtml(n)}</option>`).join('');

  openModal(`
    <h3>+ Log Transaction</h3>
    <label>From <select id="bt-tx-from">${walletOptions}</select></label>
    <label>To <select id="bt-tx-to">${walletOptions}</select></label>
    <label>Amount <input id="bt-tx-amount" type="number" step="0.01" placeholder="0.00"></label>
    <label>Currency
      <select id="bt-tx-cur">
        <option value="real">${g.realCurrencyCode} (${g.realCurrencySymbol})</option>
        <option value="custom">${g.customCurrencyName} (${g.customCurrencySymbol})</option>
      </select>
    </label>
    <label>Note <input id="bt-tx-note" type="text" placeholder="What is this for?"></label>
    <label>
      <input type="checkbox" id="bt-tx-transfer"> Move funds between wallets (deduct from → add to)
    </label>
    <div class="bt-row bt-gap">
      <button id="bt-tx-confirm" class="bt-btn-primary">Log</button>
      <button id="bt-modal-cancel" class="bt-btn-ghost">Cancel</button>
    </div>
  `, () => {
    const data = getChatData();
    const eco = data.economy;
    const from = document.querySelector('#bt-tx-from').value;
    const to = document.querySelector('#bt-tx-to').value;
    const amount = parseFloat(document.querySelector('#bt-tx-amount').value) || 0;
    const cur = document.querySelector('#bt-tx-cur').value;
    const note = document.querySelector('#bt-tx-note').value.trim();
    const isTransfer = document.querySelector('#bt-tx-transfer').checked;

    if (isTransfer) {
      const fromWallet = resolveWallet(eco, from);
      const toWallet = resolveWallet(eco, to);
      if (fromWallet) fromWallet[cur] -= amount;
      if (toWallet) toWallet[cur] += amount;
    }

    eco.transactions.push({ id: uid(), date: todayStr(), from, to, amount, currency: cur, note });
    saveChat(); closeModal(); renderEconomy();
  }, '#bt-tx-confirm');

  // Wire delete buttons after render
  document.querySelector('#bt-pane-economy')?.querySelectorAll('[data-del-tx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const data = getChatData();
      data.economy.transactions = data.economy.transactions.filter(t => t.id !== btn.dataset.delTx);
      saveChat(); renderEconomy();
    });
  });
}

function resolveWallet(eco, label) {
  if (label === 'Shared Economy') return eco.shared;
  if (label === 'User (You)') return eco.user;
  if (!eco.characters[label]) eco.characters[label] = { real: 0, custom: 0 };
  return eco.characters[label];
}

// ── Companies ──

function renderCompanies() {
  const pane = document.querySelector('#bt-pane-companies');
  if (!pane) return;
  const data = getChatData();
  if (!data) { pane.innerHTML = '<p class="bt-muted">No active chat.</p>'; return; }

  const companies = data.companies;
  pane.innerHTML = `
    <button class="bt-btn-primary bt-full-btn" id="bt-add-company">+ Add Company</button>
    <div id="bt-company-list">
      ${companies.length === 0 ? '<p class="bt-muted">No companies tracked yet.</p>' :
        companies.map(c => `
          <div class="bt-card" id="btc-${c.id}">
            <div class="bt-card-header">
              <span class="bt-card-title">🏢 ${escHtml(c.name)}</span>
              <div class="bt-row bt-gap-xs">
                <button class="bt-btn-xs" data-edit-company="${c.id}">✏</button>
                <button class="bt-btn-del" data-del-company="${c.id}">✕</button>
              </div>
            </div>
            <div class="bt-card-meta">
              <span class="bt-tag">${escHtml(c.type || 'Unknown')}</span>
              <span class="bt-tag bt-tag-rel">${escHtml(c.relation || 'Associated')}</span>
            </div>
            ${c.notes ? `<p class="bt-card-notes">${escHtml(c.notes)}</p>` : ''}
            ${c.contacts && c.contacts.length ? `<div class="bt-contacts"><strong>Contacts:</strong> ${c.contacts.map(x => escHtml(x)).join(', ')}</div>` : ''}
          </div>`).join('')}
    </div>
  `;

  pane.querySelector('#bt-add-company').addEventListener('click', () => openCompanyModal(null));
  pane.querySelectorAll('[data-edit-company]').forEach(btn => {
    const co = companies.find(c => c.id === btn.dataset.editCompany);
    btn.addEventListener('click', () => openCompanyModal(co));
  });
  pane.querySelectorAll('[data-del-company]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this company?')) return;
      const data = getChatData();
      data.companies = data.companies.filter(c => c.id !== btn.dataset.delCompany);
      saveChat(); renderCompanies();
    });
  });
}

function openCompanyModal(co) {
  const isEdit = !!co;
  openModal(`
    <h3>${isEdit ? '✏ Edit' : '+ Add'} Company</h3>
    <label>Name <input id="bt-co-name" type="text" value="${escHtml(co?.name || '')}" placeholder="Acme Corp"></label>
    <label>Type <input id="bt-co-type" type="text" value="${escHtml(co?.type || '')}" placeholder="Corporation, Guild, Agency..."></label>
    <label>Relation
      <select id="bt-co-rel">
        ${['Employer','Client','Contractor','Rival','Ally','Neutral','Criminal','Government'].map(r =>
          `<option ${co?.relation === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
    </label>
    <label>Contacts (comma-separated) <input id="bt-co-contacts" type="text" value="${escHtml((co?.contacts || []).join(', '))}" placeholder="John Doe, Jane Smith"></label>
    <label>Notes <textarea id="bt-co-notes" rows="3" placeholder="Any relevant info...">${escHtml(co?.notes || '')}</textarea></label>
    <div class="bt-row bt-gap">
      <button id="bt-co-confirm" class="bt-btn-primary">${isEdit ? 'Save' : 'Add'}</button>
      <button id="bt-modal-cancel" class="bt-btn-ghost">Cancel</button>
    </div>
  `, () => {
    const data = getChatData();
    const name = document.querySelector('#bt-co-name').value.trim();
    if (!name) return;
    const entry = {
      id: co?.id || uid(),
      name,
      type: document.querySelector('#bt-co-type').value.trim(),
      relation: document.querySelector('#bt-co-rel').value,
      contacts: document.querySelector('#bt-co-contacts').value.split(',').map(s => s.trim()).filter(Boolean),
      notes: document.querySelector('#bt-co-notes').value.trim(),
    };
    if (isEdit) {
      const idx = data.companies.findIndex(c => c.id === co.id);
      if (idx !== -1) data.companies[idx] = entry;
    } else {
      data.companies.push(entry);
    }
    saveChat(); closeModal(); renderCompanies();
  }, '#bt-co-confirm');
}

// ── Projects ──

function renderProjects() {
  const pane = document.querySelector('#bt-pane-projects');
  if (!pane) return;
  const data = getChatData();
  if (!data) { pane.innerHTML = '<p class="bt-muted">No active chat.</p>'; return; }

  const projects = data.projects;
  pane.innerHTML = `
    <div class="bt-filter-row">
      <select id="bt-proj-filter">
        <option value="all">All Statuses</option>
        ${STATUS_LIST.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('')}
      </select>
    </div>
    <button class="bt-btn-primary bt-full-btn" id="bt-add-project">+ Add Project</button>
    <div id="bt-project-list">
      ${renderProjectCards(projects, 'all')}
    </div>
  `;

  pane.querySelector('#bt-proj-filter').addEventListener('change', e => {
    pane.querySelector('#bt-project-list').innerHTML = renderProjectCards(getChatData().projects, e.target.value);
    wireProjectButtons(pane);
  });
  pane.querySelector('#bt-add-project').addEventListener('click', () => openProjectModal(null));
  wireProjectButtons(pane);
}

function renderProjectCards(projects, filter) {
  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter);
  if (!filtered.length) return '<p class="bt-muted">No projects found.</p>';
  return filtered.map(p => `
    <div class="bt-card">
      <div class="bt-card-header">
        <span class="bt-card-title">📁 ${escHtml(p.name)}</span>
        <div class="bt-row bt-gap-xs">
          <button class="bt-btn-xs" data-edit-project="${p.id}">✏</button>
          <button class="bt-btn-del" data-del-project="${p.id}">✕</button>
        </div>
      </div>
      <div class="bt-card-meta">
        <span class="bt-status-pill" style="background:${STATUS_COLORS[p.status]}22;color:${STATUS_COLORS[p.status]};border-color:${STATUS_COLORS[p.status]}">${STATUS_LABELS[p.status]}</span>
        ${p.company ? `<span class="bt-tag">🏢 ${escHtml(p.company)}</span>` : ''}
        ${p.dueDate ? `<span class="bt-tag">📅 ${escHtml(p.dueDate)}</span>` : ''}
      </div>
      <div class="bt-finance-row">
        ${p.budget ? `<span>Budget: <strong>${fmt(p.budget, 'real')}</strong></span>` : ''}
        ${p.earned ? `<span>Earned: <strong class="bt-amount-real">${fmt(p.earned, 'real')}</strong></span>` : ''}
        ${p.customBudget ? `<span>Budget: <strong>${fmt(p.customBudget, 'custom')}</strong></span>` : ''}
        ${p.customEarned ? `<span>Earned: <strong class="bt-amount-custom">${fmt(p.customEarned, 'custom')}</strong></span>` : ''}
      </div>
      ${p.notes ? `<p class="bt-card-notes">${escHtml(p.notes)}</p>` : ''}
    </div>`).join('');
}

function wireProjectButtons(pane) {
  const data = getChatData();
  pane.querySelectorAll('[data-edit-project]').forEach(btn => {
    const p = data.projects.find(x => x.id === btn.dataset.editProject);
    btn.addEventListener('click', () => openProjectModal(p));
  });
  pane.querySelectorAll('[data-del-project]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this project?')) return;
      const data = getChatData();
      data.projects = data.projects.filter(p => p.id !== btn.dataset.delProject);
      saveChat(); renderProjects();
    });
  });
}

function openProjectModal(p) {
  const isEdit = !!p;
  const data = getChatData();
  const companyOptions = data.companies.map(c => `<option ${p?.company === c.name ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
  const g = getGlobal();

  openModal(`
    <h3>${isEdit ? '✏ Edit' : '+ Add'} Project</h3>
    <label>Name <input id="bt-pr-name" type="text" value="${escHtml(p?.name || '')}" placeholder="Project name"></label>
    <label>Status
      <select id="bt-pr-status">
        ${STATUS_LIST.map(s => `<option value="${s}" ${p?.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
      </select>
    </label>
    <label>Company <select id="bt-pr-company"><option value="">— None —</option>${companyOptions}</select></label>
    <label>Due Date <input id="bt-pr-due" type="date" value="${p?.dueDate || ''}"></label>
    <div class="bt-row bt-gap">
      <label style="flex:1">${g.realCurrencyCode} Budget <input id="bt-pr-budget" type="number" step="0.01" value="${p?.budget || ''}" placeholder="0.00"></label>
      <label style="flex:1">${g.realCurrencyCode} Earned <input id="bt-pr-earned" type="number" step="0.01" value="${p?.earned || ''}" placeholder="0.00"></label>
    </div>
    <div class="bt-row bt-gap">
      <label style="flex:1">${g.customCurrencyName} Budget <input id="bt-pr-cbudget" type="number" step="0.01" value="${p?.customBudget || ''}" placeholder="0.00"></label>
      <label style="flex:1">${g.customCurrencyName} Earned <input id="bt-pr-cearned" type="number" step="0.01" value="${p?.customEarned || ''}" placeholder="0.00"></label>
    </div>
    <label>Notes <textarea id="bt-pr-notes" rows="3">${escHtml(p?.notes || '')}</textarea></label>
    <div class="bt-row bt-gap">
      <button id="bt-pr-confirm" class="bt-btn-primary">${isEdit ? 'Save' : 'Add'}</button>
      <button id="bt-modal-cancel" class="bt-btn-ghost">Cancel</button>
    </div>
  `, () => {
    const data = getChatData();
    const name = document.querySelector('#bt-pr-name').value.trim();
    if (!name) return;
    const entry = {
      id: p?.id || uid(),
      name,
      status: document.querySelector('#bt-pr-status').value,
      company: document.querySelector('#bt-pr-company').value,
      dueDate: document.querySelector('#bt-pr-due').value,
      budget: parseFloat(document.querySelector('#bt-pr-budget').value) || 0,
      earned: parseFloat(document.querySelector('#bt-pr-earned').value) || 0,
      customBudget: parseFloat(document.querySelector('#bt-pr-cbudget').value) || 0,
      customEarned: parseFloat(document.querySelector('#bt-pr-cearned').value) || 0,
      notes: document.querySelector('#bt-pr-notes').value.trim(),
    };
    if (isEdit) {
      const idx = data.projects.findIndex(x => x.id === p.id);
      if (idx !== -1) data.projects[idx] = entry;
    } else {
      data.projects.push(entry);
    }
    saveChat(); closeModal(); renderProjects();
  }, '#bt-pr-confirm');
}

// ── Jobs ──

function renderJobs() {
  const pane = document.querySelector('#bt-pane-jobs');
  if (!pane) return;
  const data = getChatData();
  if (!data) { pane.innerHTML = '<p class="bt-muted">No active chat.</p>'; return; }

  const jobs = data.jobs;
  pane.innerHTML = `
    <div class="bt-filter-row">
      <select id="bt-job-filter">
        <option value="all">All Statuses</option>
        ${STATUS_LIST.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('')}
      </select>
    </div>
    <button class="bt-btn-primary bt-full-btn" id="bt-add-job">+ Add Job</button>
    <div id="bt-job-list">
      ${renderJobCards(jobs, 'all')}
    </div>
  `;

  pane.querySelector('#bt-job-filter').addEventListener('change', e => {
    pane.querySelector('#bt-job-list').innerHTML = renderJobCards(getChatData().jobs, e.target.value);
    wireJobButtons(pane);
  });
  pane.querySelector('#bt-add-job').addEventListener('click', () => openJobModal(null));
  wireJobButtons(pane);
}

function renderJobCards(jobs, filter) {
  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
  if (!filtered.length) return '<p class="bt-muted">No jobs found.</p>';
  const g = getGlobal();
  return filtered.map(j => `
    <div class="bt-card">
      <div class="bt-card-header">
        <span class="bt-card-title">💼 ${escHtml(j.title)}</span>
        <div class="bt-row bt-gap-xs">
          <button class="bt-btn-xs" data-edit-job="${j.id}">✏</button>
          <button class="bt-btn-del" data-del-job="${j.id}">✕</button>
        </div>
      </div>
      <div class="bt-card-meta">
        <span class="bt-status-pill" style="background:${STATUS_COLORS[j.status]}22;color:${STATUS_COLORS[j.status]};border-color:${STATUS_COLORS[j.status]}">${STATUS_LABELS[j.status]}</span>
        ${j.character ? `<span class="bt-tag">🎭 ${escHtml(j.character)}</span>` : ''}
        ${j.company ? `<span class="bt-tag">🏢 ${escHtml(j.company)}</span>` : ''}
      </div>
      <div class="bt-finance-row">
        ${j.pay ? `<span>Pay: <strong>${j.currency === 'custom' ? fmt(j.pay, 'custom') : fmt(j.pay, 'real')}</strong> / ${escHtml(j.payType || 'flat')}</span>` : ''}
        ${j.startDate ? `<span>Start: ${escHtml(j.startDate)}</span>` : ''}
        ${j.endDate ? `<span>End: ${escHtml(j.endDate)}</span>` : ''}
      </div>
      ${j.notes ? `<p class="bt-card-notes">${escHtml(j.notes)}</p>` : ''}
    </div>`).join('');
}

function wireJobButtons(pane) {
  const data = getChatData();
  pane.querySelectorAll('[data-edit-job]').forEach(btn => {
    const j = data.jobs.find(x => x.id === btn.dataset.editJob);
    btn.addEventListener('click', () => openJobModal(j));
  });
  pane.querySelectorAll('[data-del-job]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this job?')) return;
      const data = getChatData();
      data.jobs = data.jobs.filter(j => j.id !== btn.dataset.delJob);
      saveChat(); renderJobs();
    });
  });
}

function openJobModal(j) {
  const isEdit = !!j;
  const data = getChatData();
  const g = getGlobal();
  const companyOptions = data.companies.map(c => `<option ${j?.company === c.name ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
  const charOptions = ['User (You)', ...getCurrentChars()].map(n => `<option ${j?.character === n ? 'selected' : ''}>${escHtml(n)}</option>`).join('');

  openModal(`
    <h3>${isEdit ? '✏ Edit' : '+ Add'} Job</h3>
    <label>Job Title <input id="bt-jb-title" type="text" value="${escHtml(j?.title || '')}" placeholder="Security Guard, Hacker..."></label>
    <label>Status
      <select id="bt-jb-status">
        ${STATUS_LIST.map(s => `<option value="${s}" ${j?.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
      </select>
    </label>
    <label>Assigned to <select id="bt-jb-char"><option value="">— None —</option>${charOptions}</select></label>
    <label>Company <select id="bt-jb-company"><option value="">— None —</option>${companyOptions}</select></label>
    <div class="bt-row bt-gap">
      <label style="flex:1">Pay Rate <input id="bt-jb-pay" type="number" step="0.01" value="${j?.pay || ''}" placeholder="0.00"></label>
      <label style="flex:1">Per
        <select id="bt-jb-paytype">
          ${['hour','day','week','month','flat','mission'].map(t => `<option ${j?.payType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>
    </div>
    <label>Currency
      <select id="bt-jb-cur">
        <option value="real" ${j?.currency !== 'custom' ? 'selected' : ''}>${g.realCurrencyCode}</option>
        <option value="custom" ${j?.currency === 'custom' ? 'selected' : ''}>${g.customCurrencyName}</option>
      </select>
    </label>
    <div class="bt-row bt-gap">
      <label style="flex:1">Start Date <input id="bt-jb-start" type="date" value="${j?.startDate || ''}"></label>
      <label style="flex:1">End Date <input id="bt-jb-end" type="date" value="${j?.endDate || ''}"></label>
    </div>
    <label>Notes <textarea id="bt-jb-notes" rows="3">${escHtml(j?.notes || '')}</textarea></label>
    <div class="bt-row bt-gap">
      <button id="bt-jb-confirm" class="bt-btn-primary">${isEdit ? 'Save' : 'Add'}</button>
      <button id="bt-modal-cancel" class="bt-btn-ghost">Cancel</button>
    </div>
  `, () => {
    const data = getChatData();
    const title = document.querySelector('#bt-jb-title').value.trim();
    if (!title) return;
    const entry = {
      id: j?.id || uid(),
      title,
      status: document.querySelector('#bt-jb-status').value,
      character: document.querySelector('#bt-jb-char').value,
      company: document.querySelector('#bt-jb-company').value,
      pay: parseFloat(document.querySelector('#bt-jb-pay').value) || 0,
      payType: document.querySelector('#bt-jb-paytype').value,
      currency: document.querySelector('#bt-jb-cur').value,
      startDate: document.querySelector('#bt-jb-start').value,
      endDate: document.querySelector('#bt-jb-end').value,
      notes: document.querySelector('#bt-jb-notes').value.trim(),
    };
    if (isEdit) {
      const idx = data.jobs.findIndex(x => x.id === j.id);
      if (idx !== -1) data.jobs[idx] = entry;
    } else {
      data.jobs.push(entry);
    }
    saveChat(); closeModal(); renderJobs();
  }, '#bt-jb-confirm');
}

// ─── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(html, onConfirm, confirmSelector) {
  const overlay = document.querySelector('#bt-modal-overlay');
  const box = document.querySelector('#bt-modal-box');
  box.innerHTML = html;
  overlay.classList.remove('bt-hidden');

  if (confirmSelector && onConfirm) {
    box.querySelector(confirmSelector)?.addEventListener('click', () => {
      onConfirm();
      closeModal();
    });
  }
  box.querySelector('#bt-modal-cancel')?.addEventListener('click', closeModal);
}

function closeModal() {
  document.querySelector('#bt-modal-overlay')?.classList.add('bt-hidden');
}

// ─── Utility ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Toolbar button ────────────────────────────────────────────────────────────

function addToolbarButton() {
  // SillyTavern extension buttons live in #extensionsMenu
  const menu = document.querySelector('#extensionsMenu');
  if (!menu) return;

  const btn = document.createElement('div');
  btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
  btn.id = 'bt-toolbar-btn';
  btn.innerHTML = `<span>📊 Business Tracker</span>`;
  btn.addEventListener('click', () => {
    const panel = document.querySelector(`#${PANEL_ID}`);
    if (!panel) return;
    panel.classList.toggle('bt-hidden');
    renderAll();
  });
  menu.appendChild(btn);
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

jQuery(async () => {
  // Ensure global settings exist
  if (!extension_settings[EXT_NAME]) {
    extension_settings[EXT_NAME] = { ...defaultGlobalSettings };
    saveSettingsDebounced();
  }

  buildPanel();
  addToolbarButton();

  // Re-render when chat changes
  eventSource.on(event_types.CHAT_CHANGED, () => {
    renderAll();
  });
});
