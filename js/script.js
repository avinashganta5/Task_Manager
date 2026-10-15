/* ==========================================================
   TaskFlow — extended
   ========================================================== */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------- DOM shortcuts ---------- */
const taskForm          = $("#taskForm");
const taskInput         = $("#taskInput");
const priorityInput     = $("#priorityInput");
const startDateInput    = $("#startDateInput");
const dueDateInput      = $("#dueDateInput");
const tagsInput         = $("#tagsInput");
const recurrenceInput   = $("#recurrenceInput");
const estimateInput     = $("#estimateInput");
const waitingInput      = $("#waitingInput");
const linksInput        = $("#linksInput");
const customFieldsInput = $("#customFieldsInput");
const taskList          = $("#taskList");
const archiveList       = $("#archiveList");
const trashList         = $("#trashList");
const emptyMessage      = $("#emptyMessage");
const archiveEmpty      = $("#archiveEmpty");
const trashEmpty        = $("#trashEmpty");
const searchInput       = $("#searchInput");
const sortSelect        = $("#sortSelect");
const toastContainer    = $("#toastContainer");
const bulkBar           = $("#bulkBar");
const tagFilters        = $("#tagFilters");
const viewsList         = $("#viewsList");
const quickAddInput     = $("#quickAddInput");
const undoHint          = $("#undoHint");

/* ---------- Constants ---------- */
const FILTERS      = ["all", "active", "completed", "overdue", "today", "pinned", "waiting"];
const PRIORITIES   = ["low", "medium", "high"];
const RECURRENCES  = ["none", "daily", "weekly", "monthly"];
const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
const DUE_DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SUBTASKS = 50;
const MAX_TAGS     = 10;
const MAX_NOTES    = 4000;
const MAX_LINKS    = 20;
const MAX_FIELDS   = 20;
const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UNDO_LIMIT   = 20;
const POMODORO_MIN = 25;

/* ---------- State ---------- */
let tasks = [];
let templates = [];
let savedViews = [];
let currentFilter = "all";
let currentTag = null;
let currentView = "tasks";
let editingId = null;
let storageWarned = false;
let backupHandle = null;

const expandedIds = new Set();
const selectedIds = new Set();
let lastSelectedId = null;

let dragSrcId = null;
let keyboardFocusId = null;

const undoStack = [];

const pomodoro = {
    active: false,
    taskId: null,
    endsAt: 0,
    interval: null
};

const prevStatValues = { total: null, completed: null, remaining: null, overdue: null };

/* ==========================================================
   Utilities
   ========================================================== */

function createId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateString, days) {
    const [y, m, d] = dateString.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function addMonths(dateString, months) {
    const [y, m, d] = dateString.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDate();
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + months);
    const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    dt.setDate(Math.min(day, lastDay));
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function nextDueDate(dateString, recurrence) {
    const base = dateString || todayString();
    switch (recurrence) {
        case "daily":   return addDays(base, 1);
        case "weekly":  return addDays(base, 7);
        case "monthly": return addMonths(base, 1);
        default:        return base;
    }
}

function isOverdue(task) {
    return Boolean(!task.completed && task.dueDate && task.dueDate < todayString());
}

function isDueToday(task) {
    if (task.completed) return false;
    if (task.dueDate === todayString()) return true;
    if (task.startDate && task.startDate <= todayString() &&
        (!task.dueDate || task.dueDate >= todayString())) return true;
    return false;
}

function formatDate(dateString) {
    if (!dateString) return "";
    const [y, m, d] = dateString.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
        day: "numeric", month: "short", year: "numeric"
    });
}

function truncate(text, max = 32) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function pluralize(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function parseTags(raw) {
    if (!raw || typeof raw !== "string") return [];
    const seen = new Set();
    const out = [];
    raw.split(/[,\s]+/).forEach(part => {
        const t = part.replace(/^#+/, "").trim().toLowerCase();
        if (!t || t.length > 24 || seen.has(t)) return;
        seen.add(t);
        out.push(t);
    });
    return out.slice(0, MAX_TAGS);
}

function parseLinks(raw) {
    if (!raw || typeof raw !== "string") return [];
    const out = [];
    const seen = new Set();
    raw.split(/\n+/).forEach(line => {
        const url = line.trim();
        if (!url) return;
        let normalized = url;
        if (!/^https?:\/\//i.test(url)) normalized = "https://" + url;
        try {
            const u = new URL(normalized);
            if (!u.hostname) return;
            if (seen.has(u.href)) return;
            seen.add(u.href);
            out.push({ url: u.href, label: u.hostname.replace(/^www\./, "") });
        } catch { /* skip invalid */ }
    });
    return out.slice(0, MAX_LINKS);
}

function parseCustomFields(raw) {
    if (!raw || typeof raw !== "string") return [];
    const out = [];
    raw.split(/\n+/).forEach(line => {
        const idx = line.indexOf(":");
        if (idx <= 0) return;
        const key = line.slice(0, idx).trim().slice(0, 32);
        const value = line.slice(idx + 1).trim().slice(0, 120);
        if (!key) return;
        out.push({ key, value });
    });
    return out.slice(0, MAX_FIELDS);
}

function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 260) + "px";
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

/* ==========================================================
   Persistence
   ========================================================== */

function normalizeSubtask(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && raw.id ? raw.id : createId();
    const text = typeof raw.text === "string" ? raw.text.slice(0, 200) : "";
    if (!text) return null;
    return { id, text, done: Boolean(raw.done) };
}

function normalizeLink(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.url !== "string" || !raw.url) return null;
    const label = typeof raw.label === "string" && raw.label ? raw.label.slice(0, 80)
                                                             : raw.url.slice(0, 80);
    return { url: raw.url.slice(0, 2000), label };
}

function normalizeCustomField(raw) {
    if (!raw || typeof raw !== "object") return null;
    const key = typeof raw.key === "string" ? raw.key.slice(0, 32) : "";
    const value = typeof raw.value === "string" ? raw.value.slice(0, 120) : "";
    if (!key) return null;
    return { key, value };
}

function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.text !== "string") return null;
    if (typeof raw.completed !== "boolean") return null;
    if (!PRIORITIES.includes(raw.priority)) return null;

    const dueDate = typeof raw.dueDate === "string" ? raw.dueDate : "";
    if (dueDate !== "" && !DUE_DATE_RE.test(dueDate)) return null;
    const startDate = typeof raw.startDate === "string" ? raw.startDate : "";
    if (startDate !== "" && !DUE_DATE_RE.test(startDate)) return null;

    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    const order     = Number.isFinite(raw.order) ? raw.order : createdAt;
    const estimateMin = Number.isFinite(raw.estimateMin) ? Math.max(0, Math.min(1440, raw.estimateMin)) : 0;
    const spentMin    = Number.isFinite(raw.spentMin) ? Math.max(0, raw.spentMin) : 0;
    const snoozeCount = Number.isFinite(raw.snoozeCount) ? Math.max(0, raw.snoozeCount) : 0;

    return {
        id: raw.id,
        text: raw.text,
        notes: typeof raw.notes === "string" ? raw.notes.slice(0, MAX_NOTES) : "",
        priority: raw.priority,
        startDate,
        dueDate,
        completed: raw.completed,
        createdAt,
        order,
        tags: parseTags(Array.isArray(raw.tags) ? raw.tags.join(" ") : String(raw.tags || "")),
        recurrence: RECURRENCES.includes(raw.recurrence) ? raw.recurrence : "none",
        subtasks: Array.isArray(raw.subtasks)
            ? raw.subtasks.map(normalizeSubtask).filter(Boolean).slice(0, MAX_SUBTASKS) : [],
        links: Array.isArray(raw.links)
            ? raw.links.map(normalizeLink).filter(Boolean).slice(0, MAX_LINKS) : [],
        customFields: Array.isArray(raw.customFields)
            ? raw.customFields.map(normalizeCustomField).filter(Boolean).slice(0, MAX_FIELDS) : [],
        pinned: Boolean(raw.pinned),
        archivedAt: Number.isFinite(raw.archivedAt) ? raw.archivedAt : null,
        deletedAt: Number.isFinite(raw.deletedAt) ? raw.deletedAt : null,
        waitingOn: typeof raw.waitingOn === "string" ? raw.waitingOn.slice(0, 80) : "",
        estimateMin,
        spentMin,
        snoozeCount,
        lastSnoozedAt: Number.isFinite(raw.lastSnoozedAt) ? raw.lastSnoozedAt : null
    };
}

function normalizeTasks(list) {
    if (!Array.isArray(list)) return [];
    return list.map(normalizeTask).filter(Boolean);
}

function normalizeTemplate(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && raw.id ? raw.id : createId();
    const name = typeof raw.name === "string" ? raw.name.slice(0, 60) : "";
    if (!name) return null;
    return {
        id,
        name,
        data: {
            text: typeof raw.data?.text === "string" ? raw.data.text : "",
            priority: PRIORITIES.includes(raw.data?.priority) ? raw.data.priority : "medium",
            startDate: DUE_DATE_RE.test(raw.data?.startDate) ? raw.data.startDate : "",
            dueDate: DUE_DATE_RE.test(raw.data?.dueDate) ? raw.data.dueDate : "",
            tags: Array.isArray(raw.data?.tags) ? raw.data.tags.slice(0, MAX_TAGS) : [],
            recurrence: RECURRENCES.includes(raw.data?.recurrence) ? raw.data.recurrence : "none",
            estimateMin: Number.isFinite(raw.data?.estimateMin) ? raw.data.estimateMin : 0,
            waitingOn: typeof raw.data?.waitingOn === "string" ? raw.data.waitingOn : "",
            links: Array.isArray(raw.data?.links) ? raw.data.links.slice(0, MAX_LINKS) : [],
            customFields: Array.isArray(raw.data?.customFields) ? raw.data.customFields.slice(0, MAX_FIELDS) : []
        }
    };
}

