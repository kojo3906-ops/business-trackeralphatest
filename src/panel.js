/**
 * panel.js — Floating panel shell for Business Tracker
 * Handles: drag, resize, collapse, tab switching, show/hide.
 * Does NOT render tab content — each tab module does its own rendering.
 */

import { getGlobalSettings, saveGlobalSettings } from './store.js';
import { el, clearEl } from './utils.js';

// ─── Tab Registry ─────────────────────────────────────────────────────────────
// Tabs register themselves here via registerTab().

const _tabs = new Map(); // id → { label, icon, render: (container) => void, onShow?: () => void }

export function registerTab(id, label, icon, renderFn, onShowFn = null) {
    _tabs.set(id, { label, icon, render: renderFn, onShow: onShowFn });
}

// ─── Panel State ──────────────────────────────────────────────────────────────

let _panel = null;
let _tabBar = null;
let _tabContent = null;
let _collapseBtn = null;
let _floatBtn = null;   // the persistent HUD button when panel is hidden/collapsed

let _dragging = false;
let _dragOffsetX = 0;
let _dragOffsetY = 0;
let _resizing = false;

// ─── Build Panel ──────────────────────────────────────────────────────────────

export function buildPanel() {
    if (_panel) return; // already built

    const settings = getGlobalSettings();
    const { x, y, width, height, collapsed, activeTab } = settings.panel;

    // ── Floating HUD button (always visible when panel is closed/collapsed) ──
    _floatBtn = el('div', { id: 'bt-float-btn', title: 'Business Tracker' }, '💼');
    _floatBtn.addEventListener('click', () => togglePanel());
    document.body.appendChild(_floatBtn);

    // ── Main panel ──
    _panel = el('div', { id: 'bt-panel' });
    _panel.style.left = `${x}px`;
    _panel.style.top = `${y}px`;
    _panel.style.width = `${width}px`;
    _panel.style.height = collapsed ? 'auto' : `${height}px`;

    // ── Header ──
    const header = el('div', { class: 'bt-header' });
    const title = el('span', { class: 'bt-title' }, '💼 Business Tracker');
    _collapseBtn = el('button', { class: 'bt-icon-btn', title: collapsed ? 'Expand' : 'Collapse' },
        collapsed ? '▼' : '▲');
    const closeBtn = el('button', { class: 'bt-icon-btn', title: 'Hide panel' }, '✕');

    _collapseBtn.addEventListener('click', () => toggleCollapse());
    closeBtn.addEventListener('click', () => hidePanel());
    header.append(title, _collapseBtn, closeBtn);

    // ── Tab bar ──
    _tabBar = el('div', { class: 'bt-tab-bar' });

    // ── Tab content area ──
    _tabContent = el('div', { class: 'bt-tab-content' });

    // ── Resize handle ──
    const resizeHandle = el('div', { class: 'bt-resize-handle' });

    _panel.append(header, _tabBar, _tabContent, resizeHandle);
    document.body.appendChild(_panel);

    // Wire drag on header
    header.addEventListener('mousedown', onDragStart);

    // Wire resize
    resizeHandle.addEventListener('mousedown', onResizeStart);

    // Global mouse events
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Apply collapsed state
    if (collapsed) applyCollapsed(true);

    // Apply visibility
    if (!settings.panel.visible) {
        _panel.style.display = 'none';
    }
}

// ─── Tab Management ───────────────────────────────────────────────────────────

export function renderTabBar() {
    clearEl(_tabBar);
    const settings = getGlobalSettings();
    const activeTab = settings.panel.activeTab;

    for (const [id, tab] of _tabs) {
        const btn = el('button', {
            class: `bt-tab-btn${id === activeTab ? ' active' : ''}`,
            'data-tab': id,
            title: tab.label,
        }, tab.icon);
        btn.addEventListener('click', () => switchTab(id));
        _tabBar.appendChild(btn);
    }
}

