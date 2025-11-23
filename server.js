// --- server.js ---
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// --- Configuration et Connexion PostgreSQL ---
const SECRET_KEY = process.env.JWT_SECRET || 'votre_cle_secrete_tres_sure'; // À définir dans les variables d'environnement Render!
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("ERREUR FATALE: La variable d'environnement DATABASE_URL n'est pas définie.");
    process.exit(1);
}

// Configuration du Pool de connexions
const pool = new Pool({
    connectionString: DB_URL,
    // CRUCIAL : Nécessaire pour les connexions sécurisées (SSL) vers Render ou d'autres services cloud
    ssl: {
        rejectUnauthorized: false
    }
});

/**
 * Fonction générique pour exécuter une requête SQL.
 * Utilise des paramètres $1, $2, ... pour la sécurité.
 */
async function runQuery(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows; 
    } catch (err) {
        console.error("Erreur lors de l'exécution de la requête:", err.message, "SQL:", sql);
        throw err; 
    } finally {
        client.release(); 
    }
}

// --- Initialisation de la Base de Données (Persistance garantie) ---
async function initializeDatabase() {
    try {
        console.log("Démarrage de l'initialisation PostgreSQL...");
        
        // 1. Création de la table USERS
        await runQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT,
                role TEXT DEFAULT 'student',
                classe TEXT
            );
        `);

        // 2. Création de la table CLASSES
        await runQuery(`
            CREATE TABLE IF NOT EXISTS classes (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            );
        `);
        
        // 3. Création de la table MATTERS
        await runQuery(`
            CREATE TABLE IF NOT EXISTS matters (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                classe TEXT NOT NULL,
                UNIQUE (name, classe)
            );
        `);
        
        // 4. Création de la table COURSES
        await runQuery(`
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                content_type TEXT NOT NULL, -- 'text' ou 'pdf'
                author TEXT NOT NULL,
                classe TEXT NOT NULL,
                matter TEXT NOT NULL
            );
        `);

        // 5. Insertion de l'admin par défaut (mot de passe: adminpass)
        const hashedPassword = await bcrypt.hash('adminpass', 10);
        
        await runQuery(`
            INSERT INTO users (username, password, name, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (username) DO NOTHING;
        `, ['admin', hashedPassword, 'Admin User', 'admin']);

        console.log("Base de données PostgreSQL initialisée et prête. Le serveur écoute sur le port " + PORT);
        app.listen(PORT, () => console.log(`Serveur Node.js démarré sur le port ${PORT}`));

    } catch (err) {
        console.error("Erreur fatale lors de l'initialisation de la BD:", err);
        process.exit(1); 
    }
}

// Démarre la base de données puis le serveur
initializeDatabase(); 

// --- Middleware de Vérification de Token ---
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Accès refusé. Token manquant.' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Accès refusé. Token malformé.' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            // Token expiré ou invalide
            return res.status(403).json({ error: 'Token invalide ou expiré.' }); 
        }
        req.user = user;
        next();
    });
};

// Middleware pour vérifier le rôle Admin
const checkAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Accès administrateur requis.' });
    }
};

// --- ROUTES D'AUTHENTIFICATION ---

// 1. Inscription d'un nouvel élève
app.post('/register', async (req, res) => {
    const { username, password, name, classe } = req.body;

    if (!username || !password || !name || !classe) {
        return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Vérifier si l'utilisateur existe déjà
        const existingUser = await runQuery('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.length > 0) {
             return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà.' });
        }
        
        // Insérer l'utilisateur
        await runQuery(
            'INSERT INTO users (username, password, name, role, classe) VALUES ($1, $2, $3, $4, $5)',
            [username, hashedPassword, name, 'student', classe]
        );
        
        res.status(200).json({ message: 'Inscription réussie.' });

    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de l\'inscription.' });
    }
});

// 2. Connexion
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const users = await runQuery('SELECT * FROM users WHERE username = $1', [username]);
        const user = users[0];

        if (!user) {
            return res.status(401).json({ error: 'Nom utilisateur ou mot de passe incorrect.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Nom utilisateur ou mot de passe incorrect.' });
        }

        // Création du JWT
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, classe: user.classe },
            SECRET_KEY,
            { expiresIn: '24h' } // Token expire après 24 heures
        );

        // Retirer le mot de passe avant d'envoyer la réponse
        const { password: _, ...userData } = user;
        
        res.json({ 
            ...userData,
            token 
        });

    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
    }
});


// --- ROUTES ADMIN SÉCURISÉES (requièrent verifyToken et checkAdmin) ---

// 3. Obtenir la liste des classes (Accessible à tous pour le formulaire d'inscription)
app.get('/classes', async (req, res) => {
    try {
        const classes = await runQuery('SELECT name FROM classes ORDER BY name');
        res.json(classes);
    } catch (error) {
        res.status(500).json({ error: 'Erreur chargement classes.' });
    }
});

// 4. Ajouter une classe (ADMIN)
app.post('/classes', verifyToken, checkAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Le nom de la classe est requis.' });
    
    try {
        await runQuery('INSERT INTO classes (name) VALUES ($1)', [name]);
        res.status(200).json({ message: 'Classe ajoutée avec succès.' });
    } catch (error) {
        if (error.code === '23505') { // Code d'erreur PostgreSQL pour violation de contrainte unique
            return res.status(400).json({ error: 'Cette classe existe déjà.' });
        }
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la classe.' });
    }
});

// 5. Ajouter une matière (ADMIN)
app.post('/matters', verifyToken, checkAdmin, async (req, res) => {
    const { name, classe } = req.body;
    if (!name || !classe) return res.status(400).json({ error: 'Nom et classe sont requis.' });
    
    try {
        await runQuery('INSERT INTO matters (name, classe) VALUES ($1, $2)', [name, classe]);
        res.status(200).json({ message: 'Matière ajoutée avec succès.' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Cette matière existe déjà pour cette classe.' });
        }
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la matière.' });
    }
});

// 6. Obtenir les matières (ADMIN ou ÉLÈVE)
app.get('/matters', async (req, res) => {
    const { classe } = req.query;
    if (!classe) {
         // Si aucune classe n'est spécifiée, l'API peut retourner toutes les matières ou rien.
         // Pour cette implémentation, nous retournons une erreur si le filtre est manquant.
         return res.status(400).json({ error: 'Le paramètre de classe est requis pour filtrer les matières.' });
    }

    try {
        const matters = await runQuery('SELECT * FROM matters WHERE classe = $1 ORDER BY name', [classe]);
        res.json(matters);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des matières.' });
    }
});


// 7. Ajouter un cours (ADMIN)
app.post('/courses', verifyToken, checkAdmin, async (req, res) => {
    const { title, content, contentType, author, classe, matter } = req.body;
    
    if (!title || !content || !contentType || !classe || !matter) {
        return res.status(400).json({ error: 'Champs manquants (title, content, contentType, classe, matter).' });
    }

    try {
        await runQuery(
            'INSERT INTO courses (title, content, content_type, author, classe, matter) VALUES ($1, $2, $3, $4, $5, $6)',
            [title, content, contentType, author || req.user.username, classe, matter]
        );
        res.status(200).json({ message: 'Cours publié avec succès.' });
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la publication du cours.' });
    }
});

// 8. Obtenir les cours (ADMIN ou ÉLÈVE)
app.get('/courses', async (req, res) => {
    const { classe, matter } = req.query;
    
    if (!classe || !matter) {
        return res.status(400).json({ error: 'Les paramètres classe et matter sont requis.' });
    }

    try {
        const courses = await runQuery(
            'SELECT id, title, content_type, author, content FROM courses WHERE classe = $1 AND matter = $2 ORDER BY id DESC',
            [classe, matter]
        );
        res.json(courses);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des cours.' });
    }
});


// 9. Liste des utilisateurs (ADMIN)
app.get('/list-users', verifyToken, checkAdmin, async (req, res) => {
    try {
        // Exclut le champ 'password' dans la sélection
        const users = await runQuery('SELECT id, username, name, role, classe FROM users ORDER BY role, name');
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
    }
});

// 10. Statistiques du Tableau de bord (ADMIN)
app.get('/stats', verifyToken, checkAdmin, async (req, res) => {
    try {
        // Compter tous les utilisateurs
        const totalUsersResult = await runQuery("SELECT COUNT(*) FROM users");
        const totalUsers = parseInt(totalUsersResult[0].count);

        // Compter tous les élèves (rôle 'student')
        const totalStudentsResult = await runQuery("SELECT COUNT(*) FROM users WHERE role = 'student'");
        const totalStudents = parseInt(totalStudentsResult[0].count);

        // Compter toutes les classes
        const totalClassesResult = await runQuery("SELECT COUNT(*) FROM classes");
        const totalClasses = parseInt(totalClassesResult[0].count);
        
        // Derniers 5 élèves inscrits
        const lastStudents = await runQuery(
            "SELECT name, classe FROM users WHERE role = 'student' ORDER BY id DESC LIMIT 5"
        );

        res.json({
            totalUsers,
            totalStudents,
            totalClasses,
            lastStudents,
        });

    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
    }
});

// --- ROUTE POUR L'UPLOAD PDF (PLACEHOLDER) ---
// ⚠️ ATTENTION: Cette route doit être implémentée AVEC un service de stockage réel.
// Elle ne stockera pas de fichier de manière persistante sans 'multer' + S3/Cloudinary.
app.post('/upload-pdf', verifyToken, checkAdmin, (req, res) => {
    // Si vous utilisez un middleware comme 'multer', le fichier serait dans req.file
    // L'implémentation de l'upload est trop complexe pour être incluse ici et dépend
    // de votre solution de stockage cloud (S3, Cloudinary).
    
    // Si vous mettez en place un vrai service, cette route devrait:
    // 1. Recevoir le fichier multipart/form-data.
    // 2. Le stocker dans S3/Cloudinary.
    // 3. Retourner l'URL publique du fichier.

    // Pour l'instant, je retourne un code 400 pour indiquer que l'endpoint n'est pas fonctionnel
    // jusqu'à ce que l'infrastructure d'upload soit prête.
    res.status(400).json({ 
        error: "L'upload de PDF n'est pas encore implémenté sur le serveur.", 
        solution: "Implémentez 'multer' + un service de stockage cloud (S3, Cloudinary) pour stocker les fichiers de manière persistante et retourner l'URL."
    });
});
