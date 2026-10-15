/* ==========================================================
   TaskFlow — task manager
   ========================================================== */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const taskForm        = $("#taskForm");
const taskInput       = $("#taskInput");
const priorityInput   = $("#priorityInput");
const dueDateInput    = $("#dueDateInput");
const tagsInput       = $("#tagsInput");
const recurrenceInput = $("#recurrenceInput");
const taskList        = $("#taskList");
const emptyMessage    = $("#emptyMessage");
const searchInput     = $("#searchInput");
const sortSelect      = $("#sortSelect");
const toastContainer  = $("#toastContainer");
const bulkBar         = $("#bulkBar");
const tagFilters      = $("#tagFilters");

const FILTERS        = ["all", "active", "completed", "overdue"];
const PRIORITIES     = ["low", "medium", "high"];
const RECURRENCES    = ["none", "daily", "weekly", "monthly"];
const PRIORITY_RANK  = { high: 3, medium: 2, low: 1 };
const DUE_DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SUBTASKS   = 50;
const MAX_TAGS       = 10;
const MAX_NOTES      = 4000;

let tasks = [];
let currentFilter = "all";
let currentTag = null;
let editingId = null;
let storageWarned = false;

const expandedIds = new Set();   // task ids with details open
const selectedIds = new Set();   // task ids selected for bulk ops
let lastSelectedId = null;

let dragSrcId = null;

const prevStatValues = { total: null, completed: null, remaining: null, overdue: null };

/* ==========================================================
   Utilities
   ========================================================== */

function createId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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
    // Clamp to last day of month
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
        if (!t || t.length > 24) return;
        if (seen.has(t)) return;
        seen.add(t);
        out.push(t);
    });
    return out.slice(0, MAX_TAGS);
}

function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 260) + "px";
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

function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.text !== "string") return null;
    if (typeof raw.completed !== "boolean") return null;
    if (!PRIORITIES.includes(raw.priority)) return null;

    const dueDate = typeof raw.dueDate === "string" ? raw.dueDate : "";
    if (dueDate !== "" && !DUE_DATE_RE.test(dueDate)) return null;

    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    const order     = Number.isFinite(raw.order) ? raw.order : createdAt;

    const subtasks = Array.isArray(raw.subtasks)
        ? raw.subtasks.map(normalizeSubtask).filter(Boolean).slice(0, MAX_SUBTASKS)
        : [];

    return {
        id: raw.id,
        text: raw.text,
        notes: typeof raw.notes === "string" ? raw.notes.slice(0, MAX_NOTES) : "",
        priority: raw.priority,
        dueDate,
        completed: raw.completed,
        createdAt,
        order,
        tags: parseTags(Array.isArray(raw.tags) ? raw.tags.join(" ") : String(raw.tags || "")),
        recurrence: RECURRENCES.includes(raw.recurrence) ? raw.recurrence : "none",
        subtasks
    };
}

function normalizeTasks(list) {
    if (!Array.isArray(list)) return [];
    return list.map(normalizeTask).filter(Boolean);
}

function loadTasks() {
    try {
        const raw = JSON.parse(localStorage.getItem("taskflow-tasks") || "[]");
        return normalizeTasks(raw);
    } catch {
        return [];
    }
}

function saveTasks() {
    try {
        localStorage.setItem("taskflow-tasks", JSON.stringify(tasks));
    } catch {
        if (!storageWarned) {
            storageWarned = true;
            showToast("Could not save tasks — browser storage may be full or blocked.");
        }
    }
}

function savePrefs() {
    try {
        localStorage.setItem("taskflow-prefs", JSON.stringify({
            filter: currentFilter,
            sort: sortSelect.value,
            tag: currentTag
        }));
    } catch { /* non-critical */ }
}

function loadPrefs() {
    try {
        const prefs = JSON.parse(localStorage.getItem("taskflow-prefs") || "{}");
        if (FILTERS.includes(prefs.filter)) currentFilter = prefs.filter;
        if (typeof prefs.tag === "string" || prefs.tag === null) currentTag = prefs.tag;
        if (prefs.sort && sortSelect.querySelector(`option[value="${prefs.sort}"]`)) {
            sortSelect.value = prefs.sort;
        }
    } catch { /* use defaults */ }
}

