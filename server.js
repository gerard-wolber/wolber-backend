// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'YOUR_SECRET_KEY_WOLBER'; // 🚨 REMPLACER AVEC UNE CLÉ SECRÈTE FORTE

// --- Configuration ---
app.use(cors()); // Autorise les requêtes Flutter
app.use(express.json()); // Permet de parser les corps de requêtes JSON

// --- Base de Données (SQLite) ---
const db = new sqlite3.Database('wolber.db', (err) => {
    if (err) {
        console.error("Erreur d'ouverture de la base de données:", err.message);
    } else {
        console.log('Connecté à la base de données SQLite (wolber.db).');
        db.serialize(() => {
            // Création des tables (voir le schéma dans la réponse)
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'student',
                classe TEXT,
                token TEXT
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS classes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS matters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                classe TEXT NOT NULL,
                UNIQUE(name, classe)
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                contentType TEXT NOT NULL DEFAULT 'text',
                author TEXT,
                classe TEXT NOT NULL,
                matter TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Création de l'Admin par défaut si non existant
            const adminPassword = 'adminpass'; // Mot de passe par défaut
            const adminHashedPassword = bcrypt.hashSync(adminPassword, 10);
            db.run(`INSERT OR IGNORE INTO users (name, username, password, role) 
                    VALUES (?, ?, ?, ?)`, 
                    ['Admin Principal', 'admin', adminHashedPassword, 'admin'], 
                    (err) => {
                if (err) console.error("Erreur création Admin:", err.message);
                else console.log('Admin par défaut créé ou déjà existant.');
            });
        });
    }
});

// --- Middleware d'Authentification (pour sécuriser les routes Admin) ---
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Accès non autorisé. Jeton manquant.' });
    }

    const token = authHeader.split(' ')[1]; // Format: Bearer <token>

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded; // Ajoute les données utilisateur à la requête
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Jeton invalide.' });
    }
};

// Middleware pour vérifier le rôle Admin
const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Accès refusé. Nécessite le rôle Admin.' });
    }
};

// ====================================================================
// ---------------- 1. AUTHENTIFICATION (LOGIN / REGISTER) ----------------
// ====================================================================

// Route d'Inscription
app.post('/register', (req, res) => {
    const { name, username, password, classe } = req.body;

    if (!name || !username || !password || !classe) {
        return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }

    // Hashage du mot de passe
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run(`INSERT INTO users (name, username, password, role, classe) VALUES (?, ?, ?, ?, ?)`,
        [name, username, hashedPassword, 'student', classe],
        function(err) {
            if (err) {
                // Erreur d'unicité (username déjà pris)
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
                }
                console.error(err);
                return res.status(500).json({ error: "Erreur lors de l'inscription." });
            }
            res.status(200).json({ message: 'Inscription réussie.' });
        });
});

// Route de Connexion
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
        }

        // Comparaison du mot de passe
        const isPasswordValid = bcrypt.compareSync(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
        }

        // Génération du token JWT
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '24h' });

        // Mise à jour du token dans la DB (Optionnel, pour tracking)
        db.run(`UPDATE users SET token = ? WHERE id = ?`, [token, user.id]);

        // Retourne les infos utilisateur + token (comme attendu par Flutter)
        res.status(200).json({
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role,
            classe: user.classe,
            token: token
        });
    });
});

// ====================================================================
// ---------------- 2. ROUTES ADMIN (Gestion des entités) ----------------
// ====================================================================

// --- Classes ---
// ⬇️ AJOUTER une classe (Admin)
app.post('/classes', authMiddleware, adminMiddleware, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Le nom de la classe est requis.' });

    db.run(`INSERT INTO classes (name) VALUES (?)`, [name], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Cette classe existe déjà.' });
            }
            return res.status(500).json({ error: "Erreur lors de l'ajout de la classe." });
        }
        res.status(200).json({ id: this.lastID, name: name });
    });
});

