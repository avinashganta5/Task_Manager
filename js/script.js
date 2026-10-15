/* ==========================================================
   TaskFlow — task manager
   ========================================================== */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const taskForm       = $("#taskForm");
const taskInput      = $("#taskInput");
const priorityInput  = $("#priorityInput");
const dueDateInput   = $("#dueDateInput");
const taskList       = $("#taskList");
const emptyMessage   = $("#emptyMessage");
const searchInput    = $("#searchInput");
const sortSelect     = $("#sortSelect");
const toastContainer = $("#toastContainer");

const FILTERS = ["all", "active", "completed", "overdue"];
const PRIORITIES = ["low", "medium", "high"];
const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let tasks = [];
let currentFilter = "all";
let editingId = null;
let storageWarned = false;
const prevStatValues = { total: null, completed: null, remaining: null, overdue: null };

/* ==========================================================
   Utilities
   ========================================================== */

function createId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for non-secure contexts
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Local (not UTC) YYYY-MM-DD — avoids the "overdue at 11pm" bug.
function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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

/* ==========================================================
   Persistence
   ========================================================== */

function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (typeof raw.text !== "string") return null;
    if (typeof raw.completed !== "boolean") return null;
    if (!PRIORITIES.includes(raw.priority)) return null;

    const dueDate = typeof raw.dueDate === "string" ? raw.dueDate : "";
    if (dueDate !== "" && !DUE_DATE_RE.test(dueDate)) return null;

    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();

    return { id: raw.id, text: raw.text, priority: raw.priority, dueDate, completed: raw.completed, createdAt };
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
            sort: sortSelect.value
        }));
    } catch { /* non-critical */ }
}

function loadPrefs() {
    try {
        const prefs = JSON.parse(localStorage.getItem("taskflow-prefs") || "{}");
        if (FILTERS.includes(prefs.filter)) currentFilter = prefs.filter;
        if (prefs.sort && sortSelect.querySelector(`option[value="${prefs.sort}"]`)) {
            sortSelect.value = prefs.sort;
        }
    } catch { /* use defaults */ }
}

/* ==========================================================
   Toasts (with optional undo action)
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
        setTimeout(() => toast.remove(), 500); // fallback
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
    return dismiss;
}

/* ==========================================================
   Dashboard statistics
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

    const percentage = tasks.length
        ? Math.round((completed / tasks.length) * 100)
        : 0;

    $("#progressPercent").textContent = `${percentage}%`;
    $("#progressBar").style.width = `${percentage}%`;
    $("#progressTrack").setAttribute("aria-valuenow", String(percentage));

    updateBulkButtons();
}

function setStat(selector, key, value) {
    const el = $(selector);
    if (el.textContent === String(value)) return;
    el.textContent = value;
    if (prevStatValues[key] !== null) {
        el.classList.remove("pulse");
        void el.offsetWidth; // force reflow to restart the animation
        el.classList.add("pulse");
    }
    prevStatValues[key] = value;
}

function updateBulkButtons() {
    $("#completeAll").disabled    = !tasks.some(t => !t.completed);
    $("#clearCompleted").disabled = !tasks.some(t => t.completed);
}

/* ==========================================================
   Task element factory
   ========================================================== */

function createTaskElement(task) {
    const item = document.createElement("li");
    item.className = "task-item";
    item.dataset.id = task.id;
    if (task.completed) item.classList.add("done");

    /* Checkbox */
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label",
        task.completed ? `Mark "${task.text}" as active` : `Mark "${task.text}" as complete`);

    checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        saveTasks();
        renderTasks();

        // Restore focus to the same task's checkbox if it's still rendered.
        const restored = taskList.querySelector(
            `[data-id="${CSS.escape(task.id)}"] input[type="checkbox"]`
        );
        (restored || taskList).focus();
    });

    /* Content */
    const content = document.createElement("div");
    content.className = "task-content";

    const text = document.createElement("div");
    text.className = "task-text";
    text.textContent = task.text;

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

    content.append(text, meta);

    /* Actions */
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
    item.append(checkbox, content, actions);

    return item;
}

/* ==========================================================
   Task operations
   ========================================================== */

function deleteTask(task) {
    const index = tasks.findIndex(t => t.id === task.id);
    if (index === -1) return;

    const [removed] = tasks.splice(index, 1);
    if (editingId === removed.id) resetForm();

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

    tasks = tasks.filter(t => !t.completed);
    if (editingId && !tasks.some(t => t.id === editingId)) resetForm();

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
        const matchesSearch = !query || task.text.toLowerCase().includes(query);
        const matchesFilter =
            currentFilter === "all" ||
            (currentFilter === "active"    && !task.completed) ||
            (currentFilter === "completed" &&  task.completed) ||
            (currentFilter === "overdue"   && isOverdue(task));
        return matchesSearch && matchesFilter;
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
            default:            return b.createdAt - a.createdAt; // newest
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
    switch (currentFilter) {
        case "overdue":
            return { icon: "🎉", title: "Nothing overdue", body: "You're all caught up." };
        case "completed":
            return { icon: "◌", title: "Nothing completed yet", body: "Check off a task to see it here." };
        case "active":
            return { icon: "✓", title: "No active tasks", body: "Everything is done. Nice work." };
        default:
            return { icon: "✦", title: "No matching tasks", body: "Try another search or filter." };
    }
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

    updateStats();
}

/* ==========================================================
   Add / edit tasks
   ========================================================== */

taskForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = taskInput.value.trim();
    const priority = priorityInput.value;
    const dueDate = dueDateInput.value;

    if (!text) {
        taskInput.focus();
        return;
    }

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
        priority,
        dueDate,
        completed: false,
        createdAt: Date.now()
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

/* ==========================================================
   Keyboard shortcuts
   ========================================================== */

document.addEventListener("keydown", (event) => {
    // ⌘K / Ctrl+K — focus search
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
    }

    if (event.key === "Escape") {
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
    themeToggle.setAttribute(
        "aria-label",
        dark ? "Switch to light mode" : "Switch to dark mode"
    );
    if (themeMeta) {
        themeMeta.setAttribute("content", dark ? "#1c1e2a" : "#635bff");
    }
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
    tasks = loadTasks();

    // Sync the visible filter button to `currentFilter` (may have come from prefs).
    $$(".filter").forEach(btn => {
        const active = btn.dataset.filter === currentFilter;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
    });

    renderTasks();
})();