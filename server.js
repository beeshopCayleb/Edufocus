

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const port = 3002; // You can change this port if needed

// --- Middleware ---
app.use(cors());
app.use(express.json());

const path = require('path');
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
                return res.status(401).json({ message: 'Invalid super admin credentials.' });
            }
            user = users[0];
            const [schools] = await connection.execute('SELECT id, name, code FROM schools');
            allSchools = schools;
            school = { name: 'All Schools', code: 'ALL' }; // Virtual school for super admin
        } else {
            // Admin / Teacher Login
            const [schools] = await connection.execute('SELECT id, name, code FROM schools WHERE code = ?', [schoolCode]);
            if (schools.length === 0) {
                return res.status(404).json({ message: 'Invalid School Code.' });
            }
            school = schools[0];
            
            const [users] = await connection.execute(
                'SELECT * FROM users WHERE email = ? AND school_id = ?',
                [email, school.id]
            );

            if (users.length === 0 || users[0].password !== password) {
                 return res.status(401).json({ message: 'Invalid email or password for this school.' });
            }
            user = users[0];
        }

        // In a real app, you would generate and return a JWT token here.
        // For simplicity, we are sending back the user and school objects.
        delete user.password; // Never send password to the client
        res.json({ success: true, user, school, allSchools });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Database error during login.' });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/dashboard-stats
app.get('/api/dashboard-stats', async (req, res) => {
    const { schoolCode } = req.query;
    if (!schoolCode) return res.status(400).json({ message: 'School code is required.' });
    
    let connection;
    try {
        connection = await getConnection();
        const schoolCondition = schoolCode === 'ALL' ? '' : `WHERE s.code = '${schoolCode}'`;
        
        const [incidents] = await connection.execute(`
            SELECT i.*, st.gender 
            FROM incidents i
            JOIN students st ON i.student_id = st.id
            JOIN schools s ON i.school_id = s.id
            ${schoolCondition}
        `);

        // Additional queries can be added here for other stats if needed
        
        res.json({ incidents }); // Simplified response, frontend logic will calculate stats

    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard stats' });
    } finally {
        if (connection) connection.release();
    }
});

// GET /api/analytics-stats
app.get('/api/analytics-stats', async (req, res) => {
    const { schoolCode } = req.query;
    if (!schoolCode) return res.status(400).json({ message: 'School code is required.' });

    let connection;
    try {
        connection = await getConnection();
         const schoolCondition = schoolCode === 'ALL' ? '1=1' : `s.code = ?`;
         const params = schoolCode === 'ALL' ? [] : [schoolCode];

        const [data] = await connection.execute(`
            SELECT 
                i.location, i.incident_datetime, i.incident_date,
                st.grade, st.gender, st.nationality
            FROM incidents i
            JOIN students st ON i.student_id = st.id
            JOIN schools s ON st.school_id = s.id
            WHERE ${schoolCondition}
        `, params);
        
        res.json(data);

    } catch (error) {
        console.error('Error fetching analytics stats:', error);
        res.status(500).json({ message: 'Failed to fetch analytics stats' });
    } finally {
        if (connection) connection.release();
    }
});

// GET all data for a school (students, incidents, awards)
app.get('/api/school-data', async (req, res) => {
    const { schoolCode } = req.query;
    if (!schoolCode) return res.status(400).json({ message: 'School code is required.' });

    let connection;
    try {
        connection = await getConnection();
        const schoolCondition = schoolCode === 'ALL' ? '' : `WHERE school_id = (SELECT id FROM schools WHERE code = '${schoolCode}')`;

        const [students] = await connection.execute(`SELECT * FROM students ${schoolCondition}`);
        const [incidents] = await connection.execute(`SELECT * FROM incidents ${schoolCondition}`);
        const [awards] = await connection.execute(`SELECT * FROM awards ${schoolCondition}`);
        
        res.json({ students, incidents, awards });

    } catch (error) {
        console.error('Error fetching school data:', error);
        res.status(500).json({ message: 'Failed to fetch school data' });
    } finally {
        if (connection) connection.release();
    }
});


// POST /api/incidents
app.post('/api/incidents', async (req, res) => {
    const { studentId, schoolId, teacher_name, tier, description, location, incident_datetime } = req.body;
    
    let connection;
    try {
        connection = await getConnection();
        const sql = `
            INSERT INTO incidents (student_id, school_id, teacher_name, tier, description, location, incident_datetime, incident_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), 'Pending')
        `;
        const [result] = await connection.execute(sql, [studentId, schoolId, teacher_name, tier, description, location, incident_datetime]);
        res.status(201).json({ message: 'Incident logged successfully', incidentId: result.insertId });
    } catch (error) {
        console.error('Error logging incident:', error);
        res.status(500).json({ message: 'Failed to log incident' });
    } finally {
        if (connection) connection.release();
    }
});