function normalizeView(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && raw.id ? raw.id : createId();
    const name = typeof raw.name === "string" ? raw.name.slice(0, 40) : "";
    if (!name) return null;
    return {
        id,
        name,
        filter: FILTERS.includes(raw.filter) ? raw.filter : "all",
        tag: typeof raw.tag === "string" ? raw.tag : null,
        sort: typeof raw.sort === "string" ? raw.sort : "manual",
        query: typeof raw.query === "string" ? raw.query.slice(0, 100) : ""
    };
}

function loadAll() {
    try {
        tasks = normalizeTasks(JSON.parse(localStorage.getItem("taskflow-tasks") || "[]"));
    } catch { tasks = []; }
    try {
        templates = (JSON.parse(localStorage.getItem("taskflow-templates") || "[]") || [])
            .map(normalizeTemplate).filter(Boolean);
    } catch { templates = []; }
    try {
        savedViews = (JSON.parse(localStorage.getItem("taskflow-views") || "[]") || [])
            .map(normalizeView).filter(Boolean);
    } catch { savedViews = []; }
}

function saveTasks() {
    try { localStorage.setItem("taskflow-tasks", JSON.stringify(tasks)); }
    catch {
        if (!storageWarned) {
            storageWarned = true;
            showToast("Could not save tasks — browser storage may be full or blocked.");
        }
    }
}

function saveTemplates() {
    try { localStorage.setItem("taskflow-templates", JSON.stringify(templates)); }
    catch { /* non-critical */ }
}

function saveViews() {
    try { localStorage.setItem("taskflow-views", JSON.stringify(savedViews)); }
    catch { /* non-critical */ }
}

function savePrefs() {
    try {
        localStorage.setItem("taskflow-prefs", JSON.stringify({
            filter: currentFilter,
            tag: currentTag,
            sort: sortSelect.value,
            view: currentView
        }));
    } catch { /* non-critical */ }
}

function loadPrefs() {
    try {
        const prefs = JSON.parse(localStorage.getItem("taskflow-prefs") || "{}");
        if (FILTERS.includes(prefs.filter)) currentFilter = prefs.filter;
        if (typeof prefs.tag === "string" || prefs.tag === null) currentTag = prefs.tag;
        if (["tasks", "archive", "trash"].includes(prefs.view)) currentView = prefs.view;
        if (prefs.sort && sortSelect.querySelector(`option[value="${prefs.sort}"]`)) {
            sortSelect.value = prefs.sort;
        }
    } catch { /* defaults */ }
}

function nextOrder() {
    if (!tasks.length) return 0;
    return Math.min(...tasks.map(t => t.order)) - 1;
}

/* ==========================================================
   Undo stack
   ========================================================== */

function pushUndo(entry) {
    undoStack.push(entry);
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
    updateUndoHint();
}

function popUndo() {
    const entry = undoStack.pop();
    updateUndoHint();
    return entry;
}

function updateUndoHint() {
    if (!undoHint) return;
    undoHint.hidden = undoStack.length === 0;
}

function performUndo() {
    const entry = popUndo();
    if (!entry) return;
    try {
        entry.undo();
        saveTasks();
        saveViews();
        renderTasks();
        showToast(`Undone: ${entry.label}`);
    } catch {
        showToast("Could not undo that action.");
    }
}

/* ==========================================================
   Toasts
   ========================================================== */

function showToast(message, { actionLabel, onAction, duration = 6000 } = {}) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");

    const msg = document.createElement("span");
    msg.className = "toast-message";
    msg.textContent = message;
    toast.appendChild(msg);

    let timer;

    function dismiss() {
        clearTimeout(timer);
        toast.classList.add("leaving");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
        setTimeout(() => toast.remove(), 500);
    }

    if (actionLabel && typeof onAction === "function") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action";
        btn.textContent = actionLabel;
        btn.addEventListener("click", () => {
            try { onAction(); } finally { dismiss(); }
        });
        toast.appendChild(btn);
    }

    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    timer = setTimeout(dismiss, duration);
}

/* ==========================================================
   Statistics
   ========================================================== */

function activeTasks() {
    return tasks.filter(t => !t.deletedAt && !t.archivedAt);
}

function updateStats() {
    const live = activeTasks();
    const completed = live.filter(t => t.completed).length;
    const remaining = live.length - completed;
    const overdue   = live.filter(isOverdue).length;

    setStat("#totalCount",     "total",     live.length);
    setStat("#completedCount", "completed", completed);
    setStat("#remainingCount", "remaining", remaining);
    setStat("#overdueCount",   "overdue",   overdue);

    const footerCount = $("#footerCount");
    if (footerCount) footerCount.textContent = `${pluralize(remaining, "task")} remaining`;

    const pct = live.length ? Math.round((completed / live.length) * 100) : 0;
    const pctEl = $("#progressPercent");
    const barEl = $("#progressBar");
    const trackEl = $("#progressTrack");
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (barEl) barEl.style.width = `${pct}%`;
    if (trackEl) trackEl.setAttribute("aria-valuenow", String(pct));

    const focusLabel = $("#focusTimeLabel");
    if (focusLabel) {
        const focusMin = 0;
        focusLabel.textContent = `Focus time today: ${focusMin}m`;
    }

    updateBulkButtons();
    updateBulkBar();
}

function setStat(selector, key, value) {
    const el = $(selector);
    if (!el) return;
    if (el.textContent === String(value)) return;
    el.textContent = value;
    if (prevStatValues[key] !== null) {
        el.classList.remove("pulse");
        void el.offsetWidth;
        el.classList.add("pulse");
    }
    prevStatValues[key] = value;
}

function updateBulkButtons() {
    const live = activeTasks();
    const completeAllBtn = $("#completeAll");
    const clearCompletedBtn = $("#clearCompleted");
    if (completeAllBtn) completeAllBtn.disabled = !live.some(t => !t.completed);
    if (clearCompletedBtn) clearCompletedBtn.disabled = !live.some(t => t.completed);
}

function updateBulkBar() {
    if (!bulkBar) return;
    const n = selectedIds.size;
    bulkBar.hidden = n === 0 || currentView !== "tasks";
    if (n) {
        const bc = $("#bulkCount");
        if (bc) bc.textContent = n;
    }
}

/* ==========================================================
   Row rendering
   ========================================================== */