export function switchTab(id) {
    if (!_tabs.has(id)) return;
    const settings = getGlobalSettings();
    settings.panel.activeTab = id;
    saveGlobalSettings();

    // Update tab bar active state
    _tabBar.querySelectorAll('.bt-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === id);
    });

    // Render tab content
    clearEl(_tabContent);
    const tab = _tabs.get(id);
    tab.render(_tabContent);
    if (tab.onShow) tab.onShow();
}

export function refreshActiveTab() {
    const settings = getGlobalSettings();
    switchTab(settings.panel.activeTab);
}

// ─── Show / Hide / Toggle ─────────────────────────────────────────────────────

export function showPanel() {
    if (!_panel) buildPanel();
    renderTabBar();
    const settings = getGlobalSettings();
    settings.panel.visible = true;
    saveGlobalSettings();
    _panel.style.display = 'flex';
    _floatBtn.classList.add('active');
    switchTab(settings.panel.activeTab);
}

export function hidePanel() {
    if (!_panel) return;
    const settings = getGlobalSettings();
    settings.panel.visible = false;
    saveGlobalSettings();
    _panel.style.display = 'none';
    _floatBtn.classList.remove('active');
}

export function togglePanel() {
    const settings = getGlobalSettings();
    if (settings.panel.visible) hidePanel();
    else showPanel();
}

// ─── Collapse ─────────────────────────────────────────────────────────────────

function toggleCollapse() {
    const settings = getGlobalSettings();
    const nowCollapsed = !settings.panel.collapsed;
    settings.panel.collapsed = nowCollapsed;
    saveGlobalSettings();
    applyCollapsed(nowCollapsed);
}

function applyCollapsed(collapsed) {
    const settings = getGlobalSettings();
    if (collapsed) {
        _panel.classList.add('collapsed');
        _tabContent.style.display = 'none';
        _tabBar.style.display = 'none';
        _panel.style.height = 'auto';
        _collapseBtn.textContent = '▼';
        _collapseBtn.title = 'Expand';
    } else {
        _panel.classList.remove('collapsed');
        _tabContent.style.display = '';
        _tabBar.style.display = '';
        _panel.style.height = `${settings.panel.height}px`;
        _collapseBtn.textContent = '▲';
        _collapseBtn.title = 'Collapse';
    }
}

// ─── Drag ─────────────────────────────────────────────────────────────────────

function onDragStart(e) {
    // Don't drag if clicking buttons inside the header
    if (e.target.tagName === 'BUTTON') return;
    _dragging = true;
    const rect = _panel.getBoundingClientRect();
    _dragOffsetX = e.clientX - rect.left;
    _dragOffsetY = e.clientY - rect.top;
    _panel.style.userSelect = 'none';
    e.preventDefault();
}

function onMouseMove(e) {
    if (_dragging) {
        const x = Math.max(0, e.clientX - _dragOffsetX);
        const y = Math.max(0, e.clientY - _dragOffsetY);
        _panel.style.left = `${x}px`;
        _panel.style.top = `${y}px`;
    }
    if (_resizing) {
        const rect = _panel.getBoundingClientRect();
        const newW = Math.max(380, e.clientX - rect.left);
        const newH = Math.max(300, e.clientY - rect.top);
        _panel.style.width = `${newW}px`;
        _panel.style.height = `${newH}px`;
    }
}

function onMouseUp() {
    if (_dragging) {
        _dragging = false;
        _panel.style.userSelect = '';
        const rect = _panel.getBoundingClientRect();
        const settings = getGlobalSettings();
        settings.panel.x = Math.round(rect.left);
        settings.panel.y = Math.round(rect.top);
        saveGlobalSettings();
    }
    if (_resizing) {
        _resizing = false;
        const rect = _panel.getBoundingClientRect();
        const settings = getGlobalSettings();
        settings.panel.width = Math.round(rect.width);
        settings.panel.height = Math.round(rect.height);
        saveGlobalSettings();
    }
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function onResizeStart(e) {
    _resizing = true;
    e.preventDefault();
    e.stopPropagation();
}

// ─── Exported panel element accessor ─────────────────────────────────────────

export function getPanelEl() {
    return _panel;
}
