const $ = (selector) => document.querySelector(selector);

const taskForm = $("#taskForm");
const taskInput = $("#taskInput");
const priorityInput = $("#priorityInput");
const dueDateInput = $("#dueDateInput");
const taskList = $("#taskList");
const emptyMessage = $("#emptyMessage");

let tasks = [];
let currentFilter = "all";
let editingId = null;

// ---------- Load saved data ----------

try {
    const saved = JSON.parse(
        localStorage.getItem("taskflow-tasks") || "[]"
    );

    if (Array.isArray(saved)) {
        tasks = saved.filter(task =>
            task &&
            typeof task.id === "string" &&
            typeof task.text === "string" &&
            typeof task.completed === "boolean" &&
            ["low", "medium", "high"].includes(task.priority) &&
            (task.dueDate === "" ||
                (typeof task.dueDate === "string" &&
                 /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))) &&
            Number.isFinite(task.createdAt)
        );
    }
} catch {
    tasks = [];
}

// ---------- Save tasks ----------

function saveTasks() {
    try {
        localStorage.setItem(
            "taskflow-tasks",
            JSON.stringify(tasks)
        );
    } catch {
        alert("Could not save tasks. Check your browser storage.");
    }
}

// Use local calendar date instead of UTC date.
function todayString() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function isOverdue(task) {
    return Boolean(
        !task.completed &&
        task.dueDate &&
        task.dueDate < todayString()
    );
}

function formatDate(dateString) {
    if (!dateString) return "";

    const [year, month, day] = dateString.split("-").map(Number);

    return new Date(year, month - 1, day).toLocaleDateString(
        undefined,
        { day: "numeric", month: "short", year: "numeric" }
    );
}

// ---------- Dashboard statistics ----------

function updateStats() {
    const completed = tasks.filter(task => task.completed).length;
    const remaining = tasks.length - completed;
    const overdue = tasks.filter(isOverdue).length;

    $("#totalCount").textContent = tasks.length;
    $("#completedCount").textContent = completed;
    $("#remainingCount").textContent = remaining;
    $("#overdueCount").textContent = overdue;

    $("#footerCount").textContent =
        `${remaining} task${remaining === 1 ? "" : "s"} remaining`;

    const percentage = tasks.length
        ? Math.round((completed / tasks.length) * 100)
        : 0;

    $("#progressPercent").textContent = `${percentage}%`;
    $("#progressBar").style.width = `${percentage}%`;

    $("#progressTrack").setAttribute("aria-valuenow", percentage);
}

// ---------- Create task elements safely ----------

function createTaskElement(task) {
    const item = document.createElement("li");
    item.className = "task-item";

    if (task.completed) item.classList.add("done");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", "Complete task");

    checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        saveTasks();
        renderTasks();
    });

    const content = document.createElement("div");
    content.className = "task-content";

    const text = document.createElement("div");
    text.className = "task-text";
    text.textContent = task.text;

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const priority = document.createElement("span");
    priority.className = `priority priority-${task.priority}`;
    priority.textContent =
        task.priority[0].toUpperCase() + task.priority.slice(1);

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

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editButton = document.createElement("button");
    editButton.className = "edit-btn";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${task.text}`);

    editButton.addEventListener("click", () => {
        startEditing(task);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-btn";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${task.text}`);

    deleteButton.addEventListener("click", () => {
        if (!confirm(`Delete "${task.text}"?`)) return;

        tasks = tasks.filter(item => item.id !== task.id);

        if (editingId === task.id) resetForm();

        saveTasks();
        renderTasks();
    });

    actions.append(editButton, deleteButton);
    item.append(checkbox, content, actions);

    return item;
}

// ---------- Search, filters and sorting ----------

function getVisibleTasks() {
    const query = $("#searchInput").value.trim().toLowerCase();
    const sort = $("#sortSelect").value;

    let result = tasks.filter(task => {
        const matchesSearch = task.text.toLowerCase().includes(query);

        const matchesFilter =
            currentFilter === "all" ||
            (currentFilter === "active" && !task.completed) ||
            (currentFilter === "completed" && task.completed) ||
            (currentFilter === "overdue" && isOverdue(task));

        return matchesSearch && matchesFilter;
    });

    const priorityRank = { high: 3, medium: 2, low: 1 };

    result.sort((a, b) => {
        if (sort === "oldest") {
            return a.createdAt - b.createdAt;
        }

        if (sort === "priority") {
            return priorityRank[b.priority] - priorityRank[a.priority]
                || b.createdAt - a.createdAt;
        }

        if (sort === "dueDate") {
            if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;

            return a.dueDate.localeCompare(b.dueDate);
        }

        if (sort === "alphabetical") {
            return a.text.localeCompare(b.text);
        }

        return b.createdAt - a.createdAt;
    });

    return result;
}

