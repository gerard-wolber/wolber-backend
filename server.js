// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connexion à la base SQLite
const db = new sqlite3.Database('./wolber.db');

// Création des tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT,
      name TEXT,
      classe TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title TEXT,
      class TEXT,
      subject TEXT,
      type TEXT,
      content TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      fromId TEXT,
      courseId TEXT,
      courseTitle TEXT,
      text TEXT,
      createdAt TEXT
    )
  `);

  // 🔐 Création automatique de l’administrateur principal si inexistant
  const adminId = uuidv4();
  db.get(`SELECT * FROM users WHERE username = ?`, ['admin'], (err, row) => {
    if (err) console.error('Erreur vérification admin:', err.message);
    else if (!row) {
      db.run(
        `INSERT INTO users(id, username, password, role, name, classe)
         VALUES(?,?,?,?,?,?)`,
        [adminId, 'admin', 'admin123', 'admin', 'Administrateur Principal', ''],
        (err) => {
          if (err) console.error('Erreur création admin:', err.message);
          else console.log('✅ Administrateur créé : admin / admin123');
        }
      );
    } else {
      console.log('ℹ️ Administrateur principal déjà existant.');
    }
  });
});

// ============================
// 🔹 Inscription élève
// ============================
app.post('/register', (req, res) => {
  const { username, password, name, classe } = req.body;
  const id = uuidv4();

  db.run(
    `INSERT INTO users(id, username, password, role, name, classe)
     VALUES(?,?,?,?,?,?)`,
    [id, username, password, 'student', name, classe],
    function (err) {
      if (err) return res.status(400).send({ error: err.message });
      res.send({ success: true, id });
    }
  );
});

// ============================
// 🔹 Connexion
// ============================
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(
    `SELECT * FROM users WHERE username=? AND password=?`,
    [username, password],
    (err, row) => {
      if (err) return res.status(500).send({ error: err.message });
      if (!row)
        return res.status(400).send({ error: 'Identifiants incorrects' });
      res.send(row);
    }
  );
});

// ============================
// 🔹 Créer un autre administrateur
// ============================
app.post('/create-admin', (req, res) => {
  const { requester, username, password, name } = req.body;

  // Vérifier si le demandeur est bien un administrateur
  db.get(`SELECT * FROM users WHERE id=? AND role='admin'`, [requester], (err, row) => {
    if (err) return res.status(500).send({ error: err.message });
    if (!row) return res.status(403).send({ error: "Accès refusé. Vous n'êtes pas administrateur." });

    const id = uuidv4();
    db.run(
      `INSERT INTO users(id, username, password, role, name, classe)
       VALUES(?,?,?,?,?,?)`,
      [id, username, password, 'admin', name, ''],
      function (err) {
        if (err) return res.status(400).send({ error: err.message });
        res.send({ success: true, message: "Nouvel administrateur créé !" });
      }
    );
  });
});

// ============================
// 🔹 Liste de tous les utilisateurs (admin uniquement)
// ============================
app.get('/list-users/:adminId', (req, res) => {
  const { adminId } = req.params;

  db.get(`SELECT * FROM users WHERE id=? AND role='admin'`, [adminId], (err, row) => {
    if (err) return res.status(500).send({ error: err.message });
    if (!row)
      return res.status(403).send({ error: "Accès refusé. Seul un administrateur peut voir cette liste." });

    db.all(`SELECT id, username, role, name, classe FROM users`, (err, users) => {
      if (err) return res.status(500).send({ error: err.message });
      res.send(users);
    });
  });
});

// ============================
// 🔹 Liste des cours
// ============================
app.get('/courses', (req, res) => {
  db.all(`SELECT * FROM courses`, (err, rows) => {
    if (err) return res.status(500).send({ error: err.message });
    res.send(rows);
  });
});

// ============================
// 🔹 Ajouter un cours (admin uniquement)
// ============================
app.post('/courses', (req, res) => {
  const { requester, title, className, subject, type, content } = req.body;

  db.get(`SELECT * FROM users WHERE id=? AND role='admin'`, [requester], (err, row) => {
    if (err) return res.status(500).send({ error: err.message });
    if (!row)
      return res.status(403).send({ error: "Seuls les administrateurs peuvent ajouter des cours." });

    const id = uuidv4();
    db.run(
      `INSERT INTO courses(id, title, class, subject, type, content)
       VALUES(?,?,?,?,?,?)`,
      [id, title, className, subject, type, content],
      function (err) {
        if (err) return res.status(500).send({ error: err.message });
        res.send({ success: true, id });
      }
    );
  });
});

// ============================
// 🔹 Ajouter un message
// ============================
app.post('/messages', (req, res) => {
  const { fromId, courseId, courseTitle, text } = req.body;
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO messages(id, fromId, courseId, courseTitle, text, createdAt)
     VALUES(?,?,?,?,?,?)`,
    [id, fromId, courseId, courseTitle, text, createdAt],
    function (err) {
      if (err) return res.status(500).send({ error: err.message });
      res.send({ success: true, id });
    }
  );
});

// ============================
// 🔹 Lister les messages d’un utilisateur
// ============================
app.get('/messages/:userId', (req, res) => {
  const { userId } = req.params;
  db.all(
    `SELECT * FROM messages WHERE fromId=? ORDER BY createdAt DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).send({ error: err.message });
      res.send(rows);
    }
  );
});

// ============================
// 🔹 Lancement du serveur
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
