const API = "https://delegation-system-1.onrender.com";

let allTasks = [];


// =====================================================
// PAGE LOAD
// =====================================================

document.addEventListener("DOMContentLoaded", () => {
    loadUsers();
    loadTasks();
});


// =====================================================
// TAB SWITCHING
// =====================================================

function showSection(sectionId, button) {

    document.querySelectorAll(".section").forEach(section => {
        section.style.display = "none";
    });

    document.getElementById(sectionId).style.display = "block";

    document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.remove("active");
    });

    button.classList.add("active");

    if (sectionId === "pendingTasks") {
        loadTasks();
    }

    if (sectionId === "followUp") {
        loadTodayTasks();
    }
}


// =====================================================
// LOAD USERS
// =====================================================

async function loadUsers() {

    const select = document.getElementById("doerSelect");

    if (!select) {
        console.error("doerSelect element not found");
        return;
    }

    try {

        console.log("Loading users from:", `${API}/api/users`);

        const response = await fetch(`${API}/api/users`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const users = await response.json();

        console.log("Users received:", users);

        select.innerHTML = `
            <option value="">Select Doer</option>
        `;

        users.forEach(user => {

            const option = document.createElement("option");

            option.value = user.id;
            option.textContent = user.name;

            select.appendChild(option);

        });

    } catch (error) {

        console.error("Failed to load users:", error);

        select.innerHTML = `
            <option value="">Unable to load users</option>
        `;
    }
}


// =====================================================
// ADD TASK
// =====================================================

async function addTask() {

    const user_id =
        document.getElementById("doerSelect").value;

    const planned_date =
        document.getElementById("plannedDate").value;

    const task =
        document.getElementById("taskDescription").value.trim();

    const message =
        document.getElementById("addMessage");


    if (!user_id || !planned_date || !task) {

        message.textContent = "Please fill all fields.";
        message.style.color = "red";

        return;
    }


    try {

        const response = await fetch(
            `${API}/api/tasks`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    user_id,
                    task,
                    planned_date
                })
            }
        );


        const data = await response.json();


        if (!response.ok) {

            throw new Error(
                data.error || "Failed to add task"
            );

        }


        message.textContent =
            "Task added successfully!";

        message.style.color = "green";


        document.getElementById("doerSelect").value = "";
        document.getElementById("plannedDate").value = "";
        document.getElementById("taskDescription").value = "";


        loadTasks();


    } catch (error) {

        console.error("ADD TASK ERROR:", error);

        message.textContent = error.message;
        message.style.color = "red";

    }
}


// =====================================================
// LOAD ALL PENDING TASKS
// =====================================================

async function loadTasks() {

    try {

        console.log(
            "Loading tasks from:",
            `${API}/api/tasks`
        );

        const response =
            await fetch(`${API}/api/tasks`);


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        console.log("Tasks received:", data);


        allTasks = data;


        displayTasks(allTasks);


    } catch (error) {

        console.error(
            "Failed to fetch tasks:",
            error
        );

        const table =
            document.getElementById("taskTable");

        if (table) {

            table.innerHTML = `
                <tr>
                    <td colspan="6">
                        Failed to fetch tasks
                    </td>
                </tr>
            `;

        }

    }
}


// =====================================================
// DISPLAY TASKS
// =====================================================

function displayTasks(tasks) {

    const table =
        document.getElementById("taskTable");


    if (!table) {
        return;
    }


    table.innerHTML = "";


    if (!tasks || tasks.length === 0) {

        table.innerHTML = `
            <tr>
                <td colspan="6">
                    No pending tasks
                </td>
            </tr>
        `;

        return;
    }


    tasks.forEach(task => {

        const row =
            document.createElement("tr");


        let date = "";

        if (task.planned_date) {

            date =
                new Date(task.planned_date)
                    .toLocaleDateString("en-GB");

        }


        row.innerHTML = `

            <td>
                <strong>
                    ${escapeHTML(task.task_code || task.id)}
                </strong>
            </td>

            <td>
                ${escapeHTML(
                    task.name ||
                    task.doer_name ||
                    ""
                )}
            </td>

            <td>
                ${escapeHTML(task.task || "")}
            </td>

            <td>
                ${date}
            </td>

            <td>

                <button
                    class="done-btn"
                    onclick="markDone(${task.id})">

                    Done

                </button>

            </td>

            <td>

                <button
                    class="revise-btn"
                    onclick="reviseTask(${task.id})">

                    Revise

                </button>

            </td>

        `;


        table.appendChild(row);

    });

}


