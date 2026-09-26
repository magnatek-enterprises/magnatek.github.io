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
// WKNDOT HELPERS
// ===============================

function weekStartSQL(dateExpr) {
    return `(${dateExpr} - ((EXTRACT(ISODOW FROM ${dateExpr})::int - 1) || ' days')::interval)::date`;
}

function weekEndSQL(dateExpr) {
    return `(${weekStartSQL(dateExpr)} + interval '5 days')::date`;
}

function toISODate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().split("T")[0];
    return String(value).split("T")[0];
}

function normalizeWkndotDecision(value) {
    if (value === "Negative" || value === "MARK_NEGATIVE") return "Negative";
    if (value === "Non-Negative" || value === "DO_NOT_MARK_NEGATIVE") return "Non-Negative";
    return null;
}


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


        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const chosenDate = new Date(planned_date + "T00:00:00");

        if (chosenDate < today) {

            return res.status(400).json({
                error: "Planned date cannot be in the past"
            });

        }


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
                actual_date,
                original_planned_date
            )
            VALUES
            ($1, $2, $3, $4, 'Pending', $5, $6, $4)
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
// GET SINGLE TASK (detail)
// ===============================

app.get("/api/tasks/:id", async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(`
            SELECT
                t.id,
                t.task_code,
                t.user_id,
                u.name AS doer_name,
                t.task,
                t.planned_date,
                t.original_planned_date,
                t.actual_date,
                t.priority,
                t.status,
                t.total_revisions,
                t.created_at,
                t.updated_at
            FROM tasks t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Task not found" });
        }

        res.json(result.rows[0]);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch task"
        });

    }

});


// ===============================
// REVISE TASK
// ===============================

app.put("/api/tasks/:id/revise", async (req, res) => {

    const client = await pool.connect();

    try {

        const { id } = req.params;

        const {
            planned_date,
            revision_text,
            wkndot_decision
        } = req.body;


        if (!planned_date) {

            client.release();

            return res.status(400).json({
                error: "A new planned date is required"
            });

        }


        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const chosenDate = new Date(planned_date + "T00:00:00");

        if (chosenDate < today) {

            client.release();

            return res.status(400).json({
                error: "Planned date cannot be in the past"
            });

        }


        await client.query("BEGIN");

        const taskResult = await client.query(`
            SELECT
                id,
                user_id,
                total_revisions,
                planned_date,
                original_planned_date,
                status
            FROM tasks
            WHERE id = $1
            FOR UPDATE
        `, [id]);


        if (taskResult.rows.length === 0) {

            await client.query("ROLLBACK");
            client.release();

            return res.status(404).json({
                error: "Task not found"
            });

        }

        const currentTask = taskResult.rows[0];

        const originalDate = currentTask.original_planned_date || currentTask.planned_date;


        const weekResult = await client.query(`
            SELECT
                ${weekStartSQL("$1::date")} AS task_week_start,
                ${weekEndSQL("$1::date")}   AS task_week_end,
                ${weekStartSQL("CURRENT_DATE")} AS current_week_start
        `, [originalDate]);

        const weekRow = weekResult.rows[0];
        const taskWeekStart = weekRow.task_week_start;
        const taskWeekEnd = weekRow.task_week_end;

        const needsWkndotDecision =
            toISODate(taskWeekStart) === toISODate(weekRow.current_week_start);

        let wkndotOutcome = null;

        if (needsWkndotDecision) {

            // Keyed on (task_id, week_start) only - week_end is fully
            // determined by week_start for a Mon-Sat week (it's
            // always week_start + 5 days), so it is never part of
            // the identity of a WKNDOT decision. Matching on all
            // three columns here was the actual bug: it let this
            // lookup silently miss an existing row whenever it was
            // written with a week_end that didn't exactly match this
            // call's, and the INSERT below would then collide with
            // the real unique constraint on (task_id, week_start),
            // which its ON CONFLICT target didn't cover - producing
            // the "duplicate key value violates..." error.
            const existing = await client.query(`
                SELECT decision
                FROM wkndot_reviews
                WHERE task_id = $1 AND week_start = $2
            `, [id, taskWeekStart]);

            if (existing.rows.length > 0) {

                wkndotOutcome = existing.rows[0].decision;

            } else {

                const normalizedDecision = normalizeWkndotDecision(wkndot_decision);

                if (!normalizedDecision) {

                    await client.query("ROLLBACK");
                    client.release();

                    return res.status(409).json({
                        error: "A WKNDOT decision is required for this revision",
                        wkndot_required: true,
                        week_start: toISODate(taskWeekStart),
                        week_end: toISODate(taskWeekEnd)
                    });

                }

                try {

                    await client.query(`
                        INSERT INTO wkndot_reviews
                            (task_id, week_start, week_end, decision)
                        VALUES
                            ($1, $2, $3, $4)
                        ON CONFLICT (task_id, week_start)
                        DO UPDATE SET
                            decision = EXCLUDED.decision,
                            week_end = EXCLUDED.week_end,
                            updated_at = CURRENT_TIMESTAMP
                    `, [id, taskWeekStart, taskWeekEnd, normalizedDecision]);

                    wkndotOutcome = normalizedDecision;

                } catch (wkndotInsertError) {

                    // Safety net: if the live unique constraint turns
                    // out to be shaped differently than expected, a
                    // genuine 23505 (unique_violation) can still
                    // surface here despite the ON CONFLICT above.
                    // Rather than failing the whole revision over a
                    // WKNDOT bookkeeping race, treat it exactly like
                    // "someone already decided this" and reuse
                    // whatever is now stored.
                    if (wkndotInsertError.code === "23505") {

                        const retry = await client.query(`
                            SELECT decision FROM wkndot_reviews WHERE task_id = $1 AND week_start = $2
                        `, [id, taskWeekStart]);

                        wkndotOutcome = retry.rows.length > 0 ? retry.rows[0].decision : normalizedDecision;

                    } else {

                        throw wkndotInsertError;

                    }

                }

            }

        }


        const newRevisionNumber =
            currentTask.total_revisions + 1;


        await client.query(`
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


        const result = await client.query(`
            UPDATE tasks
            SET
                planned_date = $1,
                total_revisions = $2,
                status = 'Week Shifted',
                original_planned_date = COALESCE(original_planned_date, $4),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `, [
            planned_date,
            newRevisionNumber,
            id,
            currentTask.planned_date
        ]);


        await client.query("COMMIT");

        res.json({
            success: true,
            message: "Task revised successfully",
            task: result.rows[0],
            wkndot: needsWkndotDecision
                ? {
                    required: true,
                    decision: wkndotOutcome,
                    week_start: toISODate(taskWeekStart),
                    week_end: toISODate(taskWeekEnd)
                }
                : { required: false }
        });

    } catch (error) {

        await client.query("ROLLBACK").catch(() => {});

        console.error("REVISE TASK ERROR:", error);

        res.status(500).json({
            error: "Failed to revise task",
            detail: error.message
        });

    } finally {

        client.release();

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
// WKNDOT
// ===============================

function requireWeekParams(req, res) {
    const { week_start, week_end } = req.query;
    if (!week_start || !week_end) {
        res.status(400).json({ error: "week_start and week_end are required (YYYY-MM-DD)" });
        return null;
    }
    return { week_start, week_end };
}

const WKNDOT_TASK_ROW_SQL = `
    SELECT
        t.id,
        t.task_code,
        t.task,
        t.user_id AS doer_id,
        u.name AS doer_name,
        t.original_planned_date,
        t.planned_date,
        t.status,
        t.priority,
        t.total_revisions,
        t.updated_at,
        wr.decision AS review_status,
        (t.status = 'Completed' AND t.updated_at::date <= t.original_planned_date) AS completed_on_time,
        (t.status = 'Completed' AND t.updated_at::date > t.original_planned_date) AS completed_late,
        CASE
            WHEN t.status = 'Completed' AND t.updated_at::date > t.original_planned_date
                THEN GREATEST((t.updated_at::date - t.original_planned_date)::int, 0)
        END AS delay_days,
        CASE
            WHEN t.status != 'Completed'
                THEN GREATEST((CURRENT_DATE - t.original_planned_date)::int, 0)
        END AS currently_delayed_days
    FROM tasks t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN wkndot_reviews wr
        ON wr.task_id = t.id AND wr.week_start = $1
    WHERE t.original_planned_date BETWEEN $1 AND $2
`;

app.get("/api/wkndot/tasks", async (req, res) => {

    try {

        const weekParams = requireWeekParams(req, res);
        if (!weekParams) return;

        const { week_start, week_end } = weekParams;
        const { doer_id } = req.query;

        const params = [week_start, week_end];
        let doerClause = "";

        if (doer_id) {
            params.push(doer_id);
            doerClause = ` AND t.user_id = $${params.length}`;
        }

        const result = await pool.query(`
            ${WKNDOT_TASK_ROW_SQL}
            ${doerClause}
            ORDER BY u.name, t.original_planned_date
        `, params);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch WKNDOT tasks",
            detail: error.message
        });

    }

});

