const API = "https://delegation-system-1.onrender.com/";

let allTasks = [];


// ========================================
// PAGE LOAD
// ========================================

document.addEventListener("DOMContentLoaded", () => {

    loadUsers();

    loadTasks();

    // Don't allow old dates for new tasks
    const plannedDate =
        document.getElementById("plannedDate");

    const today =
        new Date().toISOString().split("T")[0];

    plannedDate.min = today;

});


// ========================================
// TAB SWITCHING
// ========================================

function showSection(sectionId, button) {

    document
        .querySelectorAll(".section")
        .forEach(section => {
            section.style.display = "none";
        });

    document.getElementById(sectionId).style.display = "block";

    document
        .querySelectorAll(".tab")
        .forEach(tab => {
            tab.classList.remove("active");
        });

    button.classList.add("active");


    // Load pending tasks
    if (sectionId === "pendingTasks") {
        loadTasks();
    }


    // Load today's tasks
    if (sectionId === "followUp") {
        loadTodayTasks();
    }

}


// ========================================
// LOAD DOERS
// ========================================

async function loadUsers() {

    try {

        const response =
            await fetch(`${API}/api/doers`);

        if (!response.ok) {
            throw new Error("Failed to load doers");
        }

        const users =
            await response.json();

        const select =
            document.getElementById("doerSelect");


        // Clear existing options

        select.innerHTML = `
            <option value="">
                Select Doer
            </option>
        `;


        users.forEach(user => {

            const option =
                document.createElement("option");

            option.value = user.id;

            option.textContent = user.name;

            select.appendChild(option);

        });


    } catch (error) {

        console.error(
            "Failed to load doers:",
            error
        );

    }

}


// ========================================
// ADD TASK
// ========================================

async function addTask() {

    const user_id =
        document
            .getElementById("doerSelect")
            .value;


    const planned_date =
        document
            .getElementById("plannedDate")
            .value;


    const task =
        document
            .getElementById("taskDescription")
            .value
            .trim();


    const message =
        document
            .getElementById("addMessage");


    // Validation

    if (!user_id || !planned_date || !task) {

        message.textContent =
            "Please fill all fields.";

        message.style.color = "red";

        return;

    }


    try {

        const response =
            await fetch(
                `${API}/api/tasks`,
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        user_id: user_id,

                        task: task,

                        planned_date: planned_date

                    })

                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                data.message ||
                "Failed to add task"
            );

        }


        message.textContent =
            "Task added successfully!";

        message.style.color = "green";


        // Clear form

        document
            .getElementById("doerSelect")
            .value = "";


        document
            .getElementById("plannedDate")
            .value = "";


        document
            .getElementById("taskDescription")
            .value = "";


        // Refresh task list

        loadTasks();


    } catch (error) {

        console.error(
            "ADD TASK ERROR:",
            error
        );

        message.textContent =
            error.message;

        message.style.color = "red";

    }

}


// ========================================
// LOAD ALL PENDING TASKS
// ========================================

async function loadTasks() {

    try {

        const response =
            await fetch(
                `${API}/api/tasks`
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                data.message ||
                "Failed to fetch tasks"
            );

        }


        allTasks = data;


        console.log(
            "Tasks received:",
            allTasks
        );


        displayTasks(allTasks);


    } catch (error) {

        console.error(
            "TASK FETCH ERROR:",
            error
        );

    }

}


// ========================================
// DISPLAY TASKS
// ========================================