function createTaskElement(task, opts = {}) {
    const { inArchive = false, inTrash = false } = opts;

    const item = document.createElement("li");
    item.className = "task-item";
    item.dataset.id = task.id;
    if (task.completed) item.classList.add("done");
    if (task.pinned && !inArchive && !inTrash) item.classList.add("pinned");
    if (selectedIds.has(task.id)) item.classList.add("selected");
    if (keyboardFocusId === task.id) item.classList.add("keyboard-focus");

    if (!inArchive && !inTrash) {
        const select = document.createElement("input");
        select.type = "checkbox";
        select.className = "task-select";
        select.checked = selectedIds.has(task.id);
        select.setAttribute("aria-label", `Select "${task.text}"`);
        select.addEventListener("click", (e) => handleSelectClick(task, e));
        item.appendChild(select);
    } else {
        item.appendChild(document.createElement("span"));
    }

    if (!inArchive && !inTrash) {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "pin-btn" + (task.pinned ? " pinned" : "");
        pin.textContent = task.pinned ? "★" : "☆";
        pin.title = task.pinned ? "Unpin" : "Pin to top";
        pin.setAttribute("aria-label", task.pinned ? `Unpin "${task.text}"` : `Pin "${task.text}"`);
        pin.addEventListener("click", () => togglePin(task));
        item.appendChild(pin);
    }

    if (!inTrash) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-complete";
        checkbox.checked = task.completed;
        checkbox.setAttribute("aria-label",
            task.completed ? `Mark "${task.text}" as active` : `Mark "${task.text}" as complete`);

        checkbox.addEventListener("change", () => {
            const wasCompleted = task.completed;
            task.completed = checkbox.checked;
            if (!wasCompleted && task.completed && task.recurrence !== "none") {
                spawnNextOccurrence(task);
            }
            saveTasks();
            renderTasks();
            const restored = document.querySelector(
                `[data-id="${CSS.escape(task.id)}"] .task-complete`
            );
            (restored || taskList).focus();
        });
        item.appendChild(checkbox);
    }

    const content = document.createElement("div");
    content.className = "task-content";

    const head = document.createElement("div");
    head.className = "task-head";

    const hasDetails = task.notes || task.subtasks.length || task.links.length
                    || task.customFields.length || (!inArchive && !inTrash);
    const isOpen = expandedIds.has(task.id);

    if (hasDetails && !inArchive && !inTrash) {
        const expand = document.createElement("button");
        expand.type = "button";
        expand.className = "expand-btn" + (isOpen ? " open" : "");
        expand.textContent = "▶";
        expand.setAttribute("aria-expanded", String(isOpen));
        expand.setAttribute("aria-label", isOpen ? "Collapse details" : "Expand details");
        expand.addEventListener("click", () => {
            if (isOpen) expandedIds.delete(task.id);
            else expandedIds.add(task.id);
            renderTasks();
        });
        head.appendChild(expand);
    }

    const text = document.createElement("div");
    text.className = "task-text";
    text.textContent = task.text;
    head.appendChild(text);

    content.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const priority = document.createElement("span");
    priority.className = `priority priority-${task.priority}`;
    priority.textContent = task.priority[0].toUpperCase() + task.priority.slice(1);
    meta.appendChild(priority);

    if (task.startDate && !inArchive && !inTrash) {
        const start = document.createElement("span");
        start.className = "start-date";
        start.textContent = `Start ${formatDate(task.startDate)}`;
        meta.appendChild(start);
    }

    if (task.dueDate) {
        const due = document.createElement("span");
        due.className = "due-date";
        if (isOverdue(task)) {
            due.classList.add("overdue");
            due.textContent = `Overdue · ${formatDate(task.dueDate)}`;
        } else {
            due.textContent = `Due ${formatDate(task.dueDate)}`;
        }
        meta.appendChild(due);
    }

    if (task.recurrence !== "none") {
        const rec = document.createElement("span");
        rec.className = "recurrence";
        rec.textContent = `↻ ${task.recurrence}`;
        meta.appendChild(rec);
    }

    if (task.estimateMin > 0) {
        const est = document.createElement("span");
        est.className = "estimate";
        est.textContent = `${task.spentMin > 0 ? `${task.spentMin}/` : ""}${task.estimateMin}m`;
        est.title = "Estimate / spent";
        meta.appendChild(est);
    }

    if (task.waitingOn && !inArchive && !inTrash) {
        const w = document.createElement("span");
        w.className = "waiting";
        w.textContent = `Waiting · ${truncate(task.waitingOn, 20)}`;
        meta.appendChild(w);
    }

    if (task.snoozeCount > 0 && !inArchive && !inTrash) {
        const sn = document.createElement("span");
        sn.className = "snooze";
        sn.textContent = `Snoozed ×${task.snoozeCount}`;
        meta.appendChild(sn);
    }

    if (task.subtasks.length && !inArchive && !inTrash) {
        const done = task.subtasks.filter(s => s.done).length;
        const chip = document.createElement("span");
        chip.className = "subtask-progress" + (done === task.subtasks.length ? " complete" : "");
        chip.textContent = `${done}/${task.subtasks.length} subtasks`;
        meta.appendChild(chip);
    }

    if (inArchive && task.archivedAt) {
        const a = document.createElement("span");
        a.className = "due-date";
        a.textContent = `Archived ${formatDate(new Date(task.archivedAt).toISOString().slice(0, 10))}`;
        meta.appendChild(a);
    }
    if (inTrash && task.deletedAt) {
        const t = document.createElement("span");
        t.className = "due-date";
        t.textContent = `Deleted ${formatDate(new Date(task.deletedAt).toISOString().slice(0, 10))}`;
        meta.appendChild(t);
    }

    task.tags.forEach(tag => {
        const chip = document.createElement("span");
        chip.className = "tag";
        chip.textContent = `#${tag}`;
        chip.addEventListener("click", () => {
            currentTag = currentTag === tag ? null : tag;
            savePrefs();
            renderTasks();
        });
        meta.appendChild(chip);
    });

    content.appendChild(meta);

    if (isOpen && !inArchive && !inTrash) {
        content.appendChild(buildExpandedPanel(task));
    }

    const actions = document.createElement("div");
    actions.className = "task-actions";

    if (inArchive) {
        actions.append(
            makeIconAction("↺", "Restore", `Restore "${task.text}"`, () => restoreTask(task)),
            makeIconAction("✕", "Delete", `Delete "${task.text}"`, () => deleteTask(task))
        );
    } else if (inTrash) {
        actions.append(
            makeIconAction("↺", "Restore", `Restore "${task.text}"`, () => restoreFromTrash(task)),
            makeIconAction("✕", "Purge", `Delete forever "${task.text}"`, () => purgeTask(task))
        );
    } else {
        actions.append(
            makeIconAction("⧉", "Duplicate", `Duplicate "${task.text}"`, () => duplicateTask(task)),
            makeIconAction("💤", "Snooze", `Snooze "${task.text}"`, () => snoozeTask(task)),
            makeIconAction("⤓", "Archive", `Archive "${task.text}"`, () => archiveTask(task)),
            makeEditDelete(task)
        );
    }

    item.appendChild(content);
    item.appendChild(actions);

    if (!inArchive && !inTrash && sortSelect.value === "manual") {
        item.draggable = true;
        attachDragHandlers(item, task);
    }

    return item;
}

function makeIconAction(glyph, text, aria, handler) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-action";
    btn.textContent = glyph;
    btn.title = text;
    btn.setAttribute("aria-label", aria);
    btn.addEventListener("click", handler);
    return btn;
}

function makeEditDelete(task) {
    const wrap = document.createDocumentFragment();

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-action edit-btn";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit "${task.text}"`);
    edit.addEventListener("click", () => startEditing(task));
    wrap.appendChild(edit);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon-action delete-btn";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete "${task.text}"`);
    del.addEventListener("click", () => deleteTask(task));
    wrap.appendChild(del);

    return wrap;
}

/* ==========================================================
   Expanded panel
   ========================================================== */

function buildExpandedPanel(task) {
    const wrap = document.createElement("div");
    wrap.className = "task-expanded";

    const notesBlock = document.createElement("div");
    const nl = document.createElement("label"); nl.textContent = "Notes";
    const notesArea = document.createElement("textarea");
    notesArea.className = "notes-area";
    notesArea.placeholder = "Add details, links, context…";
    notesArea.value = task.notes || "";
    notesArea.rows = 2;
    notesArea.addEventListener("input", () => {
        task.notes = notesArea.value.slice(0, MAX_NOTES);
        autoResize(notesArea);
        debouncedSave();
    });
    notesBlock.append(nl, notesArea);
    wrap.appendChild(notesBlock);

    const inline = document.createElement("div");
    inline.className = "inline-fields";

    const startWrap = document.createElement("div");
    const sl = document.createElement("label"); sl.textContent = "Start date";
    const sd = document.createElement("input");
    sd.type = "date"; sd.value = task.startDate || "";
    sd.addEventListener("change", () => { task.startDate = sd.value; saveTasks(); renderTasks(); });
    startWrap.append(sl, sd);

    const waitWrap = document.createElement("div");
    const wl = document.createElement("label"); wl.textContent = "Waiting on";
    const wi = document.createElement("input");
    wi.type = "text"; wi.maxLength = 80; wi.value = task.waitingOn || "";
    wi.placeholder = "Person or thing";
    wi.addEventListener("change", () => {
        task.waitingOn = wi.value.trim().slice(0, 80);
        saveTasks();
        renderTasks();
    });
    waitWrap.append(wl, wi);

    inline.append(startWrap, waitWrap);
    wrap.appendChild(inline);

    const subBlock = document.createElement("div");
    const subLabel = document.createElement("label");
    subLabel.textContent = `Subtasks${task.subtasks.length ? ` (${task.subtasks.length})` : ""}`;
    subBlock.appendChild(subLabel);

    const subList = document.createElement("ul");
    subList.className = "subtask-list";

    task.subtasks.forEach(sub => {
        const li = document.createElement("li");
        li.className = "subtask-item" + (sub.done ? " done" : "");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = sub.done;
        cb.setAttribute("aria-label", `Toggle "${sub.text}"`);
        cb.addEventListener("change", () => {
            sub.done = cb.checked;
            syncParentCompletion(task);
            saveTasks();
            renderTasks();
        });

        const span = document.createElement("span");
        span.textContent = sub.text;

        const del = document.createElement("button");
        del.type = "button";
        del.className = "subtask-delete";
        del.textContent = "×";
        del.setAttribute("aria-label", `Delete subtask "${sub.text}"`);
        del.addEventListener("click", () => {
            task.subtasks = task.subtasks.filter(s => s.id !== sub.id);
            saveTasks();
            renderTasks();
        });

        li.append(cb, span, del);
        subList.appendChild(li);
    });

    const addRow = document.createElement("div");
    addRow.className = "subtask-add";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "Add a subtask and press Enter";
    addInput.maxLength = 200;
    addInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const v = addInput.value.trim();
        if (!v) return;
        if (task.subtasks.length >= MAX_SUBTASKS) {
            showToast(`Limit of ${MAX_SUBTASKS} subtasks reached.`);
            return;
        }
        task.subtasks.push({ id: createId(), text: v.slice(0, 200), done: false });
        addInput.value = "";
        saveTasks();
        renderTasks();
        document.querySelector(`[data-id="${CSS.escape(task.id)}"] .subtask-add input`)?.focus();
    });
    addRow.appendChild(addInput);

    subBlock.append(subList, addRow);
    wrap.appendChild(subBlock);

    if (task.links.length || true) {
        const linksBlock = document.createElement("div");
        const ll = document.createElement("label"); ll.textContent = "Links";
        const list = document.createElement("div");
        list.className = "link-list";
        task.links.forEach(link => {
            const a = document.createElement("a");
            a.className = "link-chip";
            a.href = link.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = link.label;
            list.appendChild(a);
        });
        linksBlock.append(ll, list);
        wrap.appendChild(linksBlock);
    }

    if (task.customFields.length) {
        const fieldsBlock = document.createElement("div");
        const fl = document.createElement("label"); fl.textContent = "Custom fields";
        const list = document.createElement("div");
        list.className = "field-list";
        task.customFields.forEach(f => {
            const chip = document.createElement("span");
            chip.className = "field-chip";
            chip.innerHTML = `<b>${escapeHtml(f.key)}:</b> ${escapeHtml(f.value)}`;
            list.appendChild(chip);
        });
        fieldsBlock.append(fl, list);
        wrap.appendChild(fieldsBlock);
    }

    requestAnimationFrame(() => autoResize(notesArea));

    return wrap;
}

