// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Secret JWT (à changer en prod)
const JWT_SECRET = 'wolber_secret';

// Connexion à SQLite
const db = new sqlite3.Database('./wolber.db');

// ====================
// Création tables
// ====================
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

  db.run(`CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE
  )`);

  // Création admin principal si inexistant
  db.get(`SELECT * FROM users WHERE username=?`, ['admin'], (err, row) => {
    if (err) console.error(err);
    else if (!row) {
      const adminId = uuidv4();
      db.run(`INSERT INTO users(id, username, password, role, name, classe) VALUES(?,?,?,?,?,?)`,
        [adminId, 'admin', 'admin123', 'admin', 'Administrateur Principal', ''], (err) => {
          if (err) console.error(err);
          else console.log('✅ Administrateur créé : admin / admin123');
        });
    }
  });
});

// ====================
// Middleware Auth
// ====================
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).send({ error: 'Token manquant' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).send({ error: 'Token invalide' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send({ error: 'Token invalide' });
    req.user = user;
    next();
  });
}

// ====================
// Routes
// ====================

// 🔹 Register élève
app.post('/register', (req, res) => {
  const { username, password, name, classe } = req.body;
  const id = uuidv4();

  db.run(`INSERT INTO users(id, username, password, role, name, classe) VALUES(?,?,?,?,?,?)`,
    [id, username, password, 'student', name, classe],
    function(err) {
      if (err) return res.status(400).send({ error: err.message });
      res.send({ success: true, id });
    });
});

// 🔹 Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username=? AND password=?`, [username, password], (err, row) => {
    if (err) return res.status(500).send({ error: err.message });
    if (!row) return res.status(400).send({ error: 'Identifiants incorrects' });

    const token = jwt.sign({ id: row.id, role: row.role }, JWT_SECRET, { expiresIn: '7d' });
    res.send({ ...row, token });
  });
});

// 🔹 Créer un admin
app.post('/create-admin', authMiddleware, (req, res) => {
  const { username, password, name } = req.body;
  if (req.user.role !== 'admin') return res.status(403).send({ error: 'Accès refusé' });

  const id = uuidv4();
  db.run(`INSERT INTO users(id, username, password, role, name, classe) VALUES(?,?,?,?,?,?)`,
    [id, username, password, 'admin', name, ''], function(err) {
      if (err) return res.status(400).send({ error: err.message });
      res.send({ success: true, message: 'Nouvel administrateur créé !' });
    });
});

// 🔹 Liste utilisateurs (admin)
app.get('/list-users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send({ error: 'Accès refusé' });
  db.all(`SELECT id, username, role, name, classe FROM users`, (err, rows) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send(rows);
  });
});

// 🔹 Liste des classes
app.get('/classes', (req, res) => {
  db.all(`SELECT name FROM classes`, (err, rows) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send(rows);
  });
});

// 🔹 Ajouter une classe
app.post('/classes', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send({ error: 'Accès refusé' });
  const { name } = req.body;
  const id = uuidv4();
  db.run(`INSERT INTO classes(id, name) VALUES(?,?)`, [id, name], function(err) {
    if (err) return res.status(400).send({ error: err.message });
    res.send({ success: true });
  });
});

// 🔹 Liste des cours
app.get('/courses', authMiddleware, (req, res) => {
  db.all(`SELECT * FROM courses`, (err, rows) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send(rows);
  });
});

// 🔹 Ajouter cours (admin)
app.post('/courses', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send({ error: 'Seuls les admins peuvent ajouter' });
  const { title, className, subject, type, content } = req.body;
  const id = uuidv4();
  db.run(`INSERT INTO courses(id, title, class, subject, type, content) VALUES(?,?,?,?,?,?)`,
    [id, title, className, subject, type, content], function(err) {
      if (err) return res.status(400).send({ error: err.message });
      res.send({ success: true, id });
    });
});

// 🔹 Ajouter message
app.post('/messages', authMiddleware, (req, res) => {
  const { courseId, courseTitle, text } = req.body;
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  db.run(`INSERT INTO messages(id, fromId, courseId, courseTitle, text, createdAt) VALUES(?,?,?,?,?,?)`,
    [id, req.user.id, courseId || 'none', courseTitle || 'Message libre', text, createdAt],
    function(err) {
      if (err) return res.status(400).send({ error: err.message });
      res.send({ success: true, id });
    });
});

// 🔹 Lister messages d’un utilisateur
app.get('/messages', authMiddleware, (req, res) => {
  db.all(`SELECT * FROM messages WHERE fromId=? ORDER BY createdAt DESC`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send(rows);
  });
});

// ====================
// Lancement serveur
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
