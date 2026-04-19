/**
 * tab-work.js — Work tab (Jobs + Projects)
 * Two sub-tabs: Jobs (one-off contracts) and Projects (multi-stage).
 */

import { getChatState, upsertJob, upsertProject } from './store.js';
import { el, clearEl, uuid, isoNow, formatDate, formatAmount, truncate,
         JOB_STATUS_LABELS, PROJECT_STATUS_LABELS } from './utils.js';

export function renderWork(container) {
    clearEl(container);

    let activeSubTab = 'jobs';

    const subTabBar = el('div', { class: 'bt-subtab-bar' });
    const jobsBtn = el('button', { class: 'bt-subtab-btn active' }, 'Jobs');
    const projBtn = el('button', { class: 'bt-subtab-btn' }, 'Projects');
    subTabBar.append(jobsBtn, projBtn);

    const subContent = el('div', { class: 'bt-subtab-content' });

    function switchSubTab(tab) {
        activeSubTab = tab;
        jobsBtn.classList.toggle('active', tab === 'jobs');
        projBtn.classList.toggle('active', tab === 'projects');
        clearEl(subContent);
        if (tab === 'jobs') renderJobs(subContent);
        else renderProjects(subContent);
    }

    jobsBtn.addEventListener('click', () => switchSubTab('jobs'));
    projBtn.addEventListener('click', () => switchSubTab('projects'));

    container.append(subTabBar, subContent);
    switchSubTab('jobs');
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

function renderJobs(container) {
    clearEl(container);
    const state = getChatState();

    const toolbar = el('div', { class: 'bt-toolbar' });
    const addBtn = el('button', { class: 'bt-btn bt-btn-primary' }, '+ Add Job');
    addBtn.addEventListener('click', () => openJobEditor(null, container));
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    if (state.jobs.length === 0) {
        container.appendChild(el('div', { class: 'bt-empty' }, 'No jobs tracked yet.'));
        return;
    }

    // Sort: active first, then pending, then completed/failed
    const order = { active: 0, pending: 1, completed: 2, failed: 3 };
    const sorted = [...state.jobs].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));

    for (const job of sorted) {
        container.appendChild(buildJobCard(job, state, container));
    }
}