function syncParentCompletion(task) {
    if (!task.subtasks.length) return;
    task.completed = task.subtasks.every(s => s.done);
}

/* ==========================================================
   Drag to reorder
   ========================================================== */

function attachDragHandlers(item, task) {
    item.addEventListener("dragstart", (e) => {
        if (e.target.closest("input, textarea, button, select, a")) {
            e.preventDefault();
            return;
        }
        dragSrcId = task.id;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
    });

    item.addEventListener("dragend", () => {
        dragSrcId = null;
        $$(".task-item").forEach(el => el.classList.remove("dragging", "drag-over-top", "drag-over-bottom"));
    });

    item.addEventListener("dragover", (e) => {
        if (!dragSrcId || dragSrcId === task.id) return;
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        $$(".task-item").forEach(el => el.classList.remove("drag-over-top", "drag-over-bottom"));
        item.classList.add(before ? "drag-over-top" : "drag-over-bottom");
    });

    item.addEventListener("dragleave", () => {
        item.classList.remove("drag-over-top", "drag-over-bottom");
    });

    item.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!dragSrcId || dragSrcId === task.id) return;
        const rect = item.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        reorderTasks(dragSrcId, task.id, before);
        dragSrcId = null;
    });
}

function reorderTasks(sourceId, targetId, insertBefore) {
    const visibleOrder = getVisibleTasks().map(t => t.id);
    const from = visibleOrder.indexOf(sourceId);
    if (from === -1) return;

    visibleOrder.splice(from, 1);
    let to = visibleOrder.indexOf(targetId);
    if (to === -1) to = visibleOrder.length;
    visibleOrder.splice(insertBefore ? to : to + 1, 0, sourceId);

    const visibleSet = new Set(visibleOrder);
    const reordered = tasks.slice();
    let cursor = 0;
    for (let i = 0; i < reordered.length; i++) {
        if (visibleSet.has(reordered[i].id)) {
            reordered[i] = tasks.find(t => t.id === visibleOrder[cursor++]);
        }
    }
    reordered.forEach((t, i) => { t.order = i; });

    const before = tasks;
    tasks = reordered;
    pushUndo({
        label: "reorder",
        undo: () => { tasks = before; }
    });

    saveTasks();
    renderTasks();
}

/* ==========================================================
   Selection
   ========================================================== */

function handleSelectClick(task, event) {
    if (event.shiftKey && lastSelectedId) {
        const visible = getVisibleTasks().map(t => t.id);
        const a = visible.indexOf(lastSelectedId);
        const b = visible.indexOf(task.id);
        if (a !== -1 && b !== -1) {
            const [from, to] = a < b ? [a, b] : [b, a];
            for (let i = from; i <= to; i++) selectedIds.add(visible[i]);
            updateBulkBar();
            renderTasks();
            return;
        }
    }
    if (selectedIds.has(task.id)) selectedIds.delete(task.id);
    else { selectedIds.add(task.id); lastSelectedId = task.id; }
    updateBulkBar();
    renderTasks();
}

function clearSelection() {
    selectedIds.clear();
    lastSelectedId = null;
    updateBulkBar();
    renderTasks();
}

/* ==========================================================
   Task actions
   ========================================================== */

function togglePin(task) {
    task.pinned = !task.pinned;
    saveTasks();
    renderTasks();
}

function archiveTask(task) {
    task.archivedAt = Date.now();
    selectedIds.delete(task.id);
    expandedIds.delete(task.id);
    saveTasks();
    renderTasks();

    showToast(`Archived "${truncate(task.text)}"`, {
        actionLabel: "Undo",
        onAction: () => {
            task.archivedAt = null;
            saveTasks();
            renderTasks();
        }
    });
}

function restoreTask(task) {
    const prev = task.archivedAt;
    task.archivedAt = null;
    saveTasks();
    renderTasks();
    showToast(`Restored "${truncate(task.text)}"`, {
        actionLabel: "Undo",
        onAction: () => {
            task.archivedAt = prev;
            saveTasks();
            renderTasks();
        }
    });
}

function deleteTask(task) {
    const prev = task.deletedAt;
    task.deletedAt = Date.now();
    if (editingId === task.id) resetForm();
    selectedIds.delete(task.id);
    expandedIds.delete(task.id);
    saveTasks();
    renderTasks();

    showToast(`Moved to trash "${truncate(task.text)}"`, {
        actionLabel: "Undo",
        onAction: () => {
            task.deletedAt = prev;
            saveTasks();
            renderTasks();
        }
    });
}

function restoreFromTrash(task) {
    const prev = task.deletedAt;
    task.deletedAt = null;
    saveTasks();
    renderTasks();
    showToast(`Restored "${truncate(task.text)}"`, {
        actionLabel: "Undo",
        onAction: () => {
            task.deletedAt = prev;
            saveTasks();
            renderTasks();
        }
    });
}

function purgeTask(task) {
    const index = tasks.findIndex(t => t.id === task.id);
    if (index === -1) return;
    const [removed] = tasks.splice(index, 1);
    saveTasks();
    renderTasks();

    showToast(`Permanently deleted "${truncate(removed.text)}"`, {
        actionLabel: "Undo",
        onAction: () => {
            tasks.splice(index, 0, removed);
            saveTasks();
            renderTasks();
        }
    });
}

function duplicateTask(task) {
    const copy = {
        ...task,
        id: createId(),
        completed: false,
        createdAt: Date.now(),
        order: task.order - 0.5,
        subtasks: task.subtasks.map(s => ({ id: createId(), text: s.text, done: false })),
        deletedAt: null,
        archivedAt: null,
        snoozeCount: 0,
        spentMin: 0
    };
    tasks.push(copy);
    tasks.sort((a, b) => a.order - b.order).forEach((t, i) => { t.order = i; });
    saveTasks();
    renderTasks();
    showToast(`Duplicated "${truncate(task.text)}"`);
}

function snoozeTask(task) {
    const base = task.dueDate || todayString();
    const next = addDays(base, 1);
    task.dueDate = next;
    task.snoozeCount = (task.snoozeCount || 0) + 1;
    task.lastSnoozedAt = Date.now();
    saveTasks();
    renderTasks();
    showToast(`Snoozed to ${formatDate(next)} (${task.snoozeCount}×)`, {
        actionLabel: "Undo",
        onAction: () => {
            task.dueDate = base;
            task.snoozeCount = Math.max(0, task.snoozeCount - 1);
            saveTasks();
            renderTasks();
        }
    });
}

function clearCompleted() {
    const removed = activeTasks().filter(t => t.completed);
    if (!removed.length) return;

    removed.forEach(r => {
        r.deletedAt = Date.now();
        selectedIds.delete(r.id);
        expandedIds.delete(r.id);
        if (editingId === r.id) resetForm();
    });

    saveTasks();
    renderTasks();

    showToast(`Trashed ${pluralize(removed.length, "completed task")}`, {
        actionLabel: "Undo",
        onAction: () => {
            removed.forEach(r => { r.deletedAt = null; });
            saveTasks();
            renderTasks();
        }
    });
}

function completeAllVisible() {
    const targets = getVisibleTasks().filter(t => !t.completed);
    if (!targets.length) return;
    const before = targets.map(t => t.id);
    targets.forEach(t => { t.completed = true; });
    saveTasks();
    renderTasks();
    showToast(`Completed ${pluralize(targets.length, "task")}`, {
        actionLabel: "Undo",
        onAction: () => {
            before.forEach(id => {
                const t = tasks.find(x => x.id === id);
                if (t) t.completed = false;
            });
            saveTasks();
            renderTasks();
        }
    });
}

function spawnNextOccurrence(task) {
    const nextDate = task.dueDate
        ? nextDueDate(task.dueDate, task.recurrence)
        : nextDueDate(todayString(), task.recurrence);

    tasks.push({
        id: createId(),
        text: task.text,
        notes: task.notes,
        priority: task.priority,
        startDate: "",
        dueDate: nextDate,
        completed: false,
        createdAt: Date.now(),
        order: nextOrder(),
        tags: [...task.tags],
        recurrence: task.recurrence,
        subtasks: task.subtasks.map(s => ({ id: createId(), text: s.text, done: false })),
        links: [...task.links],
        customFields: [...task.customFields],
        pinned: false,
        archivedAt: null,
        deletedAt: null,
        waitingOn: task.waitingOn,
        estimateMin: task.estimateMin,
        spentMin: 0,
        snoozeCount: 0,
        lastSnoozedAt: null
    });

    showToast(`Repeats ${task.recurrence} · next due ${formatDate(nextDate)}`);
}

/* ==========================================================
   Bulk actions
   ========================================================== */

