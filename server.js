const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const port = 3002; // You can change this port if needed

// --- Middleware ---
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '')));

// --- Database Configuration ---
// IMPORTANT: Replace these values with your actual MySQL server details.
const dbConfig = {
    host: '34.123.254.168',
    user: 'admin',
    password: 'L@g!n@%$()', // <-- CHANGE THIS
    database: 'edufocus_db',        // <-- Make sure this database exists
    connectionLimit: 10
};

// Create a connection pool
const pool = mysql.createPool(dbConfig);

// --- Helper to get a connection from the pool ---
const getConnection = () => pool.getConnection();

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Edufocus_multitenancy.html'));
});

// POST /api/login
app.post('/api/login', async (req, res) => {
    const { email, password, schoolCode } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    let connection;
    try {
        connection = await getConnection();
        let user, school, allSchools;

        // Super Admin Login (no school code)
        if (!schoolCode) {
            const [users] = await connection.execute(
                'SELECT * FROM users WHERE email = ? AND role = ?',
                [email, 'super-admin']
            );
            if (users.length === 0 || users[0].password !== password) {
                return res.status(401).json({ message: 'Invalid credentials.' });
            }
            user = users[0];
            const [schools] = await connection.execute('SELECT * FROM schools');
            allSchools = schools;
        } else {
            // School Admin Login (with school code)
            const [schools] = await connection.execute(
                'SELECT * FROM schools WHERE school_code = ?',
                [schoolCode]
            );
            if (schools.length === 0) {
                return res.status(404).json({ message: 'School not found.' });
            }
            school = schools[0];
            const [users] = await connection.execute(
                'SELECT * FROM users WHERE email = ? AND school_id = ? AND role = ?',
                [email, school.id, 'school-admin']
            );
            if (users.length === 0) {
                return res.status(401).json({ message: 'User not found in this school.' });
            }
            user = users[0];
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({ message: 'Invalid credentials.' });
            }
        }

        const token = Math.random().toString(36).substring(2); // Simple token for demonstration

        res.json({
            message: 'Login successful',
            token: token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                school_id: user.school_id
            },
            ...(school && { school: { id: school.id, name: school.name, code: school.school_code } }),
            ...(allSchools && { schools: allSchools })
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/schools
app.get('/api/schools', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const [rows] = await connection.execute('SELECT * FROM schools');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/schools
app.post('/api/schools', async (req, res) => {
    const { name, school_code } = req.body;
    if (!name || !school_code) {
        return res.status(400).json({ message: 'School name and code are required.' });
    }

    let connection;
    try {
        connection = await getConnection();
        await connection.execute('INSERT INTO schools (name, school_code) VALUES (?, ?)', [name, school_code]);
        res.status(201).json({ message: 'School added successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/schools/:schoolId/students
app.get('/api/schools/:schoolId/students', async (req, res) => {
    const { schoolId } = req.params;
    let connection;
    try {
        connection = await getConnection();
        const [rows] = await connection.execute(
            'SELECT id, name, grade FROM students WHERE school_id = ?',
            [schoolId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/schools/:schoolId/students
app.post('/api/schools/:schoolId/students', async (req, res) => {
    const { schoolId } = req.params;
    const { name, grade } = req.body;
    if (!name || !grade) {
        return res.status(400).json({ message: 'Student name and grade are required.' });
    }
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            'INSERT INTO students (name, grade, school_id) VALUES (?, ?, ?)',
            [name, grade, schoolId]
        );
        res.status(201).json({ message: 'Student added successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/schools/:schoolId/incidents
app.get('/api/schools/:schoolId/incidents', async (req, res) => {
    const { schoolId } = req.params;
    let connection;
    try {
        connection = await getConnection();
        const [rows] = await connection.execute(
            'SELECT incidents.*, students.name AS student_name FROM incidents JOIN students ON incidents.student_id = students.id WHERE incidents.school_id = ?',
            [schoolId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/schools/:schoolId/incidents
app.post('/api/schools/:schoolId/incidents', async (req, res) => {
    const { schoolId } = req.params;
    const { student_id, description, incident_date } = req.body;
    if (!student_id || !description || !incident_date) {
        return res.status(400).json({ message: 'Student ID, description, and date are required.' });
    }
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            'INSERT INTO incidents (student_id, school_id, description, incident_date) VALUES (?, ?, ?, ?)',
            [student_id, schoolId, description, incident_date]
        );
        res.status(201).json({ message: 'Incident added successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/schools/:schoolId/awards
app.get('/api/schools/:schoolId/awards', async (req, res) => {
    const { schoolId } = req.params;
    let connection;
    try {
        connection = await getConnection();
        const [rows] = await connection.execute(
            'SELECT awards.*, students.name AS student_name FROM awards JOIN students ON awards.student_id = students.id WHERE awards.school_id = ?',
            [schoolId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/schools/:schoolId/awards
app.post('/api/schools/:schoolId/awards', async (req, res) => {
    const { schoolId } = req.params;
    const { student_id, type, description } = req.body;
    if (!student_id || !type) {
        return res.status(400).json({ message: 'Student ID and award type are required.' });
    }
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            'INSERT INTO awards (student_id, school_id, type, description) VALUES (?, ?, ?, ?)',
            [student_id, schoolId, type, description]
        );
        res.status(201).json({ message: 'Award added successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/data-for-chart
app.get('/api/data-for-chart', async (req, res) => {
    const { schoolCode } = req.query;
    let conn;
    try {
        conn = await getConnection();
        let schCond = schoolCode ? 'WHERE i.school_id = (SELECT id FROM schools WHERE school_code=?)' : '';
        let params = schoolCode ? [schoolCode] : [];

        const [incidents] = await conn.execute(
            `SELECT COUNT(*) AS count FROM incidents i ${schCond}`,
            params
        );
        const [awards] = await conn.execute(
            `SELECT COUNT(*) AS count FROM awards a ${schCond}`,
            params
        );
        const [students] = await conn.execute(
            `SELECT COUNT(*) AS count FROM students st JOIN schools s ON st.school_id=s.id ${schCond}`,
            params
        );

        res.json({
            incidentCount: incidents[0].count,
            awardCount: awards[0].count,
            studentCount: students[0].count
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// GET /api/export-data
app.get('/api/export-data', async (req, res) => {
    const { schoolCode } = req.query;
    let conn;
    try {
        conn = await getConnection();
        let schCond = schoolCode ? 'WHERE st.school_id = (SELECT id FROM schools WHERE school_code=?)' : '';
        let params = schoolCode ? [schoolCode] : [];
        if (!schoolCode) {
            schCond = '';
            params = [];
        } else {
            const [school] = await conn.execute('SELECT name FROM schools WHERE school_code=?', [schoolCode]);
            if (!school.length) {
                return res.status(404).send('School not found.');
            }
        }

        const [students] = await conn.execute(
            `SELECT st.*,s.name AS school_name 
       FROM students st JOIN schools s ON st.school_id=s.id ${schCond}`, params);
        const [incidents] = await conn.execute(
            `SELECT i.*,st.name AS student_name,s.name AS school_name 
       FROM incidents i JOIN students st ON i.student_id=st.id JOIN schools s ON i.school_id=s.id ${schCond}`, params);
        const [awards] = await conn.execute(
            `SELECT a.*,st.name AS student_name,s.name AS school_name 
       FROM awards a JOIN students st ON a.student_id=st.id JOIN schools s ON a.school_id=s.id ${schCond}`, params);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=\"${schoolCode}_export.csv\"`);

        // very small CSV helper
        const esc = v => `\"${String(v || '').replace(/\"/g, '\"\"')}\"`;
        const rows = [];
        rows.push(['TYPE', 'SCHOOL', 'STUDENT_NAME', 'GRADE', 'DETAILS', 'DATE']);
        students.forEach(r => rows.push(['STUDENT', r.school_name, r.name, r.grade, '', '']));
        incidents.forEach(r => rows.push(['INCIDENT', r.school_name, r.student_name, '', r.description, r.incident_date]));
        awards.forEach(r => rows.push(['AWARD', r.school_name, r.student_name, '', r.type, r.award_date]));

        res.send(rows.map(row => row.map(esc).join(',')).join('\n'));
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

// POST /api/register
app.post('/api/register', async (req, res) => {
    const { email, password, name, role, school_id } = req.body;
    if (!email || !password || !name || !role) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    let connection;
    try {
        connection = await getConnection();
        const hashedPassword = await bcrypt.hash(password, 10);
        await connection.execute(
            'INSERT INTO users (email, password, name, role, school_id) VALUES (?, ?, ?, ?, ?)',
            [email, hashedPassword, name, role, school_id]
        );
        res.status(201).json({ message: 'User registered successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/dashboard-data
app.get('/api/dashboard-data', async (req, res) => {
    const { schoolId } = req.query;
    let conn;
    try {
        conn = await getConnection();
        const [studentCount] = await conn.execute('SELECT COUNT(*) AS count FROM students WHERE school_id = ?', [schoolId]);
        const [incidentCount] = await conn.execute('SELECT COUNT(*) AS count FROM incidents WHERE school_id = ?', [schoolId]);
        const [awardCount] = await conn.execute('SELECT COUNT(*) AS count FROM awards WHERE school_id = ?', [schoolId]);

        res.json({
            studentCount: studentCount[0].count,
            incidentCount: incidentCount[0].count,
            awardCount: awardCount[0].count
        });

    } catch (err) {
        res.status(500).json({ message: 'Server error.', error: err.message });
    } finally {
        if (conn) conn.release();
    }
});


// Start server
app.listen(port, () => {
    console.log(`✅ EduFocus Backend Server is running on http://localhost:${port}`);
});