function buildJobCard(job, state, container) {
    const card = el('div', { class: `bt-card bt-job-${job.status}` });
    let expanded = false;

    const header = el('div', { class: 'bt-card-header' });
    const nameEl = el('span', { class: 'bt-card-name' }, job.title ?? 'Untitled');
    const statusEl = el('span', { class: `bt-status-chip bt-status-${job.status}` },
        JOB_STATUS_LABELS[job.status] ?? job.status);

    const subEl = el('span', { class: 'bt-card-sub' }, [
        job.employerName ? `for ${job.employerName}` : null,
        job.employeeName ? `· ${job.employeeName}` : null,
    ].filter(Boolean).join(' '));

    const chevron = el('span', { class: 'bt-chevron' }, '▶');
    const actions = el('div', { class: 'bt-card-actions' });
    const editBtn = el('button', { class: 'bt-icon-btn', title: 'Edit' }, '✎');
    const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Delete' }, '✕');

    editBtn.addEventListener('click', e => { e.stopPropagation(); openJobEditor(job, container); });
    delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Delete job "${job.title}"?`)) {
            const s = getChatState();
            s.jobs = s.jobs.filter(j => j.id !== job.id);
            import('./store.js').then(({ saveChatState }) => { saveChatState(); renderJobs(container); });
        }
    });
    actions.append(editBtn, delBtn);
    header.append(chevron, nameEl, statusEl, subEl, actions);

    const detail = el('div', { class: 'bt-card-detail' });
    detail.style.display = 'none';
    buildJobDetail(job, state, detail);

    header.addEventListener('click', () => {
        expanded = !expanded;
        detail.style.display = expanded ? '' : 'none';
        chevron.textContent = expanded ? '▼' : '▶';
        card.classList.toggle('expanded', expanded);
    });

    card.append(header, detail);
    return card;
}

function buildJobDetail(job, state, container) {
    clearEl(container);
    if (job.description) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Description'));
        s.appendChild(el('div', { class: 'bt-detail-text' }, job.description));
        container.appendChild(s);
    }
    const paySection = el('div', { class: 'bt-detail-section' });
    paySection.appendChild(el('div', { class: 'bt-detail-label' }, 'Pay'));
    if (job.agreedPay) {
        paySection.appendChild(el('div', { class: 'bt-detail-row' },
            `Agreed: ${job.agreedPay.amount} ${job.agreedPay.currency ?? ''}`));
    }
    if (job.actualPaid) {
        paySection.appendChild(el('div', { class: 'bt-detail-row' },
            `Paid: ${job.actualPaid.amount} ${job.actualPaid.currency ?? ''}`));
    }
    container.appendChild(paySection);
    if (job.notes) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Notes'));
        s.appendChild(el('div', { class: 'bt-detail-text' }, job.notes));
        container.appendChild(s);
    }
}

function openJobEditor(job, container) {
    const state = getChatState();
    const isNew = !job;
    const data = job ? { ...job } : {
        id: uuid(), title: '', employerId: null, employerName: '',
        employeeId: null, employeeName: '', status: 'pending',
        agreedPay: null, actualPaid: null, description: '', notes: '',
    };

    document.getElementById('bt-job-editor')?.remove();
    const overlay = el('div', { id: 'bt-job-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, isNew ? 'Add Job' : 'Edit Job');
    const form = el('div', { class: 'bt-editor-form' });

    form.appendChild(buildTextField('Job Title', data.title, v => data.title = v));
    form.appendChild(buildTextField('Employer', data.employerName, v => data.employerName = v));
    form.appendChild(buildTextField('Employee', data.employeeName, v => data.employeeName = v));
    form.appendChild(buildSelectField('Status', Object.keys(JOB_STATUS_LABELS), data.status,
        v => data.status = v, JOB_STATUS_LABELS));
    form.appendChild(buildTextField('Agreed Pay (e.g. 500 Gold)', data.agreedPay?.amount ?? '', v => {
        data.agreedPay = v ? { amount: parseFloat(v) || 0, currency: data.agreedPay?.currency ?? '' } : null;
    }));
    form.appendChild(buildTextField('Description', data.description, v => data.description = v));
    form.appendChild(buildTextareaField('Notes', data.notes, v => data.notes = v));

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, isNew ? 'Add' : 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');
    saveBtn.addEventListener('click', () => {
        if (!data.title.trim()) { alert('Title is required.'); return; }
        upsertJob(data);
        overlay.remove();
        renderJobs(container);
    });
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnRow.append(saveBtn, cancelBtn);
    modal.append(title, form, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

function renderProjects(container) {
    clearEl(container);
    const state = getChatState();

    const toolbar = el('div', { class: 'bt-toolbar' });
    const addBtn = el('button', { class: 'bt-btn bt-btn-primary' }, '+ Add Project');
    addBtn.addEventListener('click', () => openProjectEditor(null, container));
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    if (state.projects.length === 0) {
        container.appendChild(el('div', { class: 'bt-empty' }, 'No projects tracked yet.'));
        return;
    }

    const order = { active: 0, planning: 1, on_hold: 2, completed: 3, abandoned: 4 };
    const sorted = [...state.projects].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));

    for (const project of sorted) {
        container.appendChild(buildProjectCard(project, state, container));
    }
}

function buildProjectCard(project, state, container) {
    const card = el('div', { class: `bt-card bt-project-${project.status}` });
    let expanded = false;

    const header = el('div', { class: 'bt-card-header' });
    const nameEl = el('span', { class: 'bt-card-name' }, project.name ?? 'Untitled Project');
    const statusEl = el('span', { class: `bt-status-chip bt-status-${project.status}` },
        PROJECT_STATUS_LABELS[project.status] ?? project.status);

    // Stage progress indicator
    const stages = project.stages ?? [];
    const doneCount = stages.filter(s => s.status === 'done').length;
    const progressEl = stages.length > 0
        ? el('span', { class: 'bt-stage-progress' }, `${doneCount}/${stages.length} stages`)
        : null;

    const chevron = el('span', { class: 'bt-chevron' }, '▶');
    const actions = el('div', { class: 'bt-card-actions' });
    const editBtn = el('button', { class: 'bt-icon-btn', title: 'Edit' }, '✎');
    const delBtn = el('button', { class: 'bt-icon-btn bt-icon-danger', title: 'Delete' }, '✕');

    editBtn.addEventListener('click', e => { e.stopPropagation(); openProjectEditor(project, container); });
    delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Delete project "${project.name}"?`)) {
            const s = getChatState();
            s.projects = s.projects.filter(p => p.id !== project.id);
            import('./store.js').then(({ saveChatState }) => { saveChatState(); renderProjects(container); });
        }
    });
    actions.append(editBtn, delBtn);

    const headerInner = el('div', { class: 'bt-card-header-inner' });
    headerInner.append(chevron, nameEl, statusEl);
    if (progressEl) headerInner.appendChild(progressEl);
    headerInner.appendChild(actions);
    header.appendChild(headerInner);

    const detail = el('div', { class: 'bt-card-detail' });
    detail.style.display = 'none';
    buildProjectDetail(project, state, detail, container);

    header.addEventListener('click', () => {
        expanded = !expanded;
        detail.style.display = expanded ? '' : 'none';
        chevron.textContent = expanded ? '▼' : '▶';
        card.classList.toggle('expanded', expanded);
    });

    card.append(header, detail);
    return card;
}