function bulkApply(action, value) {
    const targets = tasks.filter(t => selectedIds.has(t.id));
    if (!targets.length) return;

    const snapshots = targets.map(t => ({ id: t.id, before: { ...t } }));

    switch (action) {
        case "complete":
            targets.forEach(t => { t.completed = true; });
            showToast(`Completed ${pluralize(targets.length, "task")}`);
            break;
        case "uncomplete":
            targets.forEach(t => { t.completed = false; });
            showToast(`Reopened ${pluralize(targets.length, "task")}`);
            break;
        case "pin":
            targets.forEach(t => { t.pinned = true; });
            showToast(`Pinned ${pluralize(targets.length, "task")}`);
            break;
        case "archive":
            targets.forEach(t => { t.archivedAt = Date.now(); });
            showToast(`Archived ${pluralize(targets.length, "task")}`);
            break;
        case "priority":
            if (!PRIORITIES.includes(value)) return;
            targets.forEach(t => { t.priority = value; });
            showToast(`Set ${pluralize(targets.length, "task")} to ${value}`);
            break;
        case "delete":
            targets.forEach(t => { t.deletedAt = Date.now(); });
            showToast(`Moved ${pluralize(targets.length, "task")} to trash`);
            break;
    }

    pushUndo({
        label: `bulk ${action}`,
        undo: () => {
            snapshots.forEach(({ id, before }) => {
                const idx = tasks.findIndex(t => t.id === id);
                if (idx !== -1) tasks[idx] = before;
            });
        }
    });

    selectedIds.clear();
    saveTasks();
    renderTasks();
}

/* ==========================================================
   Search / filter / sort
   ========================================================== */

function getVisibleTasks() {
    const query = searchInput.value.trim().toLowerCase();
    const sort = sortSelect.value;

    const filtered = activeTasks().filter(task => {
        const matchesSearch = !query
            || task.text.toLowerCase().includes(query)
            || task.notes.toLowerCase().includes(query)
            || task.tags.some(t => t.includes(query))
            || task.waitingOn.toLowerCase().includes(query);

        const matchesFilter =
            currentFilter === "all" ||
            (currentFilter === "active"    && !task.completed) ||
            (currentFilter === "completed" &&  task.completed) ||
            (currentFilter === "overdue"   && isOverdue(task)) ||
            (currentFilter === "today"     && isDueToday(task)) ||
            (currentFilter === "pinned"    && task.pinned) ||
            (currentFilter === "waiting"   && task.waitingOn && !task.completed);

        const matchesTag = !currentTag || task.tags.includes(currentTag);

        return matchesSearch && matchesFilter && matchesTag;
    });

    filtered.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

        switch (sort) {
            case "oldest":      return a.createdAt - b.createdAt;
            case "priority":    return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
                                     || (b.createdAt - a.createdAt);
            case "startDate":
                if (!a.startDate && !b.startDate) return b.createdAt - a.createdAt;
                if (!a.startDate) return 1;
                if (!b.startDate) return -1;
                return a.startDate.localeCompare(b.startDate);
            case "dueDate":
                if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return a.dueDate.localeCompare(b.dueDate);
            case "alphabetical": return a.text.localeCompare(b.text);
            case "manual":       return a.order - b.order;
            default:             return b.createdAt - a.createdAt;
        }
    });

    return filtered;
}

/* ==========================================================
   Rendering
   ========================================================== */

function getEmptyCopy() {
    const live = activeTasks();
    if (!live.length) {
        return { icon: "✦", title: "No tasks yet", body: "Add your first task to get started." };
    }
    const query = searchInput.value.trim();
    if (query) return { icon: "⌕", title: "No matches", body: `Nothing matches "${truncate(query, 40)}".` };
    if (currentTag) return { icon: "#", title: `No #${currentTag} tasks`, body: "Try a different tag or clear the filter." };
    switch (currentFilter) {
        case "overdue":   return { icon: "🎉", title: "Nothing overdue", body: "You're all caught up." };
        case "completed": return { icon: "◌", title: "Nothing completed yet", body: "Check off a task to see it here." };
        case "active":    return { icon: "✓", title: "No active tasks", body: "Everything is done. Nice work." };
        case "today":     return { icon: "☀", title: "Nothing due today", body: "Enjoy the calm." };
        case "pinned":    return { icon: "★", title: "No pinned tasks", body: "Pin tasks to keep them at the top." };
        case "waiting":   return { icon: "⏳", title: "Nothing waiting", body: "No tasks are blocked right now." };
        default:          return { icon: "✦", title: "No matching tasks", body: "Try another search or filter." };
    }
}

function renderTagFilters() {
    const allTags = new Set();
    activeTasks().forEach(t => t.tags.forEach(tag => allTags.add(tag)));

    if (!allTags.size) {
        tagFilters.hidden = true;
        tagFilters.replaceChildren();
        if (currentTag) { currentTag = null; savePrefs(); }
        return;
    }

    tagFilters.hidden = false;
    tagFilters.replaceChildren();

    [...allTags].sort().forEach(tag => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tag-chip" + (currentTag === tag ? " active" : "");
        btn.textContent = `#${tag}`;
        btn.setAttribute("aria-pressed", String(currentTag === tag));
        btn.addEventListener("click", () => {
            currentTag = currentTag === tag ? null : tag;
            savePrefs();
            renderTasks();
        });
        tagFilters.appendChild(btn);
    });
}

function renderViews() {
    viewsList.replaceChildren();

    savedViews.forEach(view => {
        const chip = document.createElement("span");
        chip.className = "view-chip" + (matchesCurrentPrefs(view) ? " active" : "");

        const label = document.createElement("button");
        label.type = "button";
        label.style.background = "transparent";
        label.style.border = "none";
        label.style.color = "inherit";
        label.style.font = "inherit";
        label.style.padding = "0";
        label.textContent = view.name;
        label.addEventListener("click", () => applyView(view));

        const del = document.createElement("button");
        del.type = "button";
        del.className = "view-del";
        del.textContent = "×";
        del.title = "Delete view";
        del.setAttribute("aria-label", `Delete view ${view.name}`);
        del.addEventListener("click", (e) => {
            e.stopPropagation();
            const snapshot = [...savedViews];
            savedViews = savedViews.filter(v => v.id !== view.id);
            pushUndo({
                label: `delete view "${view.name}"`,
                undo: () => { savedViews = snapshot; }
            });
            saveViews();
            renderViews();
        });

        chip.append(label, del);
        viewsList.appendChild(chip);
    });
}

function matchesCurrentPrefs(view) {
    return view.filter === currentFilter
        && view.tag === currentTag
        && view.sort === sortSelect.value
        && view.query === searchInput.value.trim();
}

function applyView(view) {
    currentFilter = view.filter;
    currentTag = view.tag;
    sortSelect.value = view.sort;
    searchInput.value = view.query;
    $$(".filter").forEach(btn => {
        const active = btn.dataset.filter === view.filter;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
    });
    savePrefs();
    renderTasks();
    renderViews();
}

function renderCurrentView() {
    $("#tasksView").hidden = currentView !== "tasks";
    $("#archiveView").hidden = currentView !== "archive";
    $("#trashView").hidden = currentView !== "trash";
    $("#viewsBar").hidden = currentView !== "tasks";
    $("#emptyTrashBtn").hidden = currentView !== "trash";

    const titles = {
        tasks:   { title: "My tasks",       sub: "Organize your work in one place." },
        archive: { title: "Archive",        sub: "Hidden from your main list." },
        trash:   { title: "Trash",          sub: "Deleted within the last 30 days." }
    };
    $("#panelTitle").textContent = titles[currentView].title;
    $("#panelSubtitle").textContent = titles[currentView].sub;

    $$(".nav-tab").forEach(tab => {
        const active = tab.dataset.view === currentView;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
    });

    if (currentView === "tasks") {
        taskList.replaceChildren();
        const visible = getVisibleTasks();
        visible.forEach(task => taskList.appendChild(createTaskElement(task)));
        emptyMessage.hidden = visible.length > 0;
        if (!visible.length) {
            const { icon, title, body } = getEmptyCopy();
            emptyMessage.querySelector(".empty-icon").textContent = icon;
            emptyMessage.querySelector("h3").textContent = title;
            emptyMessage.querySelector("p").textContent = body;
        }
        renderTagFilters();
    } else if (currentView === "archive") {
        archiveList.replaceChildren();
        const archived = tasks.filter(t => t.archivedAt && !t.deletedAt)
            .sort((a, b) => b.archivedAt - a.archivedAt);
        archived.forEach(t => archiveList.appendChild(createTaskElement(t, { inArchive: true })));
        archiveEmpty.hidden = archived.length > 0;
    } else if (currentView === "trash") {
        trashList.replaceChildren();
        const trashed = tasks.filter(t => t.deletedAt)
            .sort((a, b) => b.deletedAt - a.deletedAt);
        trashed.forEach(t => trashList.appendChild(createTaskElement(t, { inTrash: true })));
        trashEmpty.hidden = trashed.length > 0;
    }

    updateStats();
}

/* ==========================================================
   Right rail widgets
   ========================================================== */

function renderRail() {
    try {
        renderUpcoming();
        renderPinned();
        renderRailTags();
    } catch (err) {
        console.warn("Rail render skipped:", err);
    }
}

