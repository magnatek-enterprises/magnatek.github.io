const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());


// ===============================
// PostgreSQL CONNECTION
// ===============================

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});


// ===============================
// BASIC TEST
// ===============================

app.get("/", (req, res) => {
    res.json({
        message: "Delegation API is running!"
    });
});


// ===============================
// TEST DATABASE
// ===============================

app.get("/api/test-db", async (req, res) => {

    try {

        const result = await pool.query("SELECT NOW()");

        res.json({
            success: true,
            message: "PostgreSQL connected!",
            time: result.rows[0].now
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });

    }

});


// ===============================
// GET ALL USERS / DOERS
// ===============================

app.get("/api/users", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT id, name, phone, email, role
            FROM users
            ORDER BY name
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch users"
        });

    }

});


// ===============================
// GET TODAY'S TASKS
// ===============================

app.get("/api/tasks/today", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                t.id,
                t.task_code,
                u.name,
                t.task,
                t.planned_date,
                t.status,
                t.total_revisions
            FROM tasks t
            JOIN users u
                ON t.user_id = u.id
            WHERE t.status = 'Pending'
              AND t.planned_date = CURRENT_DATE
            ORDER BY t.id DESC
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch today's tasks"
        });

    }

});


// ===============================
// ADD NEW TASK
// ===============================

app.post("/api/tasks", async (req, res) => {

    try {

        const {
            user_id,
            task,
            planned_date
        } = req.body;


        if (!user_id || !task || !planned_date) {

            return res.status(400).json({
                error: "Doer, task and planned date are required"
            });

        }


        // Reject past dates server-side too, so the restriction
        // can't be bypassed by calling the API directly.
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const chosenDate = new Date(planned_date + "T00:00:00");

        if (chosenDate < today) {

            return res.status(400).json({
                error: "Planned date cannot be in the past"
            });

        }


        // Generate task code
        const task_code =
            Math.random().toString(36).substring(2, 9);


        const result = await pool.query(`
            INSERT INTO tasks
            (
                task_code,
                user_id,
                task,
                planned_date,
                status
            )
            VALUES
            ($1, $2, $3, $4, 'Pending')
            RETURNING *
        `, [
            task_code,
            user_id,
            task,
            planned_date
        ]);


        res.status(201).json({
            success: true,
            message: "Task added successfully",
            task: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to add task"
        });

    }

});


// ===============================
// MARK TASK AS DONE
// ===============================

app.put("/api/tasks/:id/done", async (req, res) => {

    try {

        const { id } = req.params;


        const result = await pool.query(`
            UPDATE tasks
            SET
                status = 'Completed',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [id]);


        if (result.rows.length === 0) {

            return res.status(404).json({
                error: "Task not found"
            });

        }


        res.json({
            success: true,
            message: "Task marked as completed",
            task: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to complete task"
        });

    }

});


// ===============================
// REVISE TASK
// ===============================

app.put("/api/tasks/:id/revise", async (req, res) => {

    try {

        const { id } = req.params;

        const {
            planned_date,
            revision_text
        } = req.body;


        // Reject past dates server-side too.
        if (planned_date) {

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const chosenDate = new Date(planned_date + "T00:00:00");

            if (chosenDate < today) {

                return res.status(400).json({
                    error: "Planned date cannot be in the past"
                });

            }

        }


        const taskResult = await pool.query(`
            SELECT total_revisions
            FROM tasks
            WHERE id = $1
        `, [id]);


        if (taskResult.rows.length === 0) {

            return res.status(404).json({
                error: "Task not found"
            });

        }


        const newRevisionNumber =
            taskResult.rows[0].total_revisions + 1;


        await pool.query(`
            INSERT INTO task_revisions
            (
                task_id,
                revision_number,
                revision_date,
                revision_text
            )
            VALUES
            ($1, $2, CURRENT_DATE, $3)
        `, [
            id,
            newRevisionNumber,
            revision_text || null
        ]);


        const result = await pool.query(`
            UPDATE tasks
            SET
                planned_date = $1,
                total_revisions = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [
            planned_date,
            newRevisionNumber,
            id
        ]);


        res.json({
            success: true,
            message: "Task revised successfully",
            task: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to revise task"
        });

    }

});


// ===============================
// GET ALL DOERS (role = 'Doer')
// ===============================

app.get("/api/doers", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, phone FROM users WHERE role = 'Doer' ORDER BY name"
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch doers"
        });
    }
});


// ===============================
// GET ALL PENDING TASKS
//
// UPDATED: now also returns task_code and total_revisions so the
// "All Pending Tasks" table can show the task code and revision
// count, matching what /api/tasks/today already returned.
// This only ADDS fields to the existing response shape - nothing
// that already worked is removed or renamed.
// ===============================

