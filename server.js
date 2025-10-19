// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database('./wolber.db');

// Création des tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT,
    name TEXT,
    classe TEXT
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT,
    class TEXT,
    subject TEXT,
    type TEXT,
    content TEXT
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    fromId TEXT,
    courseId TEXT,
    courseTitle TEXT,
    text TEXT,
    createdAt TEXT
  )`);
});

// Inscription
app.post('/register', (req, res) => {
    const { username, password, name, classe } = req.body;
    const id = uuidv4();
    db.run(`INSERT INTO users(id,username,password,role,name,classe) VALUES(?,?,?,?,?,?)`, [id, username, password, 'student', name, classe],
        function(err) {
            if (err) return res.status(400).send({ error: err.message });
            res.send({ success: true, id });
        });
});

// Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username=? AND password=?`, [username, password], (err, row) => {
        if (err) return res.status(500).send({ error: err.message });
        if (!row) return res.status(400).send({ error: 'Identifiants incorrects' });
        res.send(row);
    });
});

// Lister cours
app.get('/courses', (req, res) => {
    db.all(`SELECT * FROM courses`, (err, rows) => {
        if (err) return res.status(500).send({ error: err.message });
        res.send(rows);
    });
});

// Ajouter cours (admin)
app.post('/courses', (req, res) => {
    const { title, className, subject, type, content } = req.body;
    const id = uuidv4();
    db.run(`INSERT INTO courses(id,title,class,subject,type,content) VALUES(?,?,?,?,?,?)`, [id, title, className, subject, type, content],
        function(err) {
            if (err) return res.status(500).send({ error: err.message });
            res.send({ success: true, id });
        });
});

// Ajouter message
app.post('/messages', (req, res) => {
    const { fromId, courseId, courseTitle, text } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    db.run(`INSERT INTO messages(id,fromId,courseId,courseTitle,text,createdAt) VALUES(?,?,?,?,?,?)`, [id, fromId, courseId, courseTitle, text, createdAt],
        function(err) {
            if (err) return res.status(500).send({ error: err.message });
            res.send({ success: true, id });
        });
});

// Lister messages par utilisateur
app.get('/messages/:userId', (req, res) => {
    const { userId } = req.params;
    db.all(`SELECT * FROM messages WHERE fromId=? ORDER BY createdAt DESC`, [userId], (err, rows) => {
        if (err) return res.status(500).send({ error: err.message });
        res.send(rows);
    });
});

app.listen(3000, () => console.log('Backend running on http://localhost:3000'));