function renderUpcoming() {
    const list = document.getElementById("upcomingList");
    const empty = document.getElementById("upcomingEmpty");
    const badge = document.getElementById("upcomingCount");
    if (!list || !empty || !badge) return;

    const today = todayString();
    const upcoming = activeTasks()
        .filter(t => !t.completed && t.dueDate)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 6);

    list.replaceChildren();
    badge.textContent = upcoming.length;
    empty.hidden = upcoming.length > 0;

    upcoming.forEach(task => {
        const li = document.createElement("li");
        li.className = "rail-item";
        li.addEventListener("click", () => {
            currentView = "tasks";
            setFilter("all");
            expandedIds.add(task.id);
            renderTasks();
            const el = document.querySelector(`[data-id="${CSS.escape(task.id)}"]`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        const overdue = task.dueDate < today;
        const soon = !overdue && task.dueDate === today;

        const dot = document.createElement("span");
        dot.className = "rail-item-dot" + (overdue ? " overdue" : soon ? " soon" : "");

        const body = document.createElement("div");
        body.className = "rail-item-body";

        const title = document.createElement("div");
        title.className = "rail-item-title";
        title.textContent = task.text;

        const date = document.createElement("div");
        date.className = "rail-item-date" + (overdue ? " overdue" : soon ? " soon" : "");
        date.textContent = overdue ? `Overdue · ${formatDate(task.dueDate)}`
                        : soon    ? `Today`
                                  : formatDate(task.dueDate);

        body.append(title, date);
        li.append(dot, body);
        list.appendChild(li);
    });
}

function renderPinned() {
    const list = document.getElementById("pinnedList");
    const empty = document.getElementById("pinnedEmpty");
    const badge = document.getElementById("pinnedCount");
    if (!list || !empty || !badge) return;

    const pinned = activeTasks().filter(t => t.pinned && !t.completed).slice(0, 6);

    list.replaceChildren();
    badge.textContent = pinned.length;
    empty.hidden = pinned.length > 0;

    pinned.forEach(task => {
        const li = document.createElement("li");
        li.className = "rail-item";
        li.addEventListener("click", () => {
            currentView = "tasks";
            setFilter("pinned");
            renderTasks();
        });

        const dot = document.createElement("span");
        dot.className = "rail-item-dot pinned";

        const body = document.createElement("div");
        body.className = "rail-item-body";

        const title = document.createElement("div");
        title.className = "rail-item-title";
        title.textContent = task.text;

        const date = document.createElement("div");
        date.className = "rail-item-date";
        date.textContent = task.dueDate ? formatDate(task.dueDate) : "No due date";

        body.append(title, date);
        li.append(dot, body);
        list.appendChild(li);
    });
}

function renderRailTags() {
    const wrap = document.getElementById("railTags");
    const empty = document.getElementById("railTagsEmpty");
    if (!wrap || !empty) return;

    const counts = new Map();
    activeTasks().forEach(t => t.tags.forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
    }));

    wrap.replaceChildren();
    empty.hidden = counts.size > 0;

    [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .forEach(([tag, n]) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "rail-tag";
            const label = document.createElement("span");
            label.textContent = `#${tag}`;
            const count = document.createElement("span");
            count.className = "rail-tag-count";
            count.textContent = n;
            btn.append(label, count);
            btn.addEventListener("click", () => {
                currentTag = currentTag === tag ? null : tag;
                savePrefs();
                renderTasks();
            });
            wrap.appendChild(btn);
        });
}

function renderTasks() {
    renderCurrentView();
    renderViews();
    renderRail();
}

/* ==========================================================
   Add / edit tasks
   ========================================================== */

let saveTimer = null;
function debouncedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveTasks, 350);
}

taskForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = taskInput.value.trim();
    const priority = priorityInput.value;
    const startDate = startDateInput.value;
    const dueDate = dueDateInput.value;
    const tags = parseTags(tagsInput.value);
    const recurrence = recurrenceInput.value;
    const estimateMin = Number(estimateInput.value) || 0;
    const waitingOn = waitingInput.value.trim().slice(0, 80);
    const links = parseLinks(linksInput.value);
    const customFields = parseCustomFields(customFieldsInput.value);

    if (!text) { taskInput.focus(); return; }

    if (startDate && !DUE_DATE_RE.test(startDate)) { showToast("Invalid start date."); return; }
    if (dueDate && !DUE_DATE_RE.test(dueDate)) { showToast("Invalid due date."); return; }

    if (editingId) {
        const task = tasks.find(t => t.id === editingId);
        if (task) {
            const before = { ...task };
            task.text = text;
            task.priority = priority;
            task.startDate = startDate;
            task.dueDate = dueDate;
            task.tags = tags;
            task.recurrence = recurrence;
            task.estimateMin = estimateMin;
            task.waitingOn = waitingOn;
            task.links = links;
            task.customFields = customFields;
            pushUndo({
                label: "edit",
                undo: () => { Object.assign(task, before); }
            });
        }
        resetForm();
        saveTasks();
        renderTasks();
        showToast("Task updated");
        return;
    }

    const task = {
        id: createId(),
        text,
        notes: "",
        priority,
        startDate,
        dueDate,
        completed: false,
        createdAt: Date.now(),
        order: nextOrder(),
        tags,
        recurrence,
        subtasks: [],
        links,
        customFields,
        pinned: false,
        archivedAt: null,
        deletedAt: null,
        waitingOn,
        estimateMin,
        spentMin: 0,
        snoozeCount: 0,
        lastSnoozedAt: null
    };

    tasks.push(task);
    pushUndo({
        label: "add task",
        undo: () => { tasks = tasks.filter(t => t.id !== task.id); }
    });

    resetForm();
    saveTasks();
    renderTasks();
    taskInput.focus();
});

function startEditing(task) {
    editingId = task.id;
    taskInput.value = task.text;
    priorityInput.value = task.priority;
    startDateInput.value = task.startDate || "";
    dueDateInput.value = task.dueDate || "";
    tagsInput.value = task.tags.join(", ");
    recurrenceInput.value = task.recurrence;
    estimateInput.value = task.estimateMin || "";
    waitingInput.value = task.waitingOn || "";
    linksInput.value = task.links.map(l => l.url).join("\n");
    customFieldsInput.value = task.customFields.map(f => `${f.key}: ${f.value}`).join("\n");

    $("#submitBtn").textContent = "Save changes";
    $("#cancelEdit").hidden = false;

    taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
    taskInput.focus();
    taskInput.select();
}

function resetForm() {
    editingId = null;
    taskForm.reset();
    priorityInput.value = "medium";
    recurrenceInput.value = "none";
    $("#submitBtn").textContent = "+ Add task";
    $("#cancelEdit").hidden = true;
}

$("#cancelEdit").addEventListener("click", () => {
    resetForm();
    taskInput.focus();
});

/* ==========================================================
   Templates
   ========================================================== */

function currentFormData() {
    return {
        text: taskInput.value.trim(),
        priority: priorityInput.value,
        startDate: startDateInput.value,
        dueDate: dueDateInput.value,
        tags: parseTags(tagsInput.value),
        recurrence: recurrenceInput.value,
        estimateMin: Number(estimateInput.value) || 0,
        waitingOn: waitingInput.value.trim(),
        links: parseLinks(linksInput.value),
        customFields: parseCustomFields(customFieldsInput.value)
    };
}

$("#saveTemplateBtn").addEventListener("click", () => {
    const data = currentFormData();
    if (!data.text && !data.tags.length && !data.customFields.length) {
        showToast("Fill the form first, then save as a template.");
        return;
    }
    const name = prompt("Template name:", data.text || "Untitled template");
    if (!name) return;
    templates.push({
        id: createId(),
        name: name.slice(0, 60),
        data
    });
    saveTemplates();
    showToast(`Saved template "${name}"`);
});

$("#templatesBtn").addEventListener("click", () => {
    $("#moreMenu").open = false;
    renderTemplatesList();
    $("#templatesDialog").showModal();
});

function renderTemplatesList() {
    const list = $("#templatesList");
    list.replaceChildren();

    if (!templates.length) {
        const p = document.createElement("li");
        p.style.color = "var(--muted)";
        p.style.fontSize = "13px";
        p.textContent = "No templates yet. Fill the task form, then click “Save as template”.";
        list.appendChild(p);
        return;
    }

    templates.forEach(tpl => {
        const li = document.createElement("li");
        li.className = "template-row";

        const name = document.createElement("span");
        name.className = "template-name";
        name.textContent = tpl.name;

        const use = document.createElement("button");
        use.type = "button";
        use.className = "template-use";
        use.textContent = "Use";
        use.addEventListener("click", () => {
            applyTemplate(tpl);
            $("#templatesDialog").close();
        });

        const del = document.createElement("button");
        del.type = "button";
        del.className = "template-del";
        del.textContent = "Delete";
        del.addEventListener("click", () => {
            const snapshot = [...templates];
            templates = templates.filter(x => x.id !== tpl.id);
            pushUndo({ label: `delete template "${tpl.name}"`, undo: () => { templates = snapshot; } });
            saveTemplates();
            renderTemplatesList();
        });

        li.append(name, use, del);
        list.appendChild(li);
    });
}