app.get("/api/wkndot/decision", async (req, res) => {

    try {

        const { task_id, week_start, week_end } = req.query;

        if (!task_id || !week_start || !week_end) {
            return res.status(400).json({
                error: "task_id, week_start and week_end are required"
            });
        }

        const result = await pool.query(`
            SELECT decision AS review_status
            FROM wkndot_reviews
            WHERE task_id = $1 AND week_start = $2
        `, [task_id, week_start]);

        if (result.rows.length === 0) {
            return res.json({ review_status: null });
        }

        res.json(result.rows[0]);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch WKNDOT decision",
            detail: error.message
        });

    }

});

app.post("/api/wkndot/review", async (req, res) => {

    try {

        const { task_id, week_start, week_end, review_status } = req.body;

        const normalizedDecision = normalizeWkndotDecision(review_status);

        if (!task_id || !week_start || !week_end || !normalizedDecision) {
            return res.status(400).json({
                error: "task_id, week_start, week_end and a valid review_status ('Negative' or 'Non-Negative') are required"
            });
        }

        const taskResult = await pool.query(`
            SELECT id FROM tasks WHERE id = $1
        `, [task_id]);

        if (taskResult.rows.length === 0) {
            return res.status(404).json({ error: "Task not found" });
        }

        let review;

        try {

            const result = await pool.query(`
                INSERT INTO wkndot_reviews
                    (task_id, week_start, week_end, decision)
                VALUES
                    ($1, $2, $3, $4)
                ON CONFLICT (task_id, week_start)
                DO UPDATE SET
                    decision = EXCLUDED.decision,
                    week_end = EXCLUDED.week_end,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING task_id, week_start, week_end, decision AS review_status
            `, [task_id, week_start, week_end, normalizedDecision]);

            review = result.rows[0];

        } catch (wkndotInsertError) {

            // See the matching comment in PUT /api/tasks/:id/revise -
            // this is the same (task_id, week_start) upsert, with the
            // same defensive fallback for a genuine 23505 race.
            if (wkndotInsertError.code === "23505") {

                const retry = await pool.query(`
                    SELECT task_id, week_start, week_end, decision AS review_status
                    FROM wkndot_reviews
                    WHERE task_id = $1 AND week_start = $2
                `, [task_id, week_start]);

                review = retry.rows[0];

            } else {

                throw wkndotInsertError;

            }

        }

        res.json({
            success: true,
            message: "WKNDOT decision saved",
            review
        });

    } catch (error) {

        console.error("WKNDOT REVIEW SAVE ERROR:", error);

        res.status(500).json({
            error: "Failed to save WKNDOT decision",
            detail: error.message
        });

    }

});

