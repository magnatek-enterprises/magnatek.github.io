const API = "http://localhost:5000";

let allTasks = [];


// ==============================
// PAGE LOAD
// ==============================

document.addEventListener("DOMContentLoaded", () => {

    loadUsers();

    loadTasks();

});


// ==============================
// TAB SWITCHING
// ==============================

function showSection(sectionId, button) {

    document
        .querySelectorAll(".section")
        .forEach(section => {

            section.style.display = "none";

        });


    document.getElementById(sectionId)
        .style.display = "block";


    document
        .querySelectorAll(".tab")
        .forEach(tab => {

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


// ==============================
// LOAD DOERS
// ==============================

async function loadUsers() {

    try {

        const response =
            await fetch(`${API}/api/users`);

        const users =
            await response.json();


        const select =
            document.getElementById("doerSelect");


        users.forEach(user => {

            const option =
                document.createElement("option");

            option.value = user.id;

            option.textContent = user.name;

            select.appendChild(option);

        });


    } catch (error) {

        console.error(
            "Failed to load users:",
            error
        );

    }

}


// ==============================
// ADD TASK
// ==============================

async function addTask() {

    const user_id =
        document.getElementById(
            "doerSelect"
        ).value;


    const planned_date =
        document.getElementById(
            "plannedDate"
        ).value;


    const task =
        document.getElementById(
            "taskDescription"
        ).value.trim();


    const message =
        document.getElementById(
            "addMessage"
        );


    if (!user_id ||
        !planned_date ||
        !task) {

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

                        user_id,
                        task,
                        planned_date

                    })

                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Failed to add task"
            );

        }


        message.textContent =
            "Task added successfully!";

        message.style.color =
            "green";


        // Clear form

        document.getElementById(
            "doerSelect"
        ).value = "";


        document.getElementById(
            "plannedDate"
        ).value = "";


        document.getElementById(
            "taskDescription"
        ).value = "";


        loadTasks();


    } catch (error) {

        console.error(error);

        message.textContent =
            error.message;

        message.style.color =
            "red";

    }

}


// ==============================
// LOAD ALL PENDING TASKS
// ==============================

async function loadTasks() {

    try {

        const response =
            await fetch(
                `${API}/api/tasks`
            );


        allTasks =
            await response.json();


        displayTasks(allTasks);


    } catch (error) {

        console.error(error);

    }

}


// ==============================
// DISPLAY TASKS
// ==============================

function displayTasks(tasks) {

    const table =
        document.getElementById(
            "taskTable"
        );


    table.innerHTML = "";


    tasks.forEach(task => {

        const row =
            document.createElement("tr");


        const date =
            new Date(
                task.planned_date
            ).toLocaleDateString(
                "en-GB"
            );


        row.innerHTML = `

            <td>
                <strong>
                    ${task.task_code}
                </strong>
            </td>

            <td>
                ${escapeHTML(task.name)}
            </td>

            <td>
                ${escapeHTML(task.task)}
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


// ==============================
// SEARCH
// ==============================

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

            return (

                task.name
                    .toLowerCase()
                    .includes(name)

                &&

                task.task
                    .toLowerCase()
                    .includes(taskText)

            );

        });


    displayTasks(filtered);

}


// ==============================
// MARK DONE
// ==============================

async function markDone(id) {

    if (!confirm(
        "Mark this task as completed?"
    )) {

        return;

    }


    try {

        await fetch(
            `${API}/api/tasks/${id}/done`,
            {
                method: "PUT"
            }
        );


        loadTasks();


    } catch (error) {

        console.error(error);

    }

}


// ==============================
// REVISE
// ==============================

async function reviseTask(id) {

    const newDate =
        prompt(
            "Enter new planned date (YYYY-MM-DD):"
        );


    if (!newDate) {

        return;

    }


    const text =
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

                        planned_date: newDate,

                        revision_text: text

                    })

                }
            );


        if (!response.ok) {

            const data =
                await response.json();

            alert(data.error);

            return;

        }


        loadTasks();


    } catch (error) {

        console.error(error);

    }

}


// ==============================
// TODAY'S TASKS
// ==============================

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


        if (tasks.length === 0) {

            container.innerHTML =
                "<p>No tasks for today.</p>";

            return;

        }


        container.innerHTML = "";


        tasks.forEach(task => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "task-card";


            card.innerHTML = `

                <h3>
                    ${escapeHTML(task.name)}
                </h3>

                <p>
                    ${escapeHTML(task.task)}
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

        console.error(error);

    }

}


// ==============================
// BASIC HTML ESCAPE
// ==============================

function escapeHTML(text) {

    const div =
        document.createElement("div");

    div.textContent =
        text ?? "";

    return div.innerHTML;

}