function buildProjectDetail(project, state, container, parentContainer) {
    clearEl(container);

    // Stages
    if (project.stages?.length > 0) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Stages'));
        for (const stage of project.stages) {
            const row = el('div', { class: `bt-stage-row bt-stage-${stage.status}` });
            const statusIcon = { pending: '○', active: '◑', done: '●' }[stage.status] ?? '○';
            const icon = el('span', { class: 'bt-stage-icon' }, statusIcon);
            const nameEl = el('span', { class: 'bt-stage-name' }, stage.name);

            // Toggle stage status button
            const cycleBtn = el('button', { class: 'bt-icon-btn', title: 'Cycle status' }, '↻');
            cycleBtn.addEventListener('click', e => {
                e.stopPropagation();
                const next = { pending: 'active', active: 'done', done: 'pending' };
                stage.status = next[stage.status] ?? 'pending';
                if (stage.status === 'done') stage.completedDate = isoNow();
                upsertProject(project);
                buildProjectDetail(project, state, container, parentContainer);
            });

            row.append(icon, nameEl, cycleBtn);
            s.appendChild(row);
        }
        container.appendChild(s);
    }

    if (project.description) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Description'));
        s.appendChild(el('div', { class: 'bt-detail-text' }, project.description));
        container.appendChild(s);
    }

    // Budget
    if (project.budget || project.spent) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Budget'));
        if (project.budget) s.appendChild(el('div', { class: 'bt-detail-row' },
            `Budget: ${project.budget.amount} ${project.budget.currency ?? ''}`));
        if (project.spent) s.appendChild(el('div', { class: 'bt-detail-row' },
            `Spent: ${project.spent.amount} ${project.spent.currency ?? ''}`));
        container.appendChild(s);
    }

    if (project.notes) {
        const s = el('div', { class: 'bt-detail-section' });
        s.appendChild(el('div', { class: 'bt-detail-label' }, 'Notes'));
        s.appendChild(el('div', { class: 'bt-detail-text' }, project.notes));
        container.appendChild(s);
    }
}

function openProjectEditor(project, container) {
    const isNew = !project;
    const data = project ? { ...project, stages: project.stages ? [...project.stages] : [] } : {
        id: uuid(), name: '', clientId: null, clientName: '', status: 'planning',
        stages: [], budget: null, spent: null, targetDate: null, notes: '',
    };

    document.getElementById('bt-project-editor')?.remove();
    const overlay = el('div', { id: 'bt-project-editor', class: 'bt-editor-overlay' });
    const modal = el('div', { class: 'bt-editor-modal' });
    const title = el('h3', { class: 'bt-editor-title' }, isNew ? 'Add Project' : 'Edit Project');
    const form = el('div', { class: 'bt-editor-form' });

    form.appendChild(buildTextField('Project Name', data.name, v => data.name = v));
    form.appendChild(buildTextField('Client', data.clientName, v => data.clientName = v));
    form.appendChild(buildSelectField('Status', Object.keys(PROJECT_STATUS_LABELS), data.status,
        v => data.status = v, PROJECT_STATUS_LABELS));
    form.appendChild(buildTextField('Target Date', data.targetDate ?? '', v => data.targetDate = v || null));

    // Stages editor
    const stagesSection = el('div', { class: 'bt-field' });
    stagesSection.appendChild(el('label', { class: 'bt-field-label' }, 'Stages'));
    const stagesList = el('div', { class: 'bt-stages-editor' });
    const renderStagesList = () => {
        clearEl(stagesList);
        for (let i = 0; i < data.stages.length; i++) {
            const stage = data.stages[i];
            const row = el('div', { class: 'bt-stage-edit-row' });
            const input = el('input', { type: 'text', class: 'bt-field-input' });
            input.value = stage.name;
            input.addEventListener('input', () => data.stages[i].name = input.value);
            const removeBtn = el('button', { class: 'bt-icon-btn bt-icon-danger' }, '✕');
            removeBtn.addEventListener('click', () => { data.stages.splice(i, 1); renderStagesList(); });
            row.append(input, removeBtn);
            stagesList.appendChild(row);
        }
    };
    renderStagesList();
    const addStageBtn = el('button', { class: 'bt-btn bt-btn-ghost bt-btn-sm' }, '+ Add Stage');
    addStageBtn.addEventListener('click', () => {
        data.stages.push({ id: uuid(), name: '', status: 'pending', payout: null, completedDate: null });
        renderStagesList();
    });
    stagesSection.append(stagesList, addStageBtn);
    form.appendChild(stagesSection);
    form.appendChild(buildTextareaField('Notes', data.notes, v => data.notes = v));

    const btnRow = el('div', { class: 'bt-editor-btns' });
    const saveBtn = el('button', { class: 'bt-btn bt-btn-primary' }, isNew ? 'Add' : 'Save');
    const cancelBtn = el('button', { class: 'bt-btn bt-btn-secondary' }, 'Cancel');
    saveBtn.addEventListener('click', () => {
        if (!data.name.trim()) { alert('Name is required.'); return; }
        upsertProject(data);
        overlay.remove();
        renderProjects(container);
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

function buildTextareaField(label, value, onChange) {
    const wrap = el('div', { class: 'bt-field' });
    wrap.appendChild(el('label', { class: 'bt-field-label' }, label));
    const ta = el('textarea', { class: 'bt-field-input', rows: '3' });
    ta.value = value ?? '';
    ta.addEventListener('input', () => onChange(ta.value));
    wrap.appendChild(ta);
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