app.get("/api/wkndot/summary", async (req, res) => {

    try {

        const weekParams = requireWeekParams(req, res);
        if (!weekParams) return;

        const { week_start, week_end } = weekParams;
        const { doer_id } = req.query;

        const params = [week_start, week_end];
        let doerClause = "";

        if (doer_id) {
            params.push(doer_id);
            doerClause = ` AND u.id = $${params.length}`;
        }

        const result = await pool.query(`
            SELECT
                u.id AS doer_id,
                u.name AS doer_name,
                COUNT(t.id) AS total_due,
                COUNT(*) FILTER (
                    WHERE t.status = 'Completed' AND t.updated_at::date <= t.original_planned_date
                ) AS completed_on_time,
                COUNT(*) FILTER (WHERE wr.decision = 'Negative') AS negative,
                COUNT(*) FILTER (WHERE wr.decision = 'Non-Negative') AS non_negative,
                COUNT(*) FILTER (
                    WHERE wr.decision IS NULL
                      AND NOT (t.status = 'Completed' AND t.updated_at::date <= t.original_planned_date)
                ) AS pending_review,
                ROUND(AVG(
                    CASE
                        WHEN t.status = 'Completed' AND t.updated_at::date > t.original_planned_date
                            THEN (t.updated_at::date - t.original_planned_date)
                    END
                ), 1) AS avg_delay,
                MAX(
                    CASE
                        WHEN t.status = 'Completed' AND t.updated_at::date > t.original_planned_date
                            THEN (t.updated_at::date - t.original_planned_date)
                    END
                ) AS max_delay
            FROM users u
            JOIN tasks t
                ON t.user_id = u.id
               AND t.original_planned_date BETWEEN $1 AND $2
            LEFT JOIN wkndot_reviews wr
                ON wr.task_id = t.id AND wr.week_start = $1
            WHERE u.role = 'Doer'
            ${doerClause}
            GROUP BY u.id, u.name
            HAVING COUNT(t.id) > 0
            ORDER BY u.name
        `, params);

        const rows = result.rows.map(row => {
            const totalDue = Number(row.total_due);
            const completedOnTime = Number(row.completed_on_time);
            const negative = Number(row.negative);

            return {
                doer_id: row.doer_id,
                doer_name: row.doer_name,
                total_due: totalDue,
                completed_on_time: completedOnTime,
                negative,
                non_negative: Number(row.non_negative),
                pending_review: Number(row.pending_review),
                wkndot_percentage: totalDue > 0 ? Math.round((completedOnTime / totalDue) * 100) : 0,
                negative_rate: totalDue > 0 ? Math.round((negative / totalDue) * 100) : 0,
                avg_delay: row.avg_delay !== null ? Number(row.avg_delay) : null,
                max_delay: row.max_delay !== null ? Number(row.max_delay) : null
            };
        });

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch WKNDOT summary",
            detail: error.message
        });

    }

});