function applyTemplate(tpl) {
    taskInput.value = tpl.data.text || "";
    priorityInput.value = tpl.data.priority || "medium";
    startDateInput.value = tpl.data.startDate || "";
    dueDateInput.value = tpl.data.dueDate || "";
    tagsInput.value = (tpl.data.tags || []).join(", ");
    recurrenceInput.value = tpl.data.recurrence || "none";
    estimateInput.value = tpl.data.estimateMin || "";
    waitingInput.value = tpl.data.waitingOn || "";
    linksInput.value = (tpl.data.links || []).map(l => l.url).join("\n");
    customFieldsInput.value = (tpl.data.customFields || [])
        .map(f => `${f.key}: ${f.value}`).join("\n");
    taskInput.focus();
    taskInput.select();
    showToast(`Loaded template "${tpl.name}"`);
}

/* ==========================================================
   Saved views
   ========================================================== */

$("#saveViewBtn").addEventListener("click", () => {
    const name = prompt("Name this view:", `${currentFilter}${currentTag ? ` · #${currentTag}` : ""}`);
    if (!name) return;
    savedViews.push({
        id: createId(),
        name: name.slice(0, 40),
        filter: currentFilter,
        tag: currentTag,
        sort: sortSelect.value,
        query: searchInput.value.trim()
    });
    saveViews();
    renderViews();
    showToast(`Saved view "${name}"`);
});

/* ==========================================================
   Controls
   ========================================================== */

function setFilter(next) {
    if (!FILTERS.includes(next)) return;
    currentFilter = next;
    $$(".filter").forEach(btn => {
        const active = btn.dataset.filter === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
    });
    savePrefs();
    renderTasks();
}

$$(".filter").forEach(btn => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
});

searchInput.addEventListener("input", renderTasks);
sortSelect.addEventListener("change", () => { savePrefs(); renderTasks(); });

$("#completeAll").addEventListener("click", completeAllVisible);
$("#clearCompleted").addEventListener("click", clearCompleted);

$("#bulkComplete").addEventListener("click", () => bulkApply("complete"));
$("#bulkUncomplete").addEventListener("click", () => bulkApply("uncomplete"));
$("#bulkPin").addEventListener("click", () => bulkApply("pin"));
$("#bulkArchive").addEventListener("click", () => bulkApply("archive"));
$("#bulkDelete").addEventListener("click", () => bulkApply("delete"));
$("#bulkClear").addEventListener("click", clearSelection);
$("#bulkPriority").addEventListener("change", (e) => {
    const value = e.target.value;
    e.target.value = "";
    if (!value) return;
    bulkApply("priority", value);
});

$$(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        currentView = tab.dataset.view;
        clearSelection();
        savePrefs();
        renderTasks();
    });
});

document.addEventListener("click", (e) => {
    const menu = $("#moreMenu");
    if (menu.open && !menu.contains(e.target)) menu.open = false;
});

/* ==========================================================
   Import / Export / Backup
   ========================================================== */