// ⬇️ OBTENIR toutes les classes (Utilisé par Admin et Inscription)
app.get('/classes', (req, res) => {
    db.all(`SELECT name FROM classes ORDER BY name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erreur de base de données.' });
        res.status(200).json(rows);
    });
});

// --- Matières ---
// ⬇️ AJOUTER une matière (Admin)
app.post('/matters', authMiddleware, adminMiddleware, (req, res) => {
    const { name, classe } = req.body;
    if (!name || !classe) return res.status(400).json({ error: 'Le nom de la matière et la classe sont requis.' });

    db.run(`INSERT INTO matters (name, classe) VALUES (?, ?)`, [name, classe], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: `La matière ${name} existe déjà pour la classe ${classe}.` });
            }
            return res.status(500).json({ error: "Erreur lors de l'ajout de la matière." });
        }
        res.status(200).json({ id: this.lastID, name, classe });
    });
});

// ⬇️ OBTENIR les matières par classe
app.get('/matters', (req, res) => {
    const { classe } = req.query;
    if (!classe) {
        // Optionnel: renvoyer toutes les matières si aucun filtre n'est spécifié
        db.all(`SELECT name, classe FROM matters ORDER BY classe, name`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: 'Erreur de base de données.' });
            res.status(200).json(rows);
        });
        return;
    }

    db.all(`SELECT name, classe FROM matters WHERE classe = ? ORDER BY name`, [classe], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erreur de base de données.' });
        res.status(200).json(rows);
    });
});

// --- Cours ---
// ⬇️ AJOUTER un cours (Admin)
app.post('/courses', authMiddleware, adminMiddleware, (req, res) => {
    const { title, content, contentType, classe, matter } = req.body;
    const author = req.user.username; // Récupérer l'auteur depuis le jeton

    if (!title || !content || !classe || !matter) {
        return res.status(400).json({ error: 'Titre, Contenu, Classe et Matière sont requis.' });
    }

    db.run(`INSERT INTO courses (title, content, contentType, author, classe, matter) VALUES (?, ?, ?, ?, ?, ?)`,
        [title, content, contentType || 'text', author, classe, matter],
        function(err) {
            if (err) return res.status(500).json({ error: "Erreur lors de la publication du cours." });
            res.status(200).json({ id: this.lastID, title, classe, matter });
        });
});

// ⬇️ OBTENIR les cours par classe et matière (Utilisé par Admin et Étudiant)
app.get('/courses', (req, res) => {
    const { classe, matter } = req.query;

    let sql = `SELECT id, title, content, contentType, author, classe, matter, createdAt FROM courses`;
    let params = [];

    if (classe && matter) {
        // Filtrage strict (utilisé par le code Flutter)
        sql += ` WHERE classe = ? AND matter = ? ORDER BY createdAt DESC`;
        params = [classe, matter];
    } else if (classe) {
        // Filtrage par classe seule (Peut être utile pour une vue "Mes Cours")
        sql += ` WHERE classe = ? ORDER BY createdAt DESC`;
        params = [classe];
    } else {
        // Aucun filtre (Admin: tous les cours, mais ce n'est pas l'usage actuel dans Flutter)
        sql += ` ORDER BY createdAt DESC`;
        params = [];
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erreur de base de données.' });
        res.status(200).json(rows);
    });
});

// --- Utilisateurs et Statistiques ---
// ⬇️ OBTENIR la liste de TOUS les utilisateurs (Admin)
app.get('/list-users', authMiddleware, adminMiddleware, (req, res) => {
    db.all(`SELECT id, name, username, role, classe FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erreur de base de données.' });
        res.status(200).json(rows);
    });
});

// ⬇️ OBTENIR les statistiques du Dashboard (Admin)
app.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
    const count = (sql) => new Promise((resolve, reject) => {
        db.get(sql, [], (err, row) => {
            if (err) return reject(err);
            resolve(row.count);
        });
    });

    try {
        const totalUsers = await count(`SELECT COUNT(*) as count FROM users`);
        const totalStudents = await count(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`);
        const totalClasses = await count(`SELECT COUNT(*) as count FROM classes`);

        db.all(`SELECT name, classe FROM users WHERE role = 'student' ORDER BY id DESC LIMIT 5`, [], (err, lastStudents) => {
            if (err) return res.status(500).json({ error: 'Erreur de base de données pour les derniers étudiants.' });

            res.status(200).json({
                totalUsers,
                totalStudents,
                totalClasses,
                lastStudents: lastStudents || []
            });
        });

    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
    }
});

// --- Lancement du Serveur ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`URL locale: http://localhost:${PORT}`);
    console.log("-----------------------------------------");
    console.log("N'oubliez pas de déployer sur Render !");
});