app.get("/api/wkndot/report", async (req, res) => {

    try {

        const weekParams = requireWeekParams(req, res);
        if (!weekParams) return;

        const { week_start, week_end } = weekParams;
        const { doer_id } = req.query;

        const params = [week_start, week_end];
        let doerClause = "";

        if (doer_id) {
            params.push(doer_id);
            doerClause = ` AND u.id = $${params.length}`;
        }

        const summaryResult = await pool.query(`
            SELECT
                u.id AS doer_id,
                u.name AS doer_name,
                COUNT(t.id) AS total_due,
                COUNT(*) FILTER (
                    WHERE t.status = 'Completed' AND t.updated_at::date <= t.original_planned_date
                ) AS completed_on_time,
                COUNT(*) FILTER (WHERE wr.decision = 'Negative') AS negative,
                COUNT(*) FILTER (WHERE wr.decision = 'Non-Negative') AS non_negative,
                COUNT(*) FILTER (
                    WHERE wr.decision IS NULL
                      AND NOT (t.status = 'Completed' AND t.updated_at::date <= t.original_planned_date)
                ) AS pending_review,
                ROUND(AVG(
                    CASE
                        WHEN t.status = 'Completed' AND t.updated_at::date > t.original_planned_date
                            THEN (t.updated_at::date - t.original_planned_date)
                    END
                ), 1) AS avg_delay,
                MAX(
                    CASE
                        WHEN t.status = 'Completed' AND t.updated_at::date > t.original_planned_date
                            THEN (t.updated_at::date - t.original_planned_date)
                    END
                ) AS max_delay
            FROM users u
            JOIN tasks t
                ON t.user_id = u.id
               AND t.original_planned_date BETWEEN $1 AND $2
            LEFT JOIN wkndot_reviews wr
                ON wr.task_id = t.id AND wr.week_start = $1
            WHERE u.role = 'Doer'
            ${doerClause}
            GROUP BY u.id, u.name
            HAVING COUNT(t.id) > 0
            ORDER BY u.name
        `, params);

        const summary = summaryResult.rows.map(row => {
            const totalDue = Number(row.total_due);
            const completedOnTime = Number(row.completed_on_time);
            const negative = Number(row.negative);

            return {
                doer_id: row.doer_id,
                doer_name: row.doer_name,
                total_due: totalDue,
                completed_on_time: completedOnTime,
                negative,
                non_negative: Number(row.non_negative),
                pending_review: Number(row.pending_review),
                wkndot_percentage: totalDue > 0 ? Math.round((completedOnTime / totalDue) * 100) : 0,
                negative_rate: totalDue > 0 ? Math.round((negative / totalDue) * 100) : 0,
                avg_delay: row.avg_delay !== null ? Number(row.avg_delay) : null,
                max_delay: row.max_delay !== null ? Number(row.max_delay) : null
            };
        });

        let tasks = [];

        if (doer_id) {
            const taskResult = await pool.query(`
                ${WKNDOT_TASK_ROW_SQL}
                AND t.user_id = $3
                ORDER BY t.original_planned_date
            `, [week_start, week_end, doer_id]);

            tasks = taskResult.rows;
        }

        res.json({
            week_start,
            week_end,
            summary,
            tasks
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to build WKNDOT report",
            detail: error.message
        });

    }

});


// ===============================
// GET TASKS (general purpose, filterable)
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