function exportTasks() {
    const data = JSON.stringify({
        version: 2,
        exportedAt: new Date().toISOString(),
        tasks
    }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taskflow-backup-${todayString()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${pluralize(tasks.length, "task")}`);
    $("#moreMenu").open = false;
}

$("#exportBtn").addEventListener("click", exportTasks);

$("#importBtn").addEventListener("click", () => {
    $("#moreMenu").open = false;
    $("#importDialog").showModal();
});

$("#importDialog").addEventListener("close", () => {
    if ($("#importDialog").returnValue !== "confirm") return;
    $("#importFile").click();
});

$("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const mode = document.querySelector('input[name="importMode"]:checked')?.value || "merge";

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const rawList = Array.isArray(parsed) ? parsed
                       : Array.isArray(parsed?.tasks) ? parsed.tasks : null;
        if (!rawList) throw new Error("Unrecognized file format");

        const imported = normalizeTasks(rawList);
        if (!imported.length) throw new Error("No valid tasks found in file");

        const before = tasks.slice();

        if (mode === "replace") {
            tasks = imported;
            selectedIds.clear();
            expandedIds.clear();
            if (editingId) resetForm();
        } else {
            const existing = new Set(tasks.map(t => t.id));
            const fresh = imported.filter(t => !existing.has(t.id));
            let start = nextOrder() - fresh.length;
            fresh.forEach(t => { t.order = start++; });
            tasks.push(...fresh);
        }

        pushUndo({ label: "import", undo: () => { tasks = before; } });
        saveTasks();
        renderTasks();
        showToast(`Imported ${pluralize(imported.length, "task")} (${mode})`);
    } catch (err) {
        showToast("Import failed: " + err.message);
    }
});

$("#clearAllBtn").addEventListener("click", () => {
    $("#moreMenu").open = false;
    if (!tasks.length) return;
    if (!confirm(`Move all ${pluralize(tasks.length, "task")} to trash?`)) return;
    const before = tasks.map(t => ({ id: t.id, deletedAt: t.deletedAt }));
    const now = Date.now();
    tasks.forEach(t => { t.deletedAt = t.deletedAt || now; });
    pushUndo({
        label: "clear all",
        undo: () => {
            before.forEach(({ id, deletedAt }) => {
                const t = tasks.find(x => x.id === id);
                if (t) t.deletedAt = deletedAt;
            });
        }
    });
    saveTasks();
    renderTasks();
    showToast("All tasks moved to trash");
});

$("#emptyTrashBtn").addEventListener("click", () => {
    $("#moreMenu").open = false;
    const trashed = tasks.filter(t => t.deletedAt);
    if (!trashed.length) return;
    if (!confirm(`Permanently delete ${pluralize(trashed.length, "task")}?`)) return;
    const snapshot = tasks.slice();
    tasks = tasks.filter(t => !t.deletedAt);
    pushUndo({ label: "empty trash", undo: () => { tasks = snapshot; } });
    saveTasks();
    renderTasks();
    showToast("Trash emptied");
});

async function enableDailyBackup() {
    $("#moreMenu").open = false;

    if (!window.showSaveFilePicker) {
        showToast("Daily backup isn't supported in this browser. Use Export instead.");
        return;
    }

    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: `taskflow-backup-${todayString()}.json`,
            types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
        });
        backupHandle = handle;
        await performBackup();
        showToast("Daily backup enabled for this session");

        try {
            localStorage.setItem("taskflow-backup-enabled", "true");
        } catch { /* ignore */ }
    } catch (err) {
        if (err.name !== "AbortError") showToast("Backup setup failed.");
    }
}

async function performBackup() {
    if (!backupHandle) return;
    try {
        const writable = await backupHandle.createWritable();
        await writable.write(JSON.stringify({
            version: 2,
            exportedAt: new Date().toISOString(),
            tasks
        }, null, 2));
        await writable.close();
        try {
            localStorage.setItem("taskflow-backup-last", todayString());
        } catch { /* ignore */ }
    } catch { /* ignore */ }
}

$("#backupBtn").addEventListener("click", enableDailyBackup);

/* ==========================================================
   Quick add
   ========================================================== */

$("#quickAdd").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = quickAddInput.value.trim();
    if (!text) return;

    const task = {
        id: createId(),
        text,
        notes: "",
        priority: "medium",
        startDate: "",
        dueDate: "",
        completed: false,
        createdAt: Date.now(),
        order: nextOrder(),
        tags: [],
        recurrence: "none",
        subtasks: [],
        links: [],
        customFields: [],
        pinned: false,
        archivedAt: null,
        deletedAt: null,
        waitingOn: "",
        estimateMin: 0,
        spentMin: 0,
        snoozeCount: 0,
        lastSnoozedAt: null
    };
    tasks.push(task);
    pushUndo({
        label: "quick add",
        undo: () => { tasks = tasks.filter(t => t.id !== task.id); }
    });
    quickAddInput.value = "";
    saveTasks();
    renderTasks();
    showToast(`Added "${truncate(text)}"`, {
        actionLabel: "Edit",
        onAction: () => startEditing(task)
    });
});

/* ==========================================================
   Focus mode + Pomodoro
   ========================================================== */

let focusTaskId = null;

function enterFocusMode() {
    const next = pickFocusTask();
    if (!next) {
        $("#focusStage").hidden = true;
        $("#focusEmpty").hidden = false;
    } else {
        focusTaskId = next.id;
        renderFocusTask(next);
    }
    $("#focusOverlay").hidden = false;
    document.body.style.overflow = "hidden";
}

function exitFocusMode() {
    $("#focusOverlay").hidden = true;
    document.body.style.overflow = "";
    focusTaskId = null;
}

function pickFocusTask() {
    const pinned = getVisibleTasks().filter(t => t.pinned && !t.completed);
    if (pinned.length) return pinned[0];
    const overdue = getVisibleTasks().filter(t => isOverdue(t));
    if (overdue.length) return overdue[0];
    const active = getVisibleTasks().filter(t => !t.completed);
    return active[0] || null;
}

function renderFocusTask(task) {
    $("#focusStage").hidden = false;
    $("#focusEmpty").hidden = true;
    $("#focusTitle").textContent = task.text;

    const meta = $("#focusMeta");
    meta.replaceChildren();

    const p = document.createElement("span");
    p.className = `priority priority-${task.priority}`;
    p.textContent = task.priority[0].toUpperCase() + task.priority.slice(1);
    meta.appendChild(p);

    if (task.dueDate) {
        const d = document.createElement("span");
        d.className = "due-date" + (isOverdue(task) ? " overdue" : "");
        d.textContent = `Due ${formatDate(task.dueDate)}`;
        meta.appendChild(d);
    }
    if (task.estimateMin > 0) {
        const e = document.createElement("span");
        e.className = "estimate";
        e.textContent = `${task.spentMin}/${task.estimateMin}m`;
        meta.appendChild(e);
    }

    const btn = $("#focusPomodoro");
    if (pomodoro.active && pomodoro.taskId === task.id) {
        btn.textContent = "Stop timer";
    } else {
        btn.textContent = `Start ${POMODORO_MIN}m`;
    }
    $("#focusRing").hidden = !(pomodoro.active && pomodoro.taskId === task.id);
    if (!pomodoro.active) updatePomodoroRing(1);
}

function completeFocusTask() {
    const task = tasks.find(t => t.id === focusTaskId);
    if (!task) return;
    task.completed = true;
    if (task.recurrence !== "none") spawnNextOccurrence(task);
    saveTasks();
    renderTasks();
    const next = pickFocusTask();
    if (next) { focusTaskId = next.id; renderFocusTask(next); }
    else {
        $("#focusStage").hidden = true;
        $("#focusEmpty").hidden = false;
    }
}

function skipFocusTask() {
    const visible = getVisibleTasks().filter(t => !t.completed && t.id !== focusTaskId);
    if (!visible.length) {
        $("#focusStage").hidden = true;
        $("#focusEmpty").hidden = false;
        return;
    }
    focusTaskId = visible[0].id;
    renderFocusTask(visible[0]);
}

$("#focusBtn").addEventListener("click", enterFocusMode);
$("#focusExit").addEventListener("click", exitFocusMode);
$("#focusComplete").addEventListener("click", completeFocusTask);
$("#focusSkip").addEventListener("click", skipFocusTask);

function startPomodoro(taskId) {
    pomodoro.active = true;
    pomodoro.taskId = taskId;
    pomodoro.endsAt = Date.now() + POMODORO_MIN * 60 * 1000;
    if (pomodoro.interval) clearInterval(pomodoro.interval);
    pomodoro.interval = setInterval(tickPomodoro, 1000);
    $("#focusRing").hidden = false;
    $("#focusPomodoro").textContent = "Stop timer";
    tickPomodoro();
}

function stopPomodoro() {
    if (!pomodoro.active) return;
    const elapsedMin = Math.round((POMODORO_MIN * 60 * 1000 - (pomodoro.endsAt - Date.now())) / 60000);
    const task = tasks.find(t => t.id === pomodoro.taskId);
    if (task && elapsedMin > 0) {
        task.spentMin = (task.spentMin || 0) + elapsedMin;
        saveTasks();
    }
    clearInterval(pomodoro.interval);
    pomodoro.active = false;
    pomodoro.taskId = null;
    pomodoro.endsAt = 0;
    $("#focusRing").hidden = true;
    $("#focusPomodoro").textContent = `Start ${POMODORO_MIN}m`;
    renderTasks();
}

function tickPomodoro() {
    const msLeft = pomodoro.endsAt - Date.now();
    const total = POMODORO_MIN * 60 * 1000;
    const ratio = Math.max(0, Math.min(1, msLeft / total));

    const mins = Math.floor(Math.max(0, msLeft) / 60000);
    const secs = Math.floor((Math.max(0, msLeft) % 60000) / 1000);
    $("#focusTime").textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    updatePomodoroRing(ratio);

    if (msLeft <= 0) {
        stopPomodoro();
        showToast("Pomodoro complete — take a break ☕");
    }
}

function updatePomodoroRing(ratio) {
    const ring = $("#ringProgress");
    if (!ring) return;
    const circumference = 2 * Math.PI * 54;
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference * (1 - ratio));
}

$("#focusPomodoro").addEventListener("click", () => {
    if (pomodoro.active && pomodoro.taskId === focusTaskId) stopPomodoro();
    else if (focusTaskId) startPomodoro(focusTaskId);
});

/* ==========================================================
   Help dialog
   ========================================================== */

$("#helpBtn").addEventListener("click", () => $("#helpDialog").showModal());

/* ==========================================================
   Keyboard shortcuts
   ========================================================== */

document.addEventListener("keydown", (event) => {
    const tag = (event.target.tagName || "").toLowerCase();
    const inField = tag === "input" || tag === "textarea" || tag === "select"
                 || event.target.isContentEditable;

    if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "k") {
            event.preventDefault();
            searchInput.focus(); searchInput.select();
            return;
        }
        if (event.key.toLowerCase() === "z") {
            event.preventDefault();
            performUndo();
            return;
        }
    }

    if (event.key === "Escape") {
        if (focusOverlayOpen()) { exitFocusMode(); return; }
        if ($("#templatesDialog").open || $("#helpDialog").open) return;
        if (editingId) { resetForm(); taskInput.focus(); return; }
        if (document.activeElement === searchInput && searchInput.value) {
            searchInput.value = ""; renderTasks();
        }
        return;
    }

    if (inField) return;

    switch (event.key) {
        case "n": case "N":
            event.preventDefault();
            taskInput.focus();
            break;
        case "q": case "Q":
            event.preventDefault();
            quickAddInput.focus();
            break;
        case "f": case "F":
            event.preventDefault();
            focusOverlayOpen() ? exitFocusMode() : enterFocusMode();
            break;
        case "?":
            event.preventDefault();
            $("#helpDialog").showModal();
            break;
        case "j": case "J":
            event.preventDefault();
            moveKeyboardFocus(1);
            break;
        case "k": case "K":
            event.preventDefault();
            moveKeyboardFocus(-1);
            break;
        case "x": case "X":
            if (keyboardFocusId) {
                const t = tasks.find(x => x.id === keyboardFocusId);
                if (t) { t.completed = !t.completed; saveTasks(); renderTasks(); }
            }
            break;
        case "e": case "E":
            if (keyboardFocusId) {
                const t = tasks.find(x => x.id === keyboardFocusId);
                if (t) startEditing(t);
            }
            break;
        case "Backspace": case "Delete":
            if (keyboardFocusId) {
                const t = tasks.find(x => x.id === keyboardFocusId);
                if (t) { deleteTask(t); }
            }
            break;
    }
});

function focusOverlayOpen() { return !$("#focusOverlay").hidden; }

function moveKeyboardFocus(delta) {
    const visible = getVisibleTasks().map(t => t.id);
    if (!visible.length) return;
    let idx = visible.indexOf(keyboardFocusId);
    idx = idx === -1 ? (delta > 0 ? 0 : visible.length - 1) : idx + delta;
    idx = Math.max(0, Math.min(visible.length - 1, idx));
    keyboardFocusId = visible[idx];
    renderTasks();
    const el = document.querySelector(`[data-id="${CSS.escape(keyboardFocusId)}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/* ==========================================================
   Theme
   ========================================================== */

const themeToggle = $("#themeToggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    if (themeToggle) {
        themeToggle.innerHTML = dark
            ? '<span class="nav-ico">◑</span> Switch theme'
            : '<span class="nav-ico">◐</span> Switch theme';
    }
    if (themeMeta) themeMeta.setAttribute("content", dark ? "#14172a" : "#5b54e8");
    try { localStorage.setItem("taskflow-theme", dark ? "dark" : "light"); }
    catch { /* session-only */ }
}

function getInitialTheme() {
    try {
        const stored = localStorage.getItem("taskflow-theme");
        if (stored === "dark" || stored === "light") return stored === "dark";
    } catch { /* ignore */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

themeToggle.addEventListener("click", () => {
    applyTheme(!document.body.classList.contains("dark"));
});

/* ==========================================================
   Cross-tab sync
   ========================================================== */

window.addEventListener("storage", (event) => {
    if (event.key === "taskflow-tasks") {
        try {
            tasks = normalizeTasks(JSON.parse(event.newValue) || []);
            if (editingId && !tasks.some(t => t.id === editingId)) resetForm();
            renderTasks();
        } catch { /* ignore */ }
    } else if (event.key === "taskflow-theme") {
        applyTheme(event.newValue === "dark");
    } else if (event.key === "taskflow-templates") {
        try { templates = (JSON.parse(event.newValue) || []).map(normalizeTemplate).filter(Boolean); }
        catch { /* ignore */ }
    } else if (event.key === "taskflow-views") {
        try { savedViews = (JSON.parse(event.newValue) || []).map(normalizeView).filter(Boolean);
              renderViews(); }
        catch { /* ignore */ }
    }
});

/* ==========================================================
   Trash auto-purge
   ========================================================== */

function purgeExpiredTrash() {
    const cutoff = Date.now() - TRASH_TTL_MS;
    const before = tasks.length;
    tasks = tasks.filter(t => !(t.deletedAt && t.deletedAt < cutoff));
    if (tasks.length !== before) saveTasks();
}

/* ==========================================================
   Undo hint button
   ========================================================== */

const undoBtn = $("#undoBtn");
if (undoBtn) undoBtn.addEventListener("click", performUndo);

/* ==========================================================
   Boot
   ========================================================== */

(function init() {
    applyTheme(getInitialTheme());
    loadPrefs();
    loadAll();
    purgeExpiredTrash();

    $$(".filter").forEach(btn => {
        const active = btn.dataset.filter === currentFilter;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
    });

    renderTasks();

    try {
        const enabled = localStorage.getItem("taskflow-backup-enabled") === "true";
        const last = localStorage.getItem("taskflow-backup-last");
        if (enabled && last !== todayString()) {
            showToast("Daily backup is enabled — click to save today's backup.", {
                actionLabel: "Backup now",
                onAction: enableDailyBackup,
                duration: 12000
            });
        }
    } catch { /* ignore */ }
})();