// ---------- Render application ----------

function renderTasks() {
    taskList.replaceChildren();

    const visibleTasks = getVisibleTasks();

    visibleTasks.forEach(task => {
        taskList.appendChild(createTaskElement(task));
    });

    emptyMessage.hidden = visibleTasks.length > 0;

    if (visibleTasks.length === 0) {
        const heading = emptyMessage.querySelector("h3");
        const description = emptyMessage.querySelector("p");

        heading.textContent = tasks.length
            ? "No matching tasks"
            : "No tasks yet";

        description.textContent = tasks.length
            ? "Try another search or filter."
            : "Add your first task to get started.";
    }

    updateStats();
}

// ---------- Add and edit tasks ----------

taskForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = taskInput.value.trim();
    const priority = priorityInput.value;
    const dueDate = dueDateInput.value;

    if (!text) {
        taskInput.focus();
        return;
    }

    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        alert("Please select a valid due date.");
        return;
    }

    if (editingId) {
        const task = tasks.find(item => item.id === editingId);

        if (task) {
            task.text = text;
            task.priority = priority;
            task.dueDate = dueDate;
        }
    } else {
        tasks.push({
            id: crypto.randomUUID(),
            text,
            priority,
            dueDate,
            completed: false,
            createdAt: Date.now()
        });
    }

    saveTasks();
    resetForm();
    renderTasks();
});

function startEditing(task) {
    editingId = task.id;

    taskInput.value = task.text;
    priorityInput.value = task.priority;
    dueDateInput.value = task.dueDate || "";

    $("#submitBtn").textContent = "Save changes";
    $("#cancelEdit").hidden = false;

    taskForm.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    taskInput.focus();
}

function resetForm() {
    editingId = null;
    taskForm.reset();

    priorityInput.value = "medium";
    $("#submitBtn").textContent = "+ Add task";
    $("#cancelEdit").hidden = true;
}

$("#cancelEdit").addEventListener("click", resetForm);

// ---------- Filter controls ----------

document.querySelectorAll(".filter").forEach(button => {
    button.addEventListener("click", () => {
        currentFilter = button.dataset.filter;

        document.querySelectorAll(".filter").forEach(filter => {
            const active = filter === button;

            filter.classList.toggle("active", active);
            filter.setAttribute("aria-pressed", String(active));
        });

        renderTasks();
    });
});

$("#searchInput").addEventListener("input", renderTasks);
$("#sortSelect").addEventListener("change", renderTasks);

// ---------- Bulk actions ----------

$("#completeAll").addEventListener("click", () => {
    if (!tasks.some(task => !task.completed)) return;

    tasks.forEach(task => {
        task.completed = true;
    });

    saveTasks();
    renderTasks();
});

$("#clearCompleted").addEventListener("click", () => {
    const completedCount = tasks.filter(task => task.completed).length;

    if (!completedCount) return;

    if (!confirm(`Delete ${completedCount} completed task(s)?`)) return;

    tasks = tasks.filter(task => !task.completed);

    saveTasks();
    renderTasks();
});

// ---------- Dark mode ----------

const themeToggle = $("#themeToggle");

function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    themeToggle.textContent = dark ? "☀️" : "🌙";

    themeToggle.setAttribute(
        "aria-label",
        dark ? "Switch to light mode" : "Switch to dark mode"
    );

    try {
        localStorage.setItem("taskflow-theme", dark ? "dark" : "light");
    } catch {
        // Theme still works for the current session.
    }
}

let savedTheme = "light";

try {
    savedTheme = localStorage.getItem("taskflow-theme") || "light";
} catch {
    // Use the default theme.
}

applyTheme(savedTheme === "dark");

themeToggle.addEventListener("click", () => {
    applyTheme(!document.body.classList.contains("dark"));
});

// ---------- Start app ----------

renderTasks();