function displayTasks(tasks) {

    const table =
        document.getElementById(
            "taskTable"
        );


    table.innerHTML = "";


    if (!tasks || tasks.length === 0) {

        table.innerHTML = `
            <tr>
                <td colspan="6">
                    No pending tasks found.
                </td>
            </tr>
        `;

        return;

    }


    tasks.forEach(task => {

        const row =
            document.createElement("tr");


        // Format date

        let date = "";

        if (task.planned_date) {

            date =
                new Date(
                    task.planned_date
                ).toLocaleDateString(
                    "en-GB"
                );

        }


        row.innerHTML = `

            <td>
                <strong>
                    ${task.id}
                </strong>
            </td>

            <td>
                ${escapeHTML(
                    task.doer_name || ""
                )}
            </td>

            <td>
                ${escapeHTML(
                    task.task || ""
                )}
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


// ========================================
// SEARCH
// ========================================

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

            const doerName =
                (
                    task.doer_name || ""
                ).toLowerCase();


            const taskDescription =
                (
                    task.task || ""
                ).toLowerCase();


            return (
                doerName.includes(name) &&
                taskDescription.includes(taskText)
            );

        });


    displayTasks(filtered);

}


// ========================================
// MARK DONE
// ========================================

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


    } catch (error) {

        console.error(
            "DONE ERROR:",
            error
        );

        alert(error.message);

    }

}


// ========================================
// REVISE TASK
// ========================================

async function reviseTask(id) {

    // Create a small popup
    const overlay = document.createElement("div");

    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.background = "rgba(0,0,0,0.25)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    // Popup box
    const box = document.createElement("div");

    box.style.background = "white";
    box.style.padding = "25px";
    box.style.borderRadius = "10px";
    box.style.width = "320px";
    box.style.boxShadow = "0 4px 20px rgba(0,0,0,0.2)";

    // Title
    const title = document.createElement("h3");

    title.textContent = "Select New Due Date";

    title.style.marginTop = "0";
    title.style.marginBottom = "15px";

    // Date input
    const dateInput = document.createElement("input");

    dateInput.type = "date";

    const today =
        new Date().toISOString().split("T")[0];

    dateInput.min = today;

    dateInput.style.width = "100%";
    dateInput.style.boxSizing = "border-box";
    dateInput.style.padding = "12px";
    dateInput.style.fontSize = "16px";
    dateInput.style.border = "1px solid #ccc";
    dateInput.style.borderRadius = "6px";

    // Buttons container
    const buttons = document.createElement("div");

    buttons.style.display = "flex";
    buttons.style.gap = "10px";
    buttons.style.marginTop = "20px";

    // Cancel button
    const cancelButton = document.createElement("button");

    cancelButton.textContent = "Cancel";

    cancelButton.style.flex = "1";
    cancelButton.style.padding = "10px";
    cancelButton.style.cursor = "pointer";

    // Confirm button
    const confirmButton = document.createElement("button");

    confirmButton.textContent = "Confirm";

    confirmButton.style.flex = "1";
    confirmButton.style.padding = "10px";
    confirmButton.style.cursor = "pointer";

    // Cancel
    cancelButton.onclick = () => {

        overlay.remove();

    };

    // Confirm
    confirmButton.onclick = async () => {

        const newDate = dateInput.value;

        if (!newDate) {

            alert("Please select a new due date.");

            return;

        }

        const text = prompt(
            "Revision note (optional):"
        );

        try {

            const response = await fetch(
                `${API}/api/tasks/${id}/revise`,
                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        planned_date: newDate,
                        revision_text: text
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {

                alert(
                    data.error ||
                    "Failed to revise task"
                );

                return;

            }

            overlay.remove();

            loadTasks();

        } catch (error) {

            console.error(
                "Revision error:",
                error
            );

            alert(
                "Failed to revise task."
            );

        }

    };

    // Build popup
    buttons.appendChild(cancelButton);
    buttons.appendChild(confirmButton);

    box.appendChild(title);
    box.appendChild(dateInput);
    box.appendChild(buttons);

    overlay.appendChild(box);

    document.body.appendChild(overlay);

    // Open the calendar immediately
    setTimeout(() => {

        if (dateInput.showPicker) {
            dateInput.showPicker();
        }

    }, 100);

}

// ========================================
// TODAY'S FOLLOW-UP
// ========================================

async function loadTodayTasks() {

    try {

        const response =
            await fetch(
                `${API}/api/tasks/today`
            );


        const tasks =
            await response.json();


        const container =
            document.getElementById(
                "todayTasks"
            );


        if (!response.ok) {

            throw new Error(
                tasks.error ||
                "Failed to load today's tasks"
            );

        }


        if (tasks.length === 0) {

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
                        task.doer_name || ""
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


// ========================================
// HTML ESCAPE
// ========================================

function escapeHTML(text) {

    const div =
        document.createElement("div");

    div.textContent =
        text ?? "";

    return div.innerHTML;

}