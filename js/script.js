const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const emptyMessage = document.getElementById("emptyMessage");

const totalCount = document.getElementById("totalCount");
const completedCount = document.getElementById("completedCount");
const remainingCount = document.getElementById("remainingCount");
const footerCount = document.getElementById("footerCount");

const clearCompleted = document.getElementById("clearCompleted");
const filterButtons = document.querySelectorAll(".filter");

let tasks = [];

try {
    const savedTasks = JSON.parse(
        localStorage.getItem("taskflow-tasks") || "[]"
    );

    if (Array.isArray(savedTasks)) {
        tasks = savedTasks.filter(task =>
            task &&
            typeof task.id === "string" &&
            typeof task.text === "string" &&
            typeof task.completed === "boolean"
        );
    }
} catch {
    tasks = [];
}

let currentFilter = "all";

function saveTasks() {
    try {
        localStorage.setItem(
            "taskflow-tasks",
            JSON.stringify(tasks)
        );
    } catch {
        alert("Unable to save tasks in this browser.");
    }
}

function updateStats() {
    const completed = tasks.filter(task => task.completed).length;
    const remaining = tasks.length - completed;

    totalCount.textContent = tasks.length;
    completedCount.textContent = completed;
    remainingCount.textContent = remaining;

    footerCount.textContent =
        `${remaining} task${remaining !== 1 ? "s" : ""} remaining`;
}

function renderTasks() {
    taskList.replaceChildren();

    const filteredTasks = tasks.filter(task => {
        if (currentFilter === "active") {
            return !task.completed;
        }

        if (currentFilter === "completed") {
            return task.completed;
        }

        return true;
    });

    emptyMessage.hidden = filteredTasks.length > 0;

    if (filteredTasks.length === 0) {
        emptyMessage.textContent =
            currentFilter === "completed"
                ? "No completed tasks yet."
                : currentFilter === "active"
                ? "You're all caught up!"
                : "No tasks here yet. Add one to get started!";
    }

    filteredTasks.forEach(task => {
        const item = document.createElement("li");
        item.className = "task-item";

        if (task.completed) {
            item.classList.add("done");
        }

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.completed;
        checkbox.setAttribute(
            "aria-label",
            `Mark ${task.text} as completed`
        );

        checkbox.addEventListener("change", () => {
            task.completed = checkbox.checked;
            saveTasks();
            renderTasks();
        });

        const text = document.createElement("span");
        text.className = "task-text";
        text.textContent = task.text;

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-btn";
        deleteButton.textContent = "Delete";
        deleteButton.setAttribute("aria-label", `Delete ${task.text}`);

        deleteButton.addEventListener("click", () => {
            tasks = tasks.filter(item => item.id !== task.id);
            saveTasks();
            renderTasks();
        });

        item.append(checkbox, text, deleteButton);
        taskList.appendChild(item);
    });

    updateStats();
}

taskForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = taskInput.value.trim();

    if (!text) {
        taskInput.focus();
        return;
    }

    tasks.unshift({
        id: crypto.randomUUID(),
        text,
        completed: false
    });

    saveTasks();
    currentFilter = "all";

    filterButtons.forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.filter === "all"
        );
    });

    taskInput.value = "";
    renderTasks();
    taskInput.focus();
});

filterButtons.forEach(button => {
    button.addEventListener("click", () => {
        currentFilter = button.dataset.filter;

        filterButtons.forEach(filter => {
            const active = filter === button;
            filter.classList.toggle("active", active);
            filter.setAttribute("aria-pressed", String(active));
        });

        renderTasks();
    });
});

clearCompleted.addEventListener("click", () => {
    tasks = tasks.filter(task => !task.completed);
    saveTasks();
    renderTasks();
});

renderTasks();