function nextOrder() {
    if (!tasks.length) return 0;
    return Math.min(...tasks.map(t => t.order)) - 1;
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

function updateStats() {
    const completed = tasks.filter(t => t.completed).length;
    const remaining = tasks.length - completed;
    const overdue   = tasks.filter(isOverdue).length;

    setStat("#totalCount",     "total",     tasks.length);
    setStat("#completedCount", "completed", completed);
    setStat("#remainingCount", "remaining", remaining);
    setStat("#overdueCount",   "overdue",   overdue);

    $("#footerCount").textContent = `${pluralize(remaining, "task")} remaining`;

    const percentage = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
    $("#progressPercent").textContent = `${percentage}%`;
    $("#progressBar").style.width = `${percentage}%`;
    $("#progressTrack").setAttribute("aria-valuenow", String(percentage));

    updateBulkButtons();
    updateBulkBar();
}

function setStat(selector, key, value) {
    const el = $(selector);
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
    $("#completeAll").disabled    = !tasks.some(t => !t.completed);
    $("#clearCompleted").disabled = !tasks.some(t => t.completed);
}

function updateBulkBar() {
    const n = selectedIds.size;
    bulkBar.hidden = n === 0;
    if (n) $("#bulkCount").textContent = n;
}

/* ==========================================================
   Task element factory
   ========================================================== */

function createTaskElement(task) {
    const item = document.createElement("li");
    item.className = "task-item";
    item.dataset.id = task.id;
    if (task.completed) item.classList.add("done");
    if (selectedIds.has(task.id)) item.classList.add("selected");

    /* --- Bulk select checkbox --- */
    const select = document.createElement("input");
    select.type = "checkbox";
    select.className = "task-select";
    select.checked = selectedIds.has(task.id);
    select.setAttribute("aria-label", `Select "${task.text}"`);
    select.addEventListener("click", (e) => handleSelectClick(task, e));

    /* --- Complete checkbox --- */
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

        const restored = taskList.querySelector(
            `[data-id="${CSS.escape(task.id)}"] .task-complete`
        );
        (restored || taskList).focus();
    });

    /* --- Content --- */
    const content = document.createElement("div");
    content.className = "task-content";

    const head = document.createElement("div");
    head.className = "task-head";

    const hasDetails = task.notes || task.subtasks.length > 0;
    const isOpen = expandedIds.has(task.id);

    if (hasDetails) {
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

    /* --- Meta --- */
    const meta = document.createElement("div");
    meta.className = "task-meta";

    const priority = document.createElement("span");
    priority.className = `priority priority-${task.priority}`;
    priority.textContent = task.priority[0].toUpperCase() + task.priority.slice(1);
    meta.appendChild(priority);

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
        rec.title = `Repeats ${task.recurrence}`;
        meta.appendChild(rec);
    }

    if (task.subtasks.length) {
        const done = task.subtasks.filter(s => s.done).length;
        const chip = document.createElement("span");
        chip.className = "subtask-progress" + (done === task.subtasks.length ? " complete" : "");
        chip.textContent = `${done}/${task.subtasks.length} subtasks`;
        meta.appendChild(chip);
    }

    task.tags.forEach(tag => {
        const chip = document.createElement("span");
        chip.className = "tag";
        chip.textContent = `#${tag}`;
        chip.title = `Filter by #${tag}`;
        chip.addEventListener("click", () => {
            currentTag = currentTag === tag ? null : tag;
            savePrefs();
            renderTasks();
        });
        meta.appendChild(chip);
    });

    content.appendChild(meta);

    /* --- Expanded panel (notes + subtasks) --- */
    if (isOpen) {
        content.appendChild(buildExpandedPanel(task));
    }

    /* --- Actions --- */
    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-btn";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit "${task.text}"`);
    editButton.addEventListener("click", () => startEditing(task));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-btn";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete "${task.text}"`);
    deleteButton.addEventListener("click", () => deleteTask(task));

    actions.append(editButton, deleteButton);
    item.append(select, checkbox, content, actions);

    /* --- Drag to reorder (only in manual mode) --- */
    if (sortSelect.value === "manual") {
        item.draggable = true;
        attachDragHandlers(item, task);
    }

    return item;
}

/* ==========================================================
   Expanded panel: notes + subtasks
   ========================================================== */