// =====================================================
// SEARCH
// =====================================================

function filterTasks() {

    const name =
        document
            .getElementById("searchName")
            .value
            .toLowerCase();


    const taskText =
        document
            .getElementById("searchTask")
            .value
            .toLowerCase();


    const filtered =
        allTasks.filter(task => {

            const taskName =
                (
                    task.name ||
                    task.doer_name ||
                    ""
                ).toLowerCase();


            const taskDescription =
                (
                    task.task ||
                    ""
                ).toLowerCase();


            return (
                taskName.includes(name) &&
                taskDescription.includes(taskText)
            );

        });


    displayTasks(filtered);

}


// =====================================================
// MARK DONE
// =====================================================

async function markDone(id) {

    if (!confirm(
        "Mark this task as completed?"
    )) {

        return;
    }


    try {

        const response =
            await fetch(
                `${API}/api/tasks/${id}/done`,
                {
                    method: "PUT"
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Failed to complete task"
            );

        }


        loadTasks();


        // Refresh today's tasks if visible
        loadTodayTasks();


    } catch (error) {

        console.error(
            "MARK DONE ERROR:",
            error
        );

        alert(error.message);

    }

}


// =====================================================
// REVISE TASK
// =====================================================

async function reviseTask(id) {

    // Create a proper date picker
    const input =
        document.createElement("input");

    input.type = "date";

    input.min =
        new Date()
            .toISOString()
            .split("T")[0];


    input.style.position = "fixed";
    input.style.left = "-9999px";


    document.body.appendChild(input);


    input.addEventListener("change", async () => {

        const newDate = input.value;

        input.remove();


        if (!newDate) {
            return;
        }


        const revisionText =
            prompt(
                "Revision note (optional):"
            );


        try {

            const response =
                await fetch(
                    `${API}/api/tasks/${id}/revise`,
                    {
                        method: "PUT",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            planned_date:
                                newDate,

                            revision_text:
                                revisionText || ""

                        })

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.error ||
                    "Failed to revise task"
                );

            }


            loadTasks();
            loadTodayTasks();


        } catch (error) {

            console.error(
                "REVISE ERROR:",
                error
            );

            alert(error.message);

        }

    });


    input.click();

}


// =====================================================
// TODAY'S TASKS
// =====================================================

async function loadTodayTasks() {

    try {

        const response =
            await fetch(
                `${API}/api/tasks/today`
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const tasks =
            await response.json();


        const container =
            document.getElementById(
                "todayTasks"
            );


        if (!container) {
            return;
        }


        if (!tasks || tasks.length === 0) {

            container.innerHTML =
                "<p>No tasks for today.</p>";

            return;

        }


        container.innerHTML = "";


        tasks.forEach(task => {

            const card =
                document.createElement("div");


            card.className =
                "task-card";


            card.innerHTML = `

                <h3>
                    ${escapeHTML(
                        task.name ||
                        task.doer_name ||
                        ""
                    )}
                </h3>

                <p>
                    ${escapeHTML(
                        task.task || ""
                    )}
                </p>

                <button
                    class="done-btn"
                    onclick="markDone(${task.id})">

                    Done

                </button>

                <button
                    class="revise-btn"
                    onclick="reviseTask(${task.id})">

                    Revise

                </button>

            `;


            container.appendChild(card);

        });


    } catch (error) {

        console.error(
            "TODAY TASK ERROR:",
            error
        );

    }

}


// =====================================================
// HTML ESCAPE
// =====================================================

function escapeHTML(text) {

    const div =
        document.createElement("div");


    div.textContent =
        text ?? "";


    return div.innerHTML;

}