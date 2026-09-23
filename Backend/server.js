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
// SCHEMA CHECK (runs once on boot)
//
// Adds two nullable, additive columns that new features below need.
// IF NOT EXISTS makes this safe to run on every restart - it never
// touches existing columns or data, and does nothing once the
// columns are already there.
//
// task_revisions.planned_date
//   Needed so "Revision History" can show what the planned date was
//   changed TO at each revision. Previously only the current
//   tasks.planned_date was kept, so that history was not
//   reconstructable. Revisions made before this deploy will show
//   "-" for this field; every revision made after it will be
//   captured correctly going forward.
//
// tasks.created_at
//   Needed for the "Assigned Date" column in Doer History. Existing
//   rows will initially show the date this migration ran (their
//   real original creation date was never recorded); every task
//   created after this deploy will have an accurate value.
// ===============================

async function ensureSchema() {

    try {

        await pool.query(`
            ALTER TABLE task_revisions
            ADD COLUMN IF NOT EXISTS planned_date DATE
        `);

        await pool.query(`
            ALTER TABLE tasks
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);

        console.log("Schema check complete.");

    } catch (error) {

        console.error("Schema check failed:", error);

    }

}

ensureSchema();


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
//
// UPDATED: also stores planned_date on the task_revisions row it
// inserts, so Revision History can show what the plan changed to.
// Nothing about the request/response shape changed.
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
                planned_date,
                revision_text
            )
            VALUES
            ($1, $2, CURRENT_DATE, $3, $4)
        `, [
            id,
            newRevisionNumber,
            planned_date,
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
// GET REVISION HISTORY FOR A TASK
//
// NEW. Powers the "Revision History" modal on the Tasks page.
// Reads only from the existing task_revisions table (plus the
// planned_date column added by ensureSchema above).
// ===============================

app.get("/api/tasks/:id/revisions", async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(`
            SELECT
                revision_number,
                revision_date,
                planned_date,
                revision_text
            FROM task_revisions
            WHERE task_id = $1
            ORDER BY revision_number ASC
        `, [id]);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch revision history"
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
// UPDATED: accepts optional ?from=YYYY-MM-DD&to=YYYY-MM-DD to
// filter by planned_date, used for the dashboard's date-range
// filter. Called with no params it behaves exactly as before
// (all-time), so nothing existing breaks.
// ===============================

app.get("/api/dashboard/summary", async (req, res) => {

    try {

        const { from, to } = req.query;
        const hasRange = Boolean(from && to);

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
            ${hasRange ? "WHERE planned_date BETWEEN $1 AND $2" : ""}
        `, hasRange ? [from, to] : []);

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
// UPDATED: accepts optional ?from=&to= the same way. The date
// filter lives in the LEFT JOIN condition (not a WHERE clause) so
// a doer with zero tasks in the selected range still appears with
// zeros, instead of disappearing from the list.
// ===============================

app.get("/api/dashboard/doers", async (req, res) => {

    try {

        const { from, to } = req.query;
        const hasRange = Boolean(from && to);

        const result = await pool.query(`
            SELECT
                u.id,
                u.name,
                COUNT(t.id) AS total_assigned,
                COUNT(t.id) FILTER (WHERE t.status = 'Completed') AS completed,
                COUNT(t.id) FILTER (WHERE t.status = 'Pending') AS pending
            FROM users u
            LEFT JOIN tasks t
                ON t.user_id = u.id
                ${hasRange ? "AND t.planned_date BETWEEN $1 AND $2" : ""}
            GROUP BY u.id, u.name
            ORDER BY total_assigned DESC, u.name ASC
        `, hasRange ? [from, to] : []);

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
// UPDATED: accepts optional ?from=&to= the same way.
// ===============================

app.get("/api/dashboard/revisions", async (req, res) => {

    try {

        const { from, to } = req.query;
        const hasRange = Boolean(from && to);

        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE total_revisions = 0) AS never_revised,
                COUNT(*) FILTER (WHERE total_revisions > 0) AS revised,
                COALESCE(AVG(total_revisions), 0) AS avg_revisions
            FROM tasks
            ${hasRange ? "WHERE planned_date BETWEEN $1 AND $2" : ""}
        `, hasRange ? [from, to] : []);

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
// Unchanged and intentionally NOT affected by the dashboard date
// filter - "due today" / "overdue" are real-time operational
// flags, not a historical reporting period, so they always reflect
// right now regardless of which range is selected above them.
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
// DASHBOARD: SINGLE DOER - COMPLETE HISTORY
//
// NEW. Powers the "Doer History" modal opened by clicking a name in
// Doer Performance. Optional ?from=&to= narrows it; called with
// neither (the modal's default) it returns the doer's full history
// from the beginning, as requested.
// ===============================

app.get("/api/dashboard/doers/:id/history", async (req, res) => {

    try {

        const { id } = req.params;
        const { from, to } = req.query;
        const hasRange = Boolean(from && to);

        const doerResult = await pool.query(`
            SELECT id, name FROM users WHERE id = $1
        `, [id]);

        if (doerResult.rows.length === 0) {

            return res.status(404).json({
                error: "Doer not found"
            });

        }

        const summaryResult = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'Pending') AS pending,
                COUNT(*) FILTER (WHERE total_revisions > 0) AS revised,
                COUNT(*) FILTER (
                    WHERE status = 'Pending'
                    AND planned_date < CURRENT_DATE
                ) AS overdue
            FROM tasks
            WHERE user_id = $1
            ${hasRange ? "AND planned_date BETWEEN $2 AND $3" : ""}
        `, hasRange ? [id, from, to] : [id]);

        const row = summaryResult.rows[0];
        const total = Number(row.total);
        const completed = Number(row.completed);

        const tasksResult = await pool.query(`
            SELECT
                id,
                task_code,
                task,
                created_at,
                planned_date,
                status,
                total_revisions,
                updated_at
            FROM tasks
            WHERE user_id = $1
            ${hasRange ? "AND planned_date BETWEEN $2 AND $3" : ""}
            ORDER BY planned_date DESC
        `, hasRange ? [id, from, to] : [id]);

        res.json({
            doer: doerResult.rows[0],
            summary: {
                total,
                completed,
                pending: Number(row.pending),
                revised: Number(row.revised),
                overdue: Number(row.overdue),
                completion_percentage:
                    total > 0
                        ? Math.round((completed / total) * 100)
                        : 0
            },
            tasks: tasksResult.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch doer history"
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