app.get("/api/tasks", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                t.id,
                t.task_code,
                u.name AS doer_name,
                t.task,
                t.planned_date,
                t.status,
                t.total_revisions
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.status = 'Pending'
            ORDER BY t.planned_date ASC
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch tasks"
        });
    }
});


// ===============================
// DASHBOARD: SUMMARY COUNTS
//
// NEW. Powers the 5 top summary cards (Total / Completed / Pending
// / Due Today / Overdue) on the Management Dashboard.
//
// Why it's needed: every existing task route only ever returns
// PENDING tasks. There was no way to know how many tasks are
// Completed, or the Total across all statuses, without pulling
// every row to the browser. Doing the counting in SQL keeps this
// fast even with thousands of tasks, and keeps PostgreSQL as the
// single source of truth (no numbers are invented on the frontend).
// ===============================

app.get("/api/dashboard/summary", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'Pending') AS pending,
                COUNT(*) FILTER (
                    WHERE status = 'Pending'
                    AND planned_date = CURRENT_DATE
                ) AS due_today,
                COUNT(*) FILTER (
                    WHERE status = 'Pending'
                    AND planned_date < CURRENT_DATE
                ) AS overdue
            FROM tasks
        `);

        const row = result.rows[0];

        res.json({
            total: Number(row.total),
            completed: Number(row.completed),
            pending: Number(row.pending),
            due_today: Number(row.due_today),
            overdue: Number(row.overdue)
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch dashboard summary"
        });

    }

});


// ===============================
// DASHBOARD: DOER PERFORMANCE
//
// NEW. Powers the "Doer Performance" section - total assigned,
// completed, pending and completion % for every doer, computed in
// SQL from the real tasks/users tables (LEFT JOIN so a doer with
// zero tasks still appears with zeros, rather than being silently
// dropped).
// ===============================

app.get("/api/dashboard/doers", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                u.id,
                u.name,
                COUNT(t.id) AS total_assigned,
                COUNT(t.id) FILTER (WHERE t.status = 'Completed') AS completed,
                COUNT(t.id) FILTER (WHERE t.status = 'Pending') AS pending
            FROM users u
            LEFT JOIN tasks t ON t.user_id = u.id
            GROUP BY u.id, u.name
            ORDER BY total_assigned DESC, u.name ASC
        `);

        const doers = result.rows.map(row => {

            const total = Number(row.total_assigned);
            const completed = Number(row.completed);

            return {
                id: row.id,
                name: row.name,
                total_assigned: total,
                completed,
                pending: Number(row.pending),
                completion_percentage:
                    total > 0
                        ? Math.round((completed / total) * 100)
                        : 0
            };

        });

        res.json(doers);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch doer performance"
        });

    }

});


// ===============================
// DASHBOARD: REVISION STATISTICS
//
// NEW. Powers the revision-statistics chart. Uses only the
// existing total_revisions column on tasks (already maintained by
// the /revise route) - no new columns or tables required.
// ===============================

app.get("/api/dashboard/revisions", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE total_revisions = 0) AS never_revised,
                COUNT(*) FILTER (WHERE total_revisions > 0) AS revised,
                COALESCE(AVG(total_revisions), 0) AS avg_revisions
            FROM tasks
        `);

        const row = result.rows[0];

        res.json({
            never_revised: Number(row.never_revised),
            revised: Number(row.revised),
            avg_revisions: Number(parseFloat(row.avg_revisions).toFixed(2))
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch revision statistics"
        });

    }

});


// ===============================
// DASHBOARD: TODAY'S PRIORITY
// (due today + overdue task lists)
//
// NEW. /api/tasks/today already exists for the Follow Up page, but
// there was no route that returns OVERDUE tasks specifically. This
// single route returns both lists together so the dashboard can
// render "Today's Priority" with one request instead of two.
// ===============================

app.get("/api/dashboard/priority", async (req, res) => {

    try {

        const dueToday = await pool.query(`
            SELECT
                t.id,
                t.task_code,
                u.name AS doer_name,
                t.task,
                t.planned_date,
                t.total_revisions
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.status = 'Pending'
              AND t.planned_date = CURRENT_DATE
            ORDER BY t.id DESC
        `);

        const overdue = await pool.query(`
            SELECT
                t.id,
                t.task_code,
                u.name AS doer_name,
                t.task,
                t.planned_date,
                t.total_revisions
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.status = 'Pending'
              AND t.planned_date < CURRENT_DATE
            ORDER BY t.planned_date ASC
        `);

        res.json({
            due_today: dueToday.rows,
            overdue: overdue.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch today's priority"
        });

    }

});


// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
