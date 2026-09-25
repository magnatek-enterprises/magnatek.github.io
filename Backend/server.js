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
// Adds nullable, additive columns that features below need.
// IF NOT EXISTS makes this safe to run on every restart - it never
// touches existing columns or data, and does nothing once the
// columns are already there.
//
// NOTE: tasks.actual_date and tasks.priority were already added
// manually (per project instructions) - they are intentionally NOT
// repeated here to avoid a redundant migration. This block only
// keeps the two additive columns from the previous deploy.
//
// task_revisions.planned_date
//   Needed so "Revision History" can show what the planned date was
//   changed TO at each revision.
//
// tasks.created_at
//   Needed for the "Assigned Date" column in Doer History.
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
// HELPERS
// ===============================

const ALLOWED_PRIORITIES = ["High", "Medium", "Low"];

// Detects a leading date such as "21-09-2026" or "08/10/2026" at the
// very start of a task description and returns it as YYYY-MM-DD, or
// null if no recognizable leading date is present. The original task
// text is never modified by this - it is only used to derive
// actual_date on NEW inserts.
function extractLeadingDate(text) {

    if (!text || typeof text !== "string") return null;

    const match = text.trim().match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);

    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 1000 || year > 9999) return null;

    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");

    return `${year}-${mm}-${dd}`;
}

function normalizePriority(value) {
    return ALLOWED_PRIORITIES.includes(value) ? value : "Medium";
}

const TASK_PRIORITY_ORDER_SQL = `
    CASE t.priority
        WHEN 'High' THEN 1
        WHEN 'Medium' THEN 2
        WHEN 'Low' THEN 3
        ELSE 4
    END
`;


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
//
// UPDATED: now also returns phone, needed by the Daily Pending
// Tasks WhatsApp feature. This was already selected before, just
// not documented - no shape change for existing callers.
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
                t.actual_date,
                t.priority,
                t.status,
                t.total_revisions
            FROM tasks t
            JOIN users u
                ON t.user_id = u.id
            WHERE t.status = 'Pending'
              AND t.planned_date = CURRENT_DATE
            ORDER BY ${TASK_PRIORITY_ORDER_SQL}, t.id DESC
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
//
// UPDATED: accepts an optional "priority" (High/Medium/Low, default
// Medium) and automatically derives actual_date from a leading date
// in the task text. The task text itself is stored exactly as
// given - only used to *read* a date from, never modified. This
// only ever affects brand-new inserts; nothing here touches
// existing rows.
// ===============================

app.post("/api/tasks", async (req, res) => {

    try {

        const {
            user_id,
            task,
            planned_date,
            priority
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

        const finalPriority = normalizePriority(priority);
        const actual_date = extractLeadingDate(task);


        const result = await pool.query(`
            INSERT INTO tasks
            (
                task_code,
                user_id,
                task,
                planned_date,
                status,
                priority,
                actual_date
            )
            VALUES
            ($1, $2, $3, $4, 'Pending', $5, $6)
            RETURNING *
        `, [
            task_code,
            user_id,
            task,
            planned_date,
            finalPriority,
            actual_date
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
// Also stores planned_date on the task_revisions row it inserts, so
// Revision History can show what the plan changed to. Nothing about
// the request/response shape changed.
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
// GET TASKS (general purpose, filterable)
//
// UPDATED - this now backs the Tasks view, the Daily Pending Tasks
// view, and the clickable dashboard cards. It stays backward
// compatible: called with no "status" param it still defaults to
// Pending only, exactly like before, so any old cached frontend
// still works.
//
// Supported query params (all optional):
//   status     "Pending" | "Completed" | "Week Shifted" | "All"
//   doer_id    filter by user_id (also accepts "user_id")
//   priority   "High" | "Medium" | "Low" | "All"
//   from, to   filter by planned_date range (YYYY-MM-DD)
//   due        "today" | "overdue" (only meaningful for Pending tasks)
//
// Sort order: High -> Medium -> Low -> (NULL priority, historical
// tasks) last, then by planned_date. This never re-labels historical
// NULL-priority rows as any priority - they just sort after the
// prioritized ones.
// ===============================

app.get("/api/tasks", async (req, res) => {
    try {

        const {
            status,
            doer_id,
            user_id,
            priority,
            from,
            to,
            due
        } = req.query;

        const doerId = doer_id || user_id;

        // Preserve old default behaviour (Pending-only) when the
        // caller doesn't specify a status at all.
        const statusFilter = status || "Pending";

        const conditions = [];
        const params = [];

        if (statusFilter && statusFilter !== "All") {
            params.push(statusFilter);
            conditions.push(`t.status = $${params.length}`);
        }

        if (doerId) {
            params.push(doerId);
            conditions.push(`t.user_id = $${params.length}`);
        }

        if (priority && priority !== "All") {
            params.push(priority);
            conditions.push(`t.priority = $${params.length}`);
        }

        if (from && to) {
            params.push(from);
            params.push(to);
            conditions.push(`t.planned_date BETWEEN $${params.length - 1} AND $${params.length}`);
        }

        if (due === "today") {
            conditions.push(`t.planned_date = CURRENT_DATE`);
        } else if (due === "overdue") {
            conditions.push(`t.planned_date < CURRENT_DATE`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        const result = await pool.query(`
            SELECT
                t.id,
                t.task_code,
                u.name AS doer_name,
                u.phone AS doer_phone,
                t.task,
                t.planned_date,
                t.actual_date,
                t.priority,
                t.status,
                t.total_revisions,
                t.created_at,
                t.updated_at
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            ${whereClause}
            ORDER BY ${TASK_PRIORITY_ORDER_SQL}, t.planned_date ASC
        `, params);

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
// UPDATED: also returns week_shifted as its own count, separate
// from completed/pending, per the Week Shifted requirement. Accepts
// optional ?from=&to= exactly as before.
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
                COUNT(*) FILTER (WHERE status = 'Week Shifted') AS week_shifted,
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
            week_shifted: Number(row.week_shifted),
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
                COUNT(t.id) FILTER (WHERE t.status = 'Pending') AS pending,
                COUNT(t.id) FILTER (WHERE t.status = 'Week Shifted') AS week_shifted
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
                week_shifted: Number(row.week_shifted),
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
// Intentionally NOT affected by the dashboard date filter - these
// are real-time operational flags, not a historical reporting
// period.
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
                t.priority,
                t.total_revisions
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.status = 'Pending'
              AND t.planned_date = CURRENT_DATE
            ORDER BY ${TASK_PRIORITY_ORDER_SQL}, t.id DESC
        `);

        const overdue = await pool.query(`
            SELECT
                t.id,
                t.task_code,
                u.name AS doer_name,
                t.task,
                t.planned_date,
                t.priority,
                t.total_revisions
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.status = 'Pending'
              AND t.planned_date < CURRENT_DATE
            ORDER BY ${TASK_PRIORITY_ORDER_SQL}, t.planned_date ASC
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
                COUNT(*) FILTER (WHERE status = 'Week Shifted') AS week_shifted,
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
                actual_date,
                priority,
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
                week_shifted: Number(row.week_shifted),
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