function buildExpandedPanel(task) {
    const wrap = document.createElement("div");
    wrap.className = "task-expanded";

    /* Notes */
    const notesBlock = document.createElement("div");
    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Notes";
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
    notesBlock.append(notesLabel, notesArea);
    wrap.appendChild(notesBlock);

    /* Subtasks */
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
        // Refocus the same task's add-input after re-render
        const nextInput = taskList.querySelector(
            `[data-id="${CSS.escape(task.id)}"] .subtask-add input`
        );
        nextInput?.focus();
    });
    addRow.appendChild(addInput);

    subBlock.append(subList, addRow);
    wrap.appendChild(subBlock);

    // Resize any auto-grow textareas after mount
    requestAnimationFrame(() => autoResize(notesArea));

    return wrap;
}

function syncParentCompletion(task) {
    if (!task.subtasks.length) return;
    const allDone = task.subtasks.every(s => s.done);
    task.completed = allDone;
}

/* ==========================================================
   Drag to reorder
   ========================================================== */

function attachDragHandlers(item, task) {
    item.addEventListener("dragstart", (e) => {
        // Don't start drag from inside interactive elements
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
        $$(".task-item").forEach(el => {
            el.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
        });
    });

    item.addEventListener("dragover", (e) => {
        if (!dragSrcId || dragSrcId === task.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

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
    let to = visibleOrder.indexOf(targetId);
    if (from === -1 || to === -1) return;

    visibleOrder.splice(from, 1);
    to = visibleOrder.indexOf(targetId);
    if (to === -1) to = visibleOrder.length;
    visibleOrder.splice(insertBefore ? to : to + 1, 0, sourceId);

    // Rewrite `order` by slotting the new visible sequence into the existing array,
    // leaving hidden tasks (filtered out) exactly where they were.
    const newSeq = visibleOrder.slice();
    const visibleSet = new Set(newSeq);
    const reordered = tasks.slice();

    // Replace each visible slot with the next entry from newSeq
    let cursor = 0;
    for (let i = 0; i < reordered.length; i++) {
        if (visibleSet.has(reordered[i].id)) {
            reordered[i] = tasks.find(t => t.id === newSeq[cursor++]);
        }
    }

    // Reassign sequential `order` values
    reordered.forEach((t, i) => { t.order = i; });

    tasks = reordered;

    saveTasks();
    renderTasks();
    showToast("Order updated");
}

/* ==========================================================
   Bulk selection
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

    if (selectedIds.has(task.id)) {
        selectedIds.delete(task.id);
    } else {
        selectedIds.add(task.id);
        lastSelectedId = task.id;
    }
    updateBulkBar();
    renderTasks();
}

function clearSelection() {
    selectedIds.clear();
    lastSelectedId = null;
    updateBulkBar();
    renderTasks();
}

function bulkApply(action, value) {
    const targets = tasks.filter(t => selectedIds.has(t.id));
    if (!targets.length) return;

    switch (action) {
        case "complete":
            targets.forEach(t => { t.completed = true; });
            showToast(`Completed ${pluralize(targets.length, "task")}`);
            break;
        case "uncomplete":
            targets.forEach(t => { t.completed = false; });
            showToast(`Reopened ${pluralize(targets.length, "task")}`);
            break;
        case "priority":
            if (!PRIORITIES.includes(value)) return;
            targets.forEach(t => { t.priority = value; });
            showToast(`Set ${pluralize(targets.length, "task")} to ${value}`);
            break;
        case "delete": {
            const removed = targets.slice();
            tasks = tasks.filter(t => !selectedIds.has(t.id));
            removed.forEach(r => {
                if (editingId === r.id) resetForm();
            });
            showToast(`Deleted ${pluralize(removed.length, "task")}`, {
                actionLabel: "Undo",
                onAction: () => {
                    tasks.push(...removed);
                    saveTasks();
                    renderTasks();
                }
            });
            selectedIds.clear();
            lastSelectedId = null;
            break;
        }
    }

    saveTasks();
    renderTasks();
}

/* ==========================================================
   Task operations
   ========================================================== */

function spawnNextOccurrence(task) {
    const nextDate = task.dueDate
        ? nextDueDate(task.dueDate, task.recurrence)
        : nextDueDate(todayString(), task.recurrence);

    tasks.push({
        id: createId(),
        text: task.text,
        notes: task.notes,
        priority: task.priority,
        dueDate: nextDate,
        completed: false,
        createdAt: Date.now(),
        order: nextOrder(),
        tags: [...task.tags],
        recurrence: task.recurrence,
        subtasks: task.subtasks.map(s => ({ id: createId(), text: s.text, done: false }))
    });

    showToast(`Repeats ${task.recurrence} · next due ${formatDate(nextDate)}`);
}

function deleteTask(task) {
    const index = tasks.findIndex(t => t.id === task.id);
    if (index === -1) return;

    const [removed] = tasks.splice(index, 1);
    if (editingId === removed.id) resetForm();
    selectedIds.delete(removed.id);
    expandedIds.delete(removed.id);

    saveTasks();
    renderTasks();

    showToast(`Deleted "${truncate(removed.text)}"`, {
        actionLabel: "Undo",
        onAction: () => {
            tasks.splice(Math.min(index, tasks.length), 0, removed);
            saveTasks();
            renderTasks();
        }
    });
}

function clearCompleted() {
    const removed = tasks.filter(t => t.completed);
    if (!removed.length) return;

    removed.forEach(r => {
        selectedIds.delete(r.id);
        expandedIds.delete(r.id);
        if (editingId === r.id) resetForm();
    });

    tasks = tasks.filter(t => !t.completed);
    saveTasks();
    renderTasks();

    showToast(`Cleared ${pluralize(removed.length, "completed task")}`, {
        actionLabel: "Undo",
        onAction: () => {
            tasks.push(...removed);
            saveTasks();
            renderTasks();
        }
    });
}

function completeAllVisible() {
    const targets = getVisibleTasks().filter(t => !t.completed);
    if (!targets.length) return;

    targets.forEach(t => { t.completed = true; });
    saveTasks();
    renderTasks();
    showToast(`Completed ${pluralize(targets.length, "task")}`);
}

/* ==========================================================
   Search / filter / sort
   ========================================================== */

function getVisibleTasks() {
    const query = searchInput.value.trim().toLowerCase();
    const sort = sortSelect.value;

    const filtered = tasks.filter(task => {
        const matchesSearch = !query
            || task.text.toLowerCase().includes(query)
            || task.notes.toLowerCase().includes(query)
            || task.tags.some(t => t.includes(query));

        const matchesFilter =
            currentFilter === "all" ||
            (currentFilter === "active"    && !task.completed) ||
            (currentFilter === "completed" &&  task.completed) ||
            (currentFilter === "overdue"   && isOverdue(task));

        const matchesTag = !currentTag || task.tags.includes(currentTag);

        return matchesSearch && matchesFilter && matchesTag;
    });

    filtered.sort((a, b) => {
        switch (sort) {
            case "oldest":      return a.createdAt - b.createdAt;
            case "priority":    return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
                                     || (b.createdAt - a.createdAt);
            case "dueDate":
                if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return a.dueDate.localeCompare(b.dueDate) || (b.createdAt - a.createdAt);
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
    if (!tasks.length) {
        return { icon: "✦", title: "No tasks yet", body: "Add your first task to get started." };
    }
    const query = searchInput.value.trim();
    if (query) {
        return { icon: "⌕", title: "No matches", body: `Nothing matches "${truncate(query, 40)}".` };
    }
    if (currentTag) {
        return { icon: "#", title: `No #${currentTag} tasks`, body: "Try a different tag or clear the filter." };
    }
    switch (currentFilter) {
        case "overdue":   return { icon: "🎉", title: "Nothing overdue", body: "You're all caught up." };
        case "completed": return { icon: "◌", title: "Nothing completed yet", body: "Check off a task to see it here." };
        case "active":    return { icon: "✓", title: "No active tasks", body: "Everything is done. Nice work." };
        default:          return { icon: "✦", title: "No matching tasks", body: "Try another search or filter." };
    }
}

function renderTagFilters() {
    const allTags = new Set();
    tasks.forEach(t => t.tags.forEach(tag => allTags.add(tag)));

    if (!allTags.size) {
        tagFilters.hidden = true;
        tagFilters.replaceChildren();
        if (currentTag) { currentTag = null; savePrefs(); }
        return;
    }

    tagFilters.hidden = false;
    tagFilters.replaceChildren();

    const sorted = [...allTags].sort();
    sorted.forEach(tag => {
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

function renderTasks() {
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
    updateStats();
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
    const dueDate = dueDateInput.value;
    const tags = parseTags(tagsInput.value);
    const recurrence = recurrenceInput.value;

    if (!text) { taskInput.focus(); return; }

    if (dueDate && !DUE_DATE_RE.test(dueDate)) {
        showToast("Please select a valid due date.");
        return;
    }

    if (editingId) {
        const task = tasks.find(t => t.id === editingId);
        if (task) {
            task.text = text;
            task.priority = priority;
            task.dueDate = dueDate;
            task.tags = tags;
            task.recurrence = recurrence;
        }
        resetForm();
        saveTasks();
        renderTasks();
        showToast("Task updated");
        return;
    }

    tasks.push({
        id: createId(),
        text,
        notes: "",
        priority,
        dueDate,
        completed: false,
        createdAt: Date.now(),
        order: nextOrder(),
        tags,
        recurrence,
        subtasks: []
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
    dueDateInput.value = task.dueDate || "";
    tagsInput.value = task.tags.join(", ");
    recurrenceInput.value = task.recurrence;

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

sortSelect.addEventListener("change", () => {
    savePrefs();
    renderTasks();
});

$("#completeAll").addEventListener("click", completeAllVisible);
$("#clearCompleted").addEventListener("click", clearCompleted);

/* Bulk bar */
$("#bulkComplete").addEventListener("click", () => bulkApply("complete"));
$("#bulkUncomplete").addEventListener("click", () => bulkApply("uncomplete"));
$("#bulkDelete").addEventListener("click", () => bulkApply("delete"));
$("#bulkClear").addEventListener("click", clearSelection);
$("#bulkPriority").addEventListener("change", (e) => {
    const value = e.target.value;
    e.target.value = "";
    if (!value) return;
    bulkApply("priority", value);
});

/* Close overflow menu on outside click */
document.addEventListener("click", (e) => {
    const menu = $("#moreMenu");
    if (menu.open && !menu.contains(e.target)) menu.open = false;
});

/* ==========================================================
   Import / Export
   ========================================================== */

function exportTasks() {
    const data = JSON.stringify({
        version: 1,
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

        if (mode === "replace") {
            tasks = imported;
            selectedIds.clear();
            expandedIds.clear();
            if (editingId) resetForm();
        } else {
            const existing = new Set(tasks.map(t => t.id));
            const fresh = imported.filter(t => !existing.has(t.id));
            // Reassign order so imports land at the top of manual order
            let start = nextOrder() - fresh.length;
            fresh.forEach(t => { t.order = start++; });
            tasks.push(...fresh);
        }

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
    if (!confirm(`Delete all ${pluralize(tasks.length, "task")}? This cannot be undone.`)) return;
    tasks = [];
    selectedIds.clear();
    expandedIds.clear();
    resetForm();
    saveTasks();
    renderTasks();
    showToast("All tasks cleared");
});

/* ==========================================================
   Keyboard shortcuts
   ========================================================== */

document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
    }

    if (event.key === "Escape") {
        if ($("#importDialog").open) return; // dialog handles its own Escape
        if (editingId) {
            resetForm();
            taskInput.focus();
            return;
        }
        if (document.activeElement === searchInput && searchInput.value) {
            searchInput.value = "";
            renderTasks();
        }
    }
});

/* ==========================================================
   Theme
   ========================================================== */

const themeToggle = $("#themeToggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    themeToggle.textContent = dark ? "☀️" : "🌙";
    themeToggle.setAttribute("aria-label",
        dark ? "Switch to light mode" : "Switch to dark mode");
    if (themeMeta) themeMeta.setAttribute("content", dark ? "#1c1e2a" : "#635bff");
    try {
        localStorage.setItem("taskflow-theme", dark ? "dark" : "light");
    } catch { /* session-only */ }
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
        } catch { /* ignore malformed updates */ }
    } else if (event.key === "taskflow-theme") {
        applyTheme(event.newValue === "dark");
    }
});

/* ==========================================================
   Boot
   ========================================================== */

(function init() {
    applyTheme(getInitialTheme());
    loadPrefs();

    // Sync visible filter buttons with `currentFilter` (from prefs)
    $$(".filter").forEach(btn => {
        const active = btn.dataset.filter === currentFilter;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
    });

    tasks = loadTasks();
    renderTasks();
})();