/* ==========================================================
   Right rail widgets
   ========================================================== */

function renderRail() {
    renderUpcoming();
    renderPinned();
    renderRailTags();
}

function renderUpcoming() {
    const list = document.getElementById("upcomingList");
    const empty = document.getElementById("upcomingEmpty");
    const badge = document.getElementById("upcomingCount");
    if (!list) return;

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
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (!list) return;

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
    if (!wrap) return;

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
            btn.innerHTML = `#${tag} <span class="rail-tag-count">${n}</span>`;
            btn.addEventListener("click", () => {
                currentTag = currentTag === tag ? null : tag;
                savePrefs();
                renderTasks();
            });
            wrap.appendChild(btn);
        });
}

/* Hook the rail into the existing render cycle */
const _originalRenderTasks = renderTasks;
renderTasks = function() {
    _originalRenderTasks.apply(this, arguments);
    try { renderRail(); } catch (_) {}
};