// PUT /api/incidents/:id
app.put('/api/incidents/:id', async (req, res) => {
    const { id } = req.params;
    const { status, status_details, academic_summary, attitude } = req.body;
    
    let connection;
    try {
        connection = await getConnection();
        const sql = `
            UPDATE incidents SET status = ?, status_details = ?, academic_summary = ?, attitude = ?
            WHERE id = ?
        `;
        await connection.execute(sql, [status, status_details, academic_summary, JSON.stringify(attitude), id]);
        res.json({ message: 'Incident updated successfully' });
    } catch (error) {
        console.error('Error updating incident:', error);
        res.status(500).json({ message: 'Failed to update incident' });
    } finally {
        if (connection) connection.release();
    }
});


// Other endpoints (Manage Schools, Users, Tiers, etc.) would follow a similar pattern...
/* ------------------------------------------------------------------ */
/*  NEW ADMIN / SUPER-ADMIN ROUTES                                     */
/* ------------------------------------------------------------------ */

// -----  USERS  -----
app.get('/api/users', async (req,res)=>{                // list (all or per school)
  const {schoolCode} = req.query;
  let conn; 
  try{
    conn = await getConnection();
    const sql = schoolCode==='ALL'
      ? `SELECT u.id,u.name,u.email,u.role,s.name AS school_name 
           FROM users u LEFT JOIN schools s ON u.school_id=s.id`
      : `SELECT u.id,u.name,u.email,u.role 
           FROM users u JOIN schools s ON u.school_id=s.id 
           WHERE s.code=?`;
    const params = schoolCode==='ALL' ? [] : [schoolCode];
    const [rows] = await conn.execute(sql,params);
    res.json(rows);
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

app.post('/api/users', async (req,res)=>{              // create
  const {name,email,password,role,schoolCode} = req.body;
  if(!name||!email||!password||!role) return res.status(400).json({message:'Missing fields'});
  let conn;
  try{
    conn = await getConnection();
    const [sch] = await conn.execute('SELECT id FROM schools WHERE code=?',[schoolCode]);
    if(!sch.length) return res.status(404).json({message:'Bad school code'});
    const [result] = await conn.execute(
      'INSERT INTO users (name,email,password,role,school_id) VALUES (?,?,?,?,?)',
      [name,email,password,role,sch[0].id]
    );
    res.status(201).json({id:result.insertId});
  }catch(e){
    if(e.code==='ER_DUP_ENTRY') return res.status(409).json({message:'Email already exists'});
    console.error(e); res.status(500).json({message:'DB error'});
  }finally{if(conn)conn.release();}
});

app.put('/api/users/:id', async (req,res)=>{           // edit
  const {id} = req.params;
  const {name,email,password,role} = req.body;
  let conn;
  try{
    conn = await getConnection();
    await conn.execute(
      'UPDATE users SET name=?, email=?, password=?, role=? WHERE id=?',
      [name,email,password,role,id]
    );
    res.json({message:'Updated'});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

app.delete('/api/users/:id', async (req,res)=>{        // delete
  let conn;
  try{
    conn = await getConnection();
    await conn.execute('DELETE FROM users WHERE id=?',[req.params.id]);
    res.json({message:'Deleted'});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

// -----  SCHOOLS  -----
app.get('/api/schools', async (_req,res)=>{
  let conn;
  try{
    conn = await getConnection();
    const [rows] = await conn.execute('SELECT id,name,code FROM schools');
    res.json(rows);
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

app.post('/api/schools', async (req,res)=>{
  const {name,code} = req.body;
  if(!name||!code) return res.status(400).json({message:'Missing fields'});
  let conn;
  try{
    conn = await getConnection();
    const [result] = await conn.execute('INSERT INTO schools (name,code) VALUES (?,?)',[name,code]);
    res.status(201).json({id:result.insertId});
  }catch(e){
    if(e.code==='ER_DUP_ENTRY') return res.status(409).json({message:'Code already exists'});
    console.error(e); res.status(500).json({message:'DB error'});
  }finally{if(conn)conn.release();}
});

app.delete('/api/schools/:id', async (req,res)=>{
  let conn;
  try{
    conn = await getConnection();
    await conn.execute('DELETE FROM schools WHERE id=?',[req.params.id]);
    res.json({message:'Deleted'});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

// -----  TIERS  -----
app.get('/api/tiers/:schoolCode', async (req,res)=>{
  const {schoolCode} = req.params;
  let conn;
  try{
    conn = await getConnection();
    const [rows] = await conn.execute(
      `SELECT t.id,t.name,t.description 
       FROM tiers t JOIN schools s ON t.school_id=s.id 
       WHERE s.code=? ORDER BY t.name`,
      [schoolCode]
    );
    res.json(rows);
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

app.post('/api/tiers', async (req,res)=>{
  const {name,description,schoolCode} = req.body;
  let conn;
  try{
    conn = await getConnection();
    const [sch] = await conn.execute('SELECT id FROM schools WHERE code=?',[schoolCode]);
    if(!sch.length) return res.status(404).json({message:'Bad school code'});
    const [result] = await conn.execute(
      'INSERT INTO tiers (name,description,school_id) VALUES (?,?,?)',
      [name,description,sch[0].id]
    );
    res.status(201).json({id:result.insertId});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

app.put('/api/tiers/:id', async (req,res)=>{
  const {id} = req.params;
  const {name,description} = req.body;
  let conn;
  try{
    conn = await getConnection();
    await conn.execute('UPDATE tiers SET name=?, description=? WHERE id=?',[name,description,id]);
    res.json({message:'Updated'});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

app.delete('/api/tiers/:id', async (req,res)=>{
  let conn;
  try{
    conn = await getConnection();
    await conn.execute('DELETE FROM tiers WHERE id=?',[req.params.id]);
    res.json({message:'Deleted'});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

// -----  CONFIDENTIAL REPORTS  -----
app.post('/api/confidential-reports', async (req,res)=>{
  const {subject,description,schoolCode} = req.body;
  if(!subject||!description) return res.status(400).json({message:'Missing fields'});
  let conn;
  try{
    conn = await getConnection();
    const [sch] = await conn.execute('SELECT id FROM schools WHERE code=?',[schoolCode]);
    if(!sch.length) return res.status(404).json({message:'Bad school code'});
    await conn.execute(
      'INSERT INTO confidential_reports (school_id,subject,description,created_at) VALUES (?,?,?,NOW())',
      [sch[0].id,subject,description]
    );
    res.json({message:'Report submitted'});
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});

// -----  EXPORT  -----
app.get('/api/export', async (req,res)=>{
  const {schoolCode} = req.query;
  if(!schoolCode) return res.status(400).json({message:'schoolCode required'});
  let conn;
  try{
    conn = await getConnection();
    const schCond = schoolCode==='ALL' ? '' : 'WHERE s.code=?';
    const params = schoolCode==='ALL' ? [] : [schoolCode];

    const [students] = await conn.execute(
      `SELECT st.*,s.name AS school_name 
       FROM students st JOIN schools s ON st.school_id=s.id ${schCond}`,params);
    const [incidents] = await conn.execute(
      `SELECT i.*,st.name AS student_name,s.name AS school_name 
       FROM incidents i JOIN students st ON i.student_id=st.id JOIN schools s ON i.school_id=s.id ${schCond}`,params);
    const [awards] = await conn.execute(
      `SELECT a.*,st.name AS student_name,s.name AS school_name 
       FROM awards a JOIN students st ON a.student_id=st.id JOIN schools s ON a.school_id=s.id ${schCond}`,params);

    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="${schoolCode}_export.csv"`);

    // very small CSV helper
    const esc = v => `"${String(v||'').replace(/"/g,'""')}"`;
    const rows = [];
    rows.push(['TYPE','SCHOOL','STUDENT_NAME','GRADE','DETAILS','DATE']);
    students.forEach(r=> rows.push(['STUDENT',r.school_name,r.name,r.grade,'','']));
    incidents.forEach(r=> rows.push(['INCIDENT',r.school_name,r.student_name,'',r.description,r.incident_date]));
    awards.forEach(r=> rows.push(['AWARD',r.school_name,r.student_name,'',r.type,r.award_date]));
    res.send(rows.map(r=>r.map(esc).join(',')).join('\n'));
  }catch(e){console.error(e); res.status(500).json({message:'DB error'});}
  finally{if(conn)conn.release();}
});
// --- Start Server ---
app.listen(port, () => {
    console.log(`✅ EduFocus Backend Server is running on http://localhost:${port}`);
});