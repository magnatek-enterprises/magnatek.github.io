const API = "https://delegation-system-1.onrender.com";

let allTasks = [];
let revisingTaskId = null;


// =====================================================
// PAGE LOAD
// =====================================================

document.addEventListener("DOMContentLoaded", () => {

    // Block past dates on the Add Task calendar.
    const plannedDateInput = document.getElementById("plannedDate");
    if (plannedDateInput) {
        plannedDateInput.min = todayISO();
    }

    // Block past dates on the Revise modal calendar.
    const reviseDateInput = document.getElementById("reviseDateInput");
    if (reviseDateInput) {
        reviseDateInput.min = todayISO();
    }

    loadUsers();
    loadDashboard();

    // Close modal on backdrop click or Escape.
    const overlay = document.getElementById("reviseModal");
    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeReviseModal();
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeReviseModal();
    });
});


// =====================================================
// HELPERS
// =====================================================

function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
}

function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function escapeHTML(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

function initials(name) {
    if (!name) return "?";
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join("");
}

function isOverdue(task) {
    return task.status === "Pending" && task.planned_date && task.planned_date.split("T")[0] < todayISO();
}

function isDueToday(task) {
    return task.status === "Pending" && task.planned_date && task.planned_date.split("T")[0] === todayISO();
}

function statusBadge(task) {
    if (task.status === "Completed") {
        return `<span class="badge completed">Completed</span>`;
    }
    if (isOverdue(task)) {
        return `<span class="badge overdue">Overdue</span>`;
    }
    if (isDueToday(task)) {
        return `<span class="badge due-today">Due Today</span>`;
    }
    return `<span class="badge pending">Pending</span>`;
}

function showToast(message, type = "default") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    stack.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.2s ease";
        setTimeout(() => toast.remove(), 200);
    }, 3200);
}

function emptyState(title, desc) {
    return `
        <div class="state-block">
            <div class="state-title">${escapeHTML(title)}</div>
            ${desc ? `<div class="state-desc">${escapeHTML(desc)}</div>` : ""}
        </div>
    `;
}

function errorState(title, desc) {
    return `
        <div class="state-block error">
            <div class="state-title">${escapeHTML(title)}</div>
            ${desc ? `<div class="state-desc">${escapeHTML(desc)}</div>` : ""}
        </div>
    `;
}


// =====================================================
// VIEW SWITCHING
// =====================================================

function showView(viewId, button) {

    document.querySelectorAll(".view").forEach(view => {
        view.classList.remove("active");
    });

    document.getElementById(viewId).classList.add("active");

    document.querySelectorAll(".nav-link").forEach(link => {
        link.classList.remove("active");
    });

    if (button) button.classList.add("active");

    if (viewId === "tasks") {
        loadTasks();
    }

    if (viewId === "followUp") {
        loadTodayTasks();
    }

    if (viewId === "dashboard") {
        loadDashboard();
    }
}


// =====================================================
// LOAD USERS (doer dropdown)
// =====================================================

