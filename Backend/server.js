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
// GET ALL PENDING TASKS
// ===============================



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
// Get all doers
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
// Get all pending tasks
app.get("/api/tasks", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                t.id,
                u.name AS doer_name,
                t.task,
                t.planned_date,
                t.status
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
// START SERVER
// ===============================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});