async function loadUsers() {

    const select = document.getElementById("doerSelect");
    if (!select) return;

    try {

        const response = await fetch(`${API}/api/users`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const users = await response.json();

        select.innerHTML = `<option value="">Select Doer</option>`;

        users.forEach(user => {
            const option = document.createElement("option");
            option.value = user.id;
            option.textContent = user.name;
            select.appendChild(option);
        });

    } catch (error) {

        console.error("Failed to load users:", error);
        select.innerHTML = `<option value="">Unable to load doers</option>`;
        showToast("Couldn't load the doer list. Check your connection and try again.", "error");

    }
}


// =====================================================
// ADD TASK
// =====================================================

async function addTask() {

    const user_id = document.getElementById("doerSelect").value;
    const planned_date = document.getElementById("plannedDate").value;
    const task = document.getElementById("taskDescription").value.trim();
    const message = document.getElementById("addMessage");
    const btn = document.getElementById("addTaskBtn");

    message.classList.remove("show", "success", "error");

    if (!user_id || !planned_date || !task) {
        message.textContent = "Please select a doer, a planned date, and describe the task.";
        message.classList.add("show", "error");
        return;
    }

    if (planned_date < todayISO()) {
        message.textContent = "Planned date cannot be in the past.";
        message.classList.add("show", "error");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Adding…";

    try {

        const response = await fetch(`${API}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id, task, planned_date })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to add task");
        }

        message.textContent = "Task added successfully.";
        message.classList.add("show", "success");

        document.getElementById("doerSelect").value = "";
        document.getElementById("plannedDate").value = "";
        document.getElementById("taskDescription").value = "";

        showToast("Task added successfully.", "success");

    } catch (error) {

        console.error("ADD TASK ERROR:", error);
        message.textContent = error.message;
        message.classList.add("show", "error");

    } finally {

        btn.disabled = false;
        btn.textContent = "Add Task";

    }
}


// =====================================================
// LOAD ALL PENDING TASKS
// =====================================================

async function loadTasks() {

    const table = document.getElementById("taskTable");

    try {

        const response = await fetch(`${API}/api/tasks`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        allTasks = await response.json();
        displayTasks(allTasks);

    } catch (error) {

        console.error("Failed to fetch tasks:", error);

        if (table) {
            table.innerHTML = `<tr><td colspan="7">${errorState(
                "Couldn't load tasks",
                "Check your connection and try again."
            )}</td></tr>`;
        }

    }
}


// =====================================================
// DISPLAY TASKS (table)
// =====================================================

function displayTasks(tasks) {

    const table = document.getElementById("taskTable");
    if (!table) return;

    if (!tasks || tasks.length === 0) {
        table.innerHTML = `<tr><td colspan="7">${emptyState(
            "No pending tasks",
            "Everything here is caught up, or your search didn't match anything."
        )}</td></tr>`;
        return;
    }

    table.innerHTML = "";

    tasks.forEach(task => {

        const row = document.createElement("tr");

        row.innerHTML = `
            <td class="mono">${escapeHTML(task.task_code || task.id)}</td>
            <td>${escapeHTML(task.name || task.doer_name || "")}</td>
            <td>${escapeHTML(task.task || "")}</td>
            <td>${formatDate(task.planned_date)}</td>
            <td class="mono">${Number(task.total_revisions || 0)}</td>
            <td>${statusBadge(task)}</td>
            <td>
                <div class="cell-actions">
                    <button class="action-btn done-btn" onclick="markDone(${task.id})">Done</button>
                    <button class="action-btn revise-btn" onclick="reviseTask(${task.id})">Revise</button>
                </div>
            </td>
        `;

        table.appendChild(row);

    });
}


// =====================================================
// SEARCH
// =====================================================

function filterTasks() {

    const name = document.getElementById("searchName").value.toLowerCase();
    const taskText = document.getElementById("searchTask").value.toLowerCase();

    const filtered = allTasks.filter(task => {
        const taskName = (task.name || task.doer_name || "").toLowerCase();
        const taskDescription = (task.task || "").toLowerCase();
        return taskName.includes(name) && taskDescription.includes(taskText);
    });

    displayTasks(filtered);
}


// =====================================================
// MARK DONE
// =====================================================

async function markDone(id) {

    if (!confirm("Mark this task as completed?")) return;

    try {

        const response = await fetch(`${API}/api/tasks/${id}/done`, { method: "PUT" });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to complete task");
        }

        showToast("Task marked as completed.", "success");

        loadTasks();
        loadTodayTasks();

    } catch (error) {

        console.error("MARK DONE ERROR:", error);
        showToast(error.message, "error");

    }
}


// =====================================================
// REVISE TASK (modal)
// =====================================================

function reviseTask(id) {

    revisingTaskId = id;

    const dateInput = document.getElementById("reviseDateInput");
    const noteInput = document.getElementById("reviseNoteInput");

    dateInput.min = todayISO();
    dateInput.value = "";
    noteInput.value = "";

    document.getElementById("reviseModal").classList.add("show");

    setTimeout(() => dateInput.focus(), 50);
}

function closeReviseModal() {
    document.getElementById("reviseModal").classList.remove("show");
    revisingTaskId = null;
}

async function submitRevise() {

    if (!revisingTaskId) return;

    const newDate = document.getElementById("reviseDateInput").value;
    const revisionText = document.getElementById("reviseNoteInput").value.trim();
    const btn = document.getElementById("reviseSaveBtn");

    if (!newDate) {
        showToast("Please choose a new planned date.", "error");
        return;
    }

    if (newDate < todayISO()) {
        showToast("Planned date cannot be in the past.", "error");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";

    try {

        const response = await fetch(`${API}/api/tasks/${revisingTaskId}/revise`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                planned_date: newDate,
                revision_text: revisionText || ""
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to revise task");
        }

        showToast("Task revised successfully.", "success");

        closeReviseModal();
        loadTasks();
        loadTodayTasks();

    } catch (error) {

        console.error("REVISE ERROR:", error);
        showToast(error.message, "error");

    } finally {

        btn.disabled = false;
        btn.textContent = "Save Revision";

    }
}


// =====================================================
// TODAY'S TASKS (Follow Up)
// =====================================================

async function loadTodayTasks() {

    const container = document.getElementById("todayTasks");
    if (!container) return;

    try {

        const response = await fetch(`${API}/api/tasks/today`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const tasks = await response.json();

        if (!tasks || tasks.length === 0) {
            container.innerHTML = emptyState("No tasks for today", "Nothing is planned for today yet.");
            return;
        }

        container.innerHTML = "";

        tasks.forEach(task => {

            const card = document.createElement("div");
            card.className = "task-card";

            card.innerHTML = `
                <div class="task-card-top">
                    <div class="task-doer">
                        <div class="avatar">${escapeHTML(initials(task.name))}</div>
                        <div>
                            <div class="task-doer-name">${escapeHTML(task.name || "")}</div>
                            <div class="task-code">#${escapeHTML(task.task_code || task.id)}</div>
                        </div>
                    </div>
                    ${statusBadge(task)}
                </div>

                <p class="task-desc">${escapeHTML(task.task || "")}</p>

                <div class="task-card-foot">
                    <span class="task-meta">${Number(task.total_revisions || 0)} revision${Number(task.total_revisions || 0) === 1 ? "" : "s"}</span>
                    <div class="task-actions">
                        <button class="action-btn done-btn" onclick="markDone(${task.id})">Done</button>
                        <button class="action-btn revise-btn" onclick="reviseTask(${task.id})">Revise</button>
                    </div>
                </div>
            `;

            container.appendChild(card);

        });

    } catch (error) {

        console.error("TODAY TASK ERROR:", error);
        container.innerHTML = errorState("Couldn't load today's tasks", "Check your connection and try again.");

    }
}


// =====================================================
// DASHBOARD
// =====================================================

async function loadDashboard() {

    const refreshBtn = document.getElementById("dashboardRefreshBtn");
    if (refreshBtn) refreshBtn.classList.add("spinning");

    try {

        const [summaryRes, doersRes, revisionsRes, priorityRes] = await Promise.all([
            fetch(`${API}/api/dashboard/summary`),
            fetch(`${API}/api/dashboard/doers`),
            fetch(`${API}/api/dashboard/revisions`),
            fetch(`${API}/api/dashboard/priority`)
        ]);

        if (!summaryRes.ok || !doersRes.ok || !revisionsRes.ok || !priorityRes.ok) {
            throw new Error("One or more dashboard requests failed");
        }

        const summary = await summaryRes.json();
        const doers = await doersRes.json();
        const revisions = await revisionsRes.json();
        const priority = await priorityRes.json();

        renderSummary(summary);
        renderDoerPerformance(doers);
        renderTasksByDoerChart(doers);
        renderStatusDonut(summary);
        renderRevisionStats(revisions);
        renderPriorityLists(priority);

    } catch (error) {

        console.error("DASHBOARD ERROR:", error);
        showToast("Couldn't load the dashboard. Check your connection and try again.", "error");

    } finally {

        if (refreshBtn) refreshBtn.classList.remove("spinning");

    }
}

function renderSummary(summary) {
    document.getElementById("statTotal").textContent = summary.total ?? 0;
    document.getElementById("statCompleted").textContent = summary.completed ?? 0;
    document.getElementById("statPending").textContent = summary.pending ?? 0;
    document.getElementById("statDueToday").textContent = summary.due_today ?? 0;
    document.getElementById("statOverdue").textContent = summary.overdue ?? 0;
}

function renderDoerPerformance(doers) {

    const list = document.getElementById("doerPerformanceList");

    if (!doers || doers.length === 0) {
        list.innerHTML = emptyState("No doers yet", "Add doers on the backend to see performance here.");
        return;
    }

    list.innerHTML = doers.map(d => `
        <div class="doer-row">
            <div class="doer-name-cell">
                <div class="avatar">${escapeHTML(initials(d.name))}</div>
                <span>${escapeHTML(d.name)}</span>
            </div>
            <div class="doer-stat" data-label="Assigned">${d.total_assigned}</div>
            <div class="doer-stat" data-label="Completed">${d.completed}</div>
            <div class="doer-stat" data-label="Pending">${d.pending}</div>
            <div class="progress-cell">
                <div class="progress-track">
                    <div class="progress-fill" style="width:${d.completion_percentage}%"></div>
                </div>
                <div class="progress-pct">${d.completion_percentage}%</div>
            </div>
        </div>
    `).join("");
}

function renderTasksByDoerChart(doers) {

    const wrap = document.getElementById("tasksByDoerChart");

    const withTasks = (doers || []).filter(d => d.total_assigned > 0);

    if (withTasks.length === 0) {
        wrap.innerHTML = emptyState("No task data yet", "Charts will appear once tasks are assigned.");
        return;
    }

    const maxTotal = Math.max(...withTasks.map(d => d.total_assigned));

    wrap.innerHTML = withTasks.map(d => {
        const completedPct = (d.completed / maxTotal) * 100;
        const pendingPct = (d.pending / maxTotal) * 100;
        return `
            <div class="bar-row">
                <div class="bar-label" title="${escapeHTML(d.name)}">${escapeHTML(d.name)}</div>
                <div class="bar-track">
                    <div class="bar-fill-completed" style="width:${completedPct}%"></div>
                    <div class="bar-fill-pending" style="width:${pendingPct}%"></div>
                </div>
                <div class="bar-total">${d.total_assigned}</div>
            </div>
        `;
    }).join("");
}

function renderStatusDonut(summary) {

    const wrap = document.getElementById("statusDonutWrap");

    const completed = summary.completed || 0;
    const pending = summary.pending || 0;
    const total = completed + pending;

    if (total === 0) {
        wrap.innerHTML = emptyState("No task data yet", "The chart will appear once tasks exist.");
        return;
    }

    const r = 58;
    const circumference = 2 * Math.PI * r;
    const completedLen = (completed / total) * circumference;

    wrap.innerHTML = `
        <div class="donut-wrap">
            <svg viewBox="0 0 148 148" width="148" height="148">
                <circle cx="74" cy="74" r="${r}" fill="none" stroke="#c8102e" stroke-width="16" />
                <circle cx="74" cy="74" r="${r}" fill="none" stroke="#12805c" stroke-width="16"
                    stroke-dasharray="${completedLen} ${circumference - completedLen}"
                    stroke-dashoffset="0"
                    transform="rotate(-90 74 74)" />
            </svg>
            <div class="donut-center">
                <span class="n">${total}</span>
                <span class="l">Total</span>
            </div>
        </div>
        <div class="legend">
            <div class="legend-item">
                <span class="legend-dot" style="background:#12805c;"></span>
                Completed <span class="legend-val">${completed}</span>
            </div>
            <div class="legend-item">
                <span class="legend-dot" style="background:#c8102e;"></span>
                Pending <span class="legend-val">${pending}</span>
            </div>
        </div>
    `;
}

function renderRevisionStats(revisions) {

    const wrap = document.getElementById("revisionStats");

    wrap.innerHTML = `
        <div class="revision-stat">
            <div class="rv-val">${revisions.never_revised ?? 0}</div>
            <div class="rv-label">Never Revised</div>
        </div>
        <div class="revision-stat">
            <div class="rv-val">${revisions.revised ?? 0}</div>
            <div class="rv-label">Revised at Least Once</div>
        </div>
        <div class="revision-stat">
            <div class="rv-val">${revisions.avg_revisions ?? 0}</div>
            <div class="rv-label">Avg. Revisions / Task</div>
        </div>
    `;
}

function renderPriorityLists(priority) {

    const dueTodayList = document.getElementById("dueTodayList");
    const overdueList = document.getElementById("overdueList");
    const dueTodayCount = document.getElementById("dueTodayCount");
    const overdueCount = document.getElementById("overdueCount");

    const dueToday = priority.due_today || [];
    const overdue = priority.overdue || [];

    dueTodayCount.textContent = dueToday.length ? `${dueToday.length} task${dueToday.length === 1 ? "" : "s"}` : "";
    overdueCount.textContent = overdue.length ? `${overdue.length} task${overdue.length === 1 ? "" : "s"}` : "";

    dueTodayList.innerHTML = dueToday.length
        ? dueToday.map(priorityItem).join("")
        : emptyState("Nothing due today", "Today's follow-up list is clear.");

    overdueList.innerHTML = overdue.length
        ? overdue.map(priorityItem).join("")
        : emptyState("No overdue tasks", "Everything is on schedule.");
}

function priorityItem(task) {
    return `
        <div class="priority-item">
            <div class="p-left">
                <div class="p-doer">${escapeHTML(task.doer_name || "")}</div>
                <div class="p-task">${escapeHTML(task.task || "")}</div>
            </div>
            <div class="p-date">${formatDate(task.planned_date)}</div>
        </div>
    `;
}
