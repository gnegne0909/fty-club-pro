const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Discord OAuth
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'YOUR_DISCORD_CLIENT_ID';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YOUR_DISCORD_CLIENT_SECRET';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/discord/callback`;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'fty-club-ultra-secret-2026-xywez-pro',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 jours
}));

const DB_FILE = path.join(__dirname, 'database.json');

const HIERARCHY = {
    'owner': 9, 'fondateur': 8, 'cofondateur': 7,
    'manager': 6, 'administrateur': 5, 'moderateur': 4,
    'support': 3, 'capitaine': 2, 'joueur': 1
};

const ROLE_LABELS = {
    'owner': '👑 Owner', 'fondateur': '🌟 Fondateur', 'cofondateur': '⭐ Co-Fondateur',
    'manager': '📊 Manager', 'administrateur': '🛡️ Administrateur', 'moderateur': '⚖️ Modérateur',
    'support': '🎧 Support', 'capitaine': '🎯 Capitaine', 'joueur': '⚽ Joueur'
};

const ROLE_COLORS = {
    'owner': '#ff0050', 'fondateur': '#ff6b00', 'cofondateur': '#ffaa00',
    'manager': '#00d4ff', 'administrateur': '#00ff88', 'moderateur': '#88ff00',
    'support': '#ffdd00', 'capitaine': '#ff00dd', 'joueur': '#ffffff'
};

// Histoire enrichie du club
const CLUB_HISTORY = [
    {
        year: '2023',
        month: 'Septembre',
        title: 'La Genèse - Une Vision Naît',
        description: 'xywez, joueur passionné de FC depuis des années, décide de franchir le cap et de créer son propre club e-sport. L\'objectif : rassembler les meilleurs joueurs francophones et créer une famille compétitive.',
        image: '💡',
        stats: 'Membres fondateurs : 3'
    },
    {
        year: '2023',
        month: 'Novembre', 
        title: 'La Rencontre Décisive',
        description: 'Sur un serveur Discord, xywez découvre Tom, un jeune prodige de 11 ans au talent fou. Après quelques matchs ensemble, l\'évidence s\'impose : Tom deviendra le capitaine de FTY.',
        image: '🤝',
        stats: 'Membres : 8 • Première équipe type'
    },
    {
        year: '2024',
        month: 'Janvier',
        title: 'Formation de l\'Équipe Type',
        description: 'Tom prend officiellement le brassard de capitaine. L\'équipe adopte la formation 4-3-3 et développe un style de jeu basé sur la possession et les transitions rapides.',
        image: '⚽',
        stats: 'Membres actifs : 15 • Formation : 4-3-3'
    },
    {
        year: '2024',
        month: 'Mars',
        title: 'Premier Sacre - Tournoi des Légendes',
        description: 'FTY remporte son premier tournoi officiel ! Victoire 3-1 en finale avec un doublé de Tom. La communauté commence à remarquer ce nouveau club prometteur.',
        image: '🏆',
        stats: '1er Tournoi remporté • 3-1 en finale'
    },
    {
        year: '2024',
        month: 'Juin',
        title: 'Structuration Professionnelle',
        description: 'Recrutement de managers, analystes vidéo et coaches. xywez met en place une vraie structure avec des entraînements réguliers et une analyse tactique poussée.',
        image: '📊',
        stats: 'Staff : 6 personnes • 3 entraînements/semaine'
    },
    {
        year: '2024',
        month: 'Septembre',
        title: 'Inauguration du FTY Arena',
        description: 'Création du stade virtuel emblématique du club : le FTY Arena, 45 000 places. Un lieu où chaque match devient un événement avec analyses en direct et spectateurs.',
        image: '🏟️',
        stats: 'Capacité : 45 000 spectateurs virtuels'
    },
    {
        year: '2025',
        month: 'Janvier',
        title: 'Début de la Saison Historique',
        description: '12 victoires consécutives pour débuter la saison ! Tom, à seulement 11 ans, devient une véritable légende. Les plus grands clubs commencent à s\'intéresser à FTY.',
        image: '🔥',
        stats: '12-0-0 • 38 buts marqués, 7 encaissés'
    },
    {
        year: '2025',
        month: 'Mai',
        title: 'Champions ! Le Titre Est À Nous',
        description: 'FTY remporte le championnat de manière éclatante : 15 victoires, 4 nuls, 2 défaites. Meilleure attaque avec 58 buts, meilleure différence de but (+37). Tom termine meilleur buteur avec 23 réalisations.',
        image: '👑',
        stats: '15V-4N-2D • 58 buts • 21 encaissés'
    },
    {
        year: '2025',
        month: 'Août',
        title: 'Tournée Européenne',
        description: 'FTY participe à des tournois européens et affronte les meilleures équipes du continent. Quarts de finale de l\'European Pro League, le club se fait un nom international.',
        image: '🌍',
        stats: 'Tournois EU : 3 • Quarts de finale EPL'
    },
    {
        year: '2026',
        month: 'Février',
        title: 'Nouvelle Ère - Site Pro & Expansion',
        description: 'Lancement du nouveau site professionnel avec OAuth Discord, panel admin complet, système de candidatures et gestion avancée. FTY passe un nouveau cap et recrute massivement.',
        image: '🚀',
        stats: 'Membres : 45+ • Candidatures : Ouvertes'
    }
];

// Stade virtuel
const STADIUM_DATA = {
    name: 'FTY Arena',
    capacity: '45,000',
    inauguration: '2024',
    features: ['Écran géant 4K', 'Pelouse hybride', 'Loges VIP', 'Zone média professionnelle']
};

function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialDB = {
            users: [],
            logs: [],
            sanctions: [],
            tickets: [],
            blacklist: [],
            suggestions: [],
            candidatures: [],
            resetRequests: [],
            matches: [
                { 
                    id: "1", 
                    adversaire: "RIVAL FC", 
                    date: "20/02/2026 - 20h00", 
                    competition: "Championnat", 
                    status: "scheduled", 
                    score: null,
                    stadium: "FTY Arena"
                },
                { 
                    id: "2", 
                    adversaire: "CHALLENGER ESports", 
                    date: "25/02/2026 - 21h00", 
                    competition: "Coupe FTY", 
                    status: "scheduled", 
                    score: null,
                    stadium: "FTY Arena"
                }
            ],
            compositions: [{
                formation: "4-3-3",
                tactique: "Possession Offensive",
                players: [
                    { name: "Gardien Pro", position: "GB", number: 1, available: true },
                    { name: "Défenseur G", position: "DG", number: 3, available: true },
                    { name: "Défenseur C1", position: "DC", number: 4, available: true },
                    { name: "Défenseur C2", position: "DC", number: 5, available: true },
                    { name: "Défenseur D", position: "DD", number: 2, available: true },
                    { name: "Milieu Créatif", position: "MC", number: 8, available: true },
                    { name: "Sentinelle", position: "MDC", number: 6, available: true },
                    { name: "Ailier G", position: "AG", number: 11, available: true },
                    { name: "Avant-Centre", position: "BU", number: 9, available: true },
                    { name: "Meneur", position: "MO", number: 10, available: true },
                    { name: "Ailier D", position: "AD", number: 7, available: true }
                ]
            }],
            communiques: [
                { 
                    id: "1", 
                    title: "🎉 Bienvenue sur le nouveau site FTY !", 
                    content: "Découvrez notre plateforme professionnelle avec OAuth Discord, thèmes personnalisables et bien plus !", 
                    date: "15/02/2026", 
                    author: "xywez" 
                },
                { 
                    id: "2", 
                    title: "🏆 Victoire Écrasante 5-1 !", 
                    content: "FTY domine son adversaire dans un match spectaculaire au FTY Arena !", 
                    date: "12/02/2026", 
                    author: "Tom" 
                }
            ],
            conferences: [],
            stats: { 
                wins: 15, 
                draws: 4, 
                losses: 2, 
                goals: 58, 
                goalsAgainst: 21,
                winRate: 71.4
            },
            settings: {
                maintenanceMode: false,
                maintenanceMessage: ''
            }
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
    }
    
    const db = readDB();
    
    // S'assurer que stats existe toujours
    if (!db.stats) {
        db.stats = { 
            wins: 15, 
            draws: 4, 
            losses: 2, 
            goals: 58, 
            goalsAgainst: 21,
            winRate: 71.4
        };
        writeDB(db);
    }
    
    // Créer le compte owner principal si inexistant
    if (!db.users.find(u => u.username === 'xywez')) {
        db.users.push({
            id: 'owner-001',
            username: 'xywez',
            password: hashPassword('Yaakoub.80'),
            accountType: 'owner',
            discordId: '969065205067825222',
            discordUsername: 'xywez',
            discordAvatar: null,
            createdAt: new Date().toISOString(),
            lastLogin: null,
            suspended: false,
            banned: false,
            blacklisted: false,
            mustChangePassword: false,
            theme: 'dark',
            ip: [],
            warns: [],
            notes: 'Fondateur et Owner principal du club FTY'
        });
        writeDB(db);
    }
}

function readDB() { 
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); 
}

function writeDB(data) { 
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); 
}

function addLog(action, executor, target, details = {}, ip = '') {
    const db = readDB();
    if (!db.logs) db.logs = [];
    db.logs.unshift({ 
        id: Date.now().toString(), 
        action, 
        executor, 
        target, 
        details, 
        ip, 
        timestamp: new Date().toISOString() 
    });
    if (db.logs.length > 10000) db.logs = db.logs.slice(0, 10000);
    writeDB(db);
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'fty-salt-pro-2026').digest('hex');
}

function comparePassword(password, hash) { 
    return hashPassword(password) === hash; 
}

function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let pass = '';
    for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    return pass;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || 'unknown';
}

function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/panel/login');
}

function hasRole(minRole) {
    return (req, res, next) => {
        if (!req.session.user) return res.redirect('/panel/login');
        if (HIERARCHY[req.session.user.accountType] >= HIERARCHY[minRole]) return next();
        res.status(403).send(errorPage('Accès Refusé', 'Vous n\'avez pas les permissions nécessaires.'));
    };
}

// ============ STYLES GLOBAUX AVEC THÈMES ============
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;900&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

*, *::before, *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

:root {
    --primary: #ff0050;
    --primary-dark: #cc0040;
    --primary-glow: rgba(255, 0, 80, 0.5);
    --secondary: #00d4ff;
    --secondary-glow: rgba(0, 212, 255, 0.5);
    --success: #00ff88;
    --warning: #ffaa00;
    --danger: #ff0050;
    
    --font-display: 'Orbitron', sans-serif;
    --font-body: 'Inter', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    
    --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    --shadow-sm: 0 2px 8px rgba(0,0,0,0.1);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.2);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.3);
    --shadow-xl: 0 16px 64px rgba(0,0,0,0.4);
}

/* Thème Sombre (défaut) */
[data-theme="dark"] {
    --bg-primary: #0a0a0f;
    --bg-secondary: #12121a;
    --bg-tertiary: #1a1a28;
    --bg-card: rgba(255, 255, 255, 0.04);
    --bg-card-hover: rgba(255, 255, 255, 0.08);
    
    --text-primary: #ffffff;
    --text-secondary: rgba(255, 255, 255, 0.7);
    --text-muted: rgba(255, 255, 255, 0.4);
    
    --border: rgba(255, 255, 255, 0.1);
    --border-hover: rgba(255, 255, 255, 0.2);
}

/* Thème Clair */
[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f8f9fa;
    --bg-tertiary: #e9ecef;
    --bg-card: rgba(0, 0, 0, 0.02);
    --bg-card-hover: rgba(0, 0, 0, 0.04);
    
    --text-primary: #0a0a0f;
    --text-secondary: rgba(0, 0, 0, 0.7);
    --text-muted: rgba(0, 0, 0, 0.4);
    
    --border: rgba(0, 0, 0, 0.1);
    --border-hover: rgba(0, 0, 0, 0.2);
}

html {
    scroll-behavior: smooth;
}

body {
    font-family: var(--font-body);
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 100vh;
    overflow-x: hidden;
    line-height: 1.6;
}

::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
    background: var(--primary);
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--primary-dark);
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1.2;
}

.display-1 { font-size: 4rem; }
.display-2 { font-size: 3rem; }
.display-3 { font-size: 2.5rem; }

/* Container */
.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 2rem;
}

.container-fluid {
    width: 100%;
    padding: 0 2rem;
}

/* Grid System */
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.5rem; }

@media (max-width: 1024px) {
    .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}

/* Cards */
.card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    transition: var(--transition);
    backdrop-filter: blur(10px);
}

.card:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
}

.card-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
}

/* Buttons */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    font-size: 0.95rem;
    font-weight: 500;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: var(--transition);
    text-decoration: none;
    font-family: var(--font-body);
}

.btn-primary {
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    color: white;
    box-shadow: 0 4px 16px var(--primary-glow);
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 24px var(--primary-glow);
}

.btn-secondary {
    background: linear-gradient(135deg, var(--secondary) 0%, #00a8cc 100%);
    color: white;
    box-shadow: 0 4px 16px var(--secondary-glow);
}

.btn-success {
    background: var(--success);
    color: #0a0a0f;
}

.btn-warning {
    background: var(--warning);
    color: #0a0a0f;
}

.btn-danger {
    background: var(--danger);
    color: white;
}

.btn-outline {
    background: transparent;
    border: 2px solid var(--primary);
    color: var(--primary);
}

.btn-outline:hover {
    background: var(--primary);
    color: white;
}

.btn-full {
    width: 100%;
}

.btn-sm {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
}

.btn-lg {
    padding: 1rem 2rem;
    font-size: 1.125rem;
}

/* Forms */
.form-group {
    margin-bottom: 1.5rem;
}

.form-label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: var(--text-secondary);
    font-size: 0.95rem;
}

.form-control {
    width: 100%;
    padding: 0.875rem 1rem;
    font-size: 0.95rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-family: var(--font-body);
    transition: var(--transition);
}

.form-control:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-glow);
}

textarea.form-control {
    resize: vertical;
    min-height: 120px;
}

select.form-control {
    cursor: pointer;
}

/* Alerts */
.alert {
    padding: 1rem 1.5rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    border-left: 4px solid;
}

.alert-success {
    background: rgba(0, 255, 136, 0.1);
    border-color: var(--success);
    color: var(--success);
}

.alert-warning {
    background: rgba(255, 170, 0, 0.1);
    border-color: var(--warning);
    color: var(--warning);
}

.alert-danger {
    background: rgba(255, 0, 80, 0.1);
    border-color: var(--danger);
    color: var(--danger);
}

.alert-info {
    background: rgba(0, 212, 255, 0.1);
    border-color: var(--secondary);
    color: var(--secondary);
}

/* Badges */
.badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 6px;
    background: var(--bg-tertiary);
}

/* Tables */
.table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-card);
    border-radius: 12px;
    overflow: hidden;
}

.table th,
.table td {
    padding: 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
}

.table th {
    background: var(--bg-tertiary);
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.table tbody tr:hover {
    background: var(--bg-card-hover);
}

/* Utilities */
.text-center { text-align: center; }
.text-right { text-align: right; }
.text-left { text-align: left; }

.text-primary { color: var(--primary) !important; }
.text-secondary { color: var(--text-secondary) !important; }
.text-muted { color: var(--text-muted) !important; }
.text-success { color: var(--success) !important; }
.text-warning { color: var(--warning) !important; }
.text-danger { color: var(--danger) !important; }

.mt-8 { margin-top: 0.5rem; }
.mt-16 { margin-top: 1rem; }
.mt-24 { margin-top: 1.5rem; }
.mt-32 { margin-top: 2rem; }

.mb-8 { margin-bottom: 0.5rem; }
.mb-16 { margin-bottom: 1rem; }
.mb-24 { margin-bottom: 1.5rem; }
.mb-32 { margin-bottom: 2rem; }

.p-16 { padding: 1rem; }
.p-24 { padding: 1.5rem; }
.p-32 { padding: 2rem; }

/* Divider */
.divider {
    height: 1px;
    background: var(--border);
    margin: 1.5rem 0;
}

/* Loading */
.loading {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Animations */
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

.fade-in {
    animation: fadeIn 0.6s ease-out;
}

@keyframes slideIn {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
}

.slide-in {
    animation: slideIn 0.5s ease-out;
}

/* Glow effect */
.glow {
    box-shadow: 0 0 20px var(--primary-glow);
}

.glow-secondary {
    box-shadow: 0 0 20px var(--secondary-glow);
}
`;

// ============ LAYOUT PUBLIC ============
function publicLayout(title, content, theme = 'dark') {
    return `<!DOCTYPE html>
<html lang="fr" data-theme="${theme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - FTY Club Pro</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>⚽</text></svg>">
    <style>${GLOBAL_CSS}</style>
    <style>
        /* Navigation */
        .navbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(20px);
            z-index: 1000;
        }

        .navbar-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 2rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 80px;
        }

        .navbar-brand {
            display: flex;
            align-items: center;
            gap: 1rem;
            font-family: var(--font-display);
            font-size: 1.5rem;
            font-weight: 900;
            color: var(--text-primary);
            text-decoration: none;
        }

        .navbar-brand-logo {
            font-size: 2rem;
        }

        .navbar-menu {
            display: flex;
            align-items: center;
            gap: 2rem;
            list-style: none;
        }

        .navbar-link {
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            transition: var(--transition);
            position: relative;
        }

        .navbar-link:hover {
            color: var(--primary);
        }

        .navbar-link::after {
            content: '';
            position: absolute;
            bottom: -5px;
            left: 0;
            width: 0;
            height: 2px;
            background: var(--primary);
            transition: var(--transition);
        }

        .navbar-link:hover::after {
            width: 100%;
        }

        .navbar-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .theme-toggle {
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            width: 40px;
            height: 40px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: var(--transition);
            font-size: 1.25rem;
        }

        .theme-toggle:hover {
            background: var(--bg-card-hover);
            border-color: var(--border-hover);
        }

        /* Hero Section */
        .hero {
            position: relative;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding-top: 80px;
            overflow: hidden;
        }

        .hero-bg {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(circle at 20% 50%, var(--primary-glow) 0%, transparent 50%),
                radial-gradient(circle at 80% 50%, var(--secondary-glow) 0%, transparent 50%);
            opacity: 0.3;
            z-index: 0;
        }

        .hero-content {
            position: relative;
            z-index: 1;
            text-align: center;
            max-width: 900px;
            padding: 0 2rem;
        }

        .hero-title {
            font-size: 5rem;
            font-weight: 900;
            margin-bottom: 1.5rem;
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: fadeIn 1s ease-out;
        }

        .hero-subtitle {
            font-size: 1.5rem;
            color: var(--text-secondary);
            margin-bottom: 3rem;
            animation: fadeIn 1s ease-out 0.2s both;
        }

        .hero-actions {
            display: flex;
            gap: 1.5rem;
            justify-content: center;
            flex-wrap: wrap;
            animation: fadeIn 1s ease-out 0.4s both;
        }

        /* Section */
        .section {
            padding: 6rem 0;
        }

        .section-header {
            text-align: center;
            margin-bottom: 4rem;
        }

        .section-title {
            font-size: 3rem;
            font-weight: 900;
            margin-bottom: 1rem;
        }

        .section-subtitle {
            font-size: 1.25rem;
            color: var(--text-secondary);
        }

        /* Footer */
        .footer {
            background: var(--bg-secondary);
            border-top: 1px solid var(--border);
            padding: 3rem 0;
            margin-top: 6rem;
        }

        .footer-content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 3rem;
        }

        .footer-section h3 {
            margin-bottom: 1rem;
            font-size: 1.25rem;
        }

        .footer-links {
            list-style: none;
        }

        .footer-links li {
            margin-bottom: 0.75rem;
        }

        .footer-links a {
            color: var(--text-secondary);
            text-decoration: none;
            transition: var(--transition);
        }

        .footer-links a:hover {
            color: var(--primary);
        }

        .footer-bottom {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid var(--border);
            text-align: center;
            color: var(--text-muted);
        }

        /* Stadium 3D */
        .stadium-container {
            position: relative;
            width: 100%;
            height: 500px;
            background: var(--bg-tertiary);
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid var(--border);
        }

        .stadium-canvas {
            width: 100%;
            height: 100%;
        }

        .stadium-info {
            position: absolute;
            bottom: 2rem;
            left: 2rem;
            background: rgba(0, 0, 0, 0.8);
            padding: 1.5rem;
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }

        .stadium-info h3 {
            margin-bottom: 0.5rem;
            font-size: 1.5rem;
        }

        .stadium-features {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-top: 1rem;
        }

        .stadium-features .badge {
            background: var(--primary);
            color: white;
        }

        /* Timeline */
        .timeline {
            position: relative;
            padding: 2rem 0;
        }

        .timeline::before {
            content: '';
            position: absolute;
            left: 50%;
            top: 0;
            bottom: 0;
            width: 2px;
            background: var(--border);
            transform: translateX(-50%);
        }

        .timeline-item {
            position: relative;
            margin-bottom: 3rem;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4rem;
        }

        .timeline-item:nth-child(even) .timeline-content {
            grid-column: 1;
        }

        .timeline-item:nth-child(even) .timeline-year {
            grid-column: 2;
            text-align: left;
        }

        .timeline-item:nth-child(odd) .timeline-content {
            grid-column: 2;
        }

        .timeline-item:nth-child(odd) .timeline-year {
            grid-column: 1;
            text-align: right;
        }

        .timeline-year {
            font-size: 3rem;
            font-weight: 900;
            font-family: var(--font-display);
            color: var(--primary);
        }

        .timeline-content {
            background: var(--bg-card);
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid var(--border);
        }

        .timeline-content h3 {
            margin-bottom: 0.75rem;
            font-size: 1.5rem;
        }

        .timeline-dot {
            position: absolute;
            left: 50%;
            top: 2rem;
            width: 20px;
            height: 20px;
            background: var(--primary);
            border-radius: 50%;
            transform: translateX(-50%);
            box-shadow: 0 0 20px var(--primary-glow);
        }

        @media (max-width: 768px) {
            .hero-title { font-size: 3rem; }
            .timeline::before { left: 20px; }
            .timeline-item {
                grid-template-columns: 1fr;
                gap: 1rem;
                padding-left: 3rem;
            }
            .timeline-item:nth-child(even) .timeline-content,
            .timeline-item:nth-child(odd) .timeline-content {
                grid-column: 1;
            }
            .timeline-item:nth-child(even) .timeline-year,
            .timeline-item:nth-child(odd) .timeline-year {
                grid-column: 1;
                text-align: left;
            }
            .timeline-dot { left: 20px; }
        }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="navbar-container">
            <a href="/" class="navbar-brand">
                <span class="navbar-brand-logo">⚽</span>
                <span>FTY CLUB</span>
            </a>
            <ul class="navbar-menu">
                <li><a href="/" class="navbar-link">Accueil</a></li>
                <li><a href="/#histoire" class="navbar-link">Histoire</a></li>
                <li><a href="/#tactique" class="navbar-link">Tactique</a></li>
                <li><a href="/#matches" class="navbar-link">Matchs</a></li>
                <li><a href="/candidature" class="navbar-link">Candidature</a></li>
            </ul>
            <div class="navbar-actions">
                <button class="theme-toggle" onclick="toggleTheme()">
                    <span class="theme-icon">🌙</span>
                </button>
                <a href="/panel/login" class="btn btn-primary">Connexion</a>
            </div>
        </div>
    </nav>

    ${content}

    <footer class="footer">
        <div class="container">
            <div class="footer-content">
                <div class="footer-section">
                    <h3>FTY Club Pro</h3>
                    <p style="color: var(--text-secondary); margin-top: 1rem;">
                        Le club e-sport de référence pour FC26. Excellence, professionnalisme et passion.
                    </p>
                </div>
                <div class="footer-section">
                    <h3>Navigation</h3>
                    <ul class="footer-links">
                        <li><a href="/">Accueil</a></li>
                        <li><a href="/#histoire">Histoire</a></li>
                        <li><a href="/#stade">Stade</a></li>
                        <li><a href="/candidature">Candidature</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3>Connexion</h3>
                    <ul class="footer-links">
                        <li><a href="/panel/login">Panel</a></li>
                        <li><a href="/auth/discord">Discord OAuth</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3>Contact</h3>
                    <p style="color: var(--text-secondary); margin-top: 1rem;">
                        Fondateurs: xywez & Tom<br>
                        Discord: FTY Club Official
                    </p>
                </div>
            </div>
            <div class="footer-bottom">
                © 2026 FTY Club Pro - Tous droits réservés · Créé avec ❤️ par xywez
            </div>
        </div>
    </footer>

    <script>
        // Theme management
        function toggleTheme() {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
            
            // Update user preference if logged in
            fetch('/api/update-theme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: newTheme })
            }).catch(() => {});
        }

        function updateThemeIcon(theme) {
            const icon = document.querySelector('.theme-icon');
            icon.textContent = theme === 'dark' ? '🌙' : '☀️';
        }

        // Load saved theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    </script>
</body>
</html>`;
}

// ============ PAGE D'ACCUEIL ============
app.get('/', (req, res) => {
    const db = readDB();
    const theme = req.session.user?.theme || 'dark';
    
    const content = `
    <div class="hero">
        <div class="hero-bg"></div>
        <div class="hero-content">
            <h1 class="hero-title">FTY CLUB PRO</h1>
            <p class="hero-subtitle">Le club e-sport qui repousse les limites de FC26</p>
            <div class="hero-actions">
                <a href="/candidature" class="btn btn-primary btn-lg">Rejoindre le Club</a>
                <a href="/#matches" class="btn btn-outline btn-lg">Voir les Matchs</a>
            </div>
        </div>
    </div>

    <div class="section" id="stats">
        <div class="container">
            <div class="grid-4">
                <div class="card text-center">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">🏆</div>
                    <div style="font-size: 2.5rem; font-weight: 900; color: var(--primary); margin-bottom: 0.5rem;">${db.stats.wins}</div>
                    <div style="color: var(--text-secondary);">Victoires</div>
                </div>
                <div class="card text-center">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">⚽</div>
                    <div style="font-size: 2.5rem; font-weight: 900; color: var(--secondary); margin-bottom: 0.5rem;">${db.stats.goals}</div>
                    <div style="color: var(--text-secondary);">Buts Marqués</div>
                </div>
                <div class="card text-center">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">📊</div>
                    <div style="font-size: 2.5rem; font-weight: 900; color: var(--success); margin-bottom: 0.5rem;">${db.stats.winRate}%</div>
                    <div style="color: var(--text-secondary);">Taux de Victoire</div>
                </div>
                <div class="card text-center">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">🛡️</div>
                    <div style="font-size: 2.5rem; font-weight: 900; color: var(--warning); margin-bottom: 0.5rem;">${db.stats.goalsAgainst}</div>
                    <div style="color: var(--text-secondary);">Buts Encaissés</div>
                </div>
            </div>
        </div>
    </div>

    <div class="section" id="histoire">
        <div class="container">
            <div class="section-header">
                <h2 class="section-title">Notre Histoire</h2>
                <p class="section-subtitle">L'évolution d'un club d'exception</p>
            </div>
            <div class="timeline">
                ${CLUB_HISTORY.map((item, index) => `
                <div class="timeline-item">
                    <div class="timeline-year">
                        <div style="font-size: 2.5rem; font-weight: 900;">${item.year}</div>
                        <div style="font-size: 1rem; color: var(--text-muted); margin-top: -0.5rem;">${item.month}</div>
                    </div>
                    <div class="timeline-content">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">${item.image}</div>
                        <h3>${item.title}</h3>
                        <p style="color: var(--text-secondary); margin-top: 0.75rem;">${item.description}</p>
                        ${item.stats ? `
                        <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; font-size: 0.875rem; color: var(--text-muted); border-left: 3px solid var(--primary);">
                            📊 ${item.stats}
                        </div>
                        ` : ''}
                    </div>
                    <div class="timeline-dot"></div>
                </div>
                `).join('')}
            </div>
        </div>
    </div>

    <div class="section" id="tactique" style="background: var(--bg-secondary);">
        <div class="container">
            <div class="section-header">
                <h2 class="section-title">Notre Tactique</h2>
                <p class="section-subtitle">Formation 4-3-3 - Possession Offensive</p>
            </div>
            
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem;">
                <!-- Terrain tactique -->
                <div style="background: linear-gradient(180deg, #1a5c3a 0%, #2a7c4f 50%, #1a5c3a 100%); border-radius: 16px; padding: 3rem 2rem; position: relative; min-height: 650px; border: 3px solid #0a3d25; box-shadow: inset 0 0 80px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.3);">
                    
                    <!-- Lignes du terrain -->
                    <div style="position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: rgba(255,255,255,0.4);"></div>
                    <div style="position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: rgba(255,255,255,0.4);"></div>
                    <div style="position: absolute; top: 50%; left: 50%; width: 120px; height: 120px; border: 2px solid rgba(255,255,255,0.4); border-radius: 50%; transform: translate(-50%, -50%);"></div>
                    <div style="position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; background: white; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 10px rgba(255,255,255,0.8);"></div>
                    
                    <!-- Zone d'en-but -->
                    <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 200px; height: 60px; border: 2px solid rgba(255,255,255,0.4); border-top: none;"></div>
                    <div style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 200px; height: 60px; border: 2px solid rgba(255,255,255,0.4); border-bottom: none;"></div>
                    
                    <!-- Joueurs - Gardien -->
                    <div style="position: absolute; bottom: 3%; left: 50%; transform: translateX(-50%);">
                        <div style="width: 50px; height: 50px; background: linear-gradient(135deg, var(--primary), var(--primary-dark)); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.2rem; box-shadow: 0 4px 12px var(--primary-glow), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                            1
                        </div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.75rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">GB</div>
                    </div>
                    
                    <!-- Défense -->
                    <div style="position: absolute; bottom: 22%; left: 15%;">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--secondary), #0099cc); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px var(--secondary-glow), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">3</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">DG</div>
                    </div>
                    <div style="position: absolute; bottom: 25%; left: 35%;">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--secondary), #0099cc); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px var(--secondary-glow), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">4</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">DC</div>
                    </div>
                    <div style="position: absolute; bottom: 25%; right: 35%;">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--secondary), #0099cc); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px var(--secondary-glow), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">5</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">DC</div>
                    </div>
                    <div style="position: absolute; bottom: 22%; right: 15%;">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--secondary), #0099cc); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px var(--secondary-glow), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">2</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">DD</div>
                    </div>
                    
                    <!-- Milieu -->
                    <div style="position: absolute; bottom: 45%; left: 25%;">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--success), #00cc6a); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(0,255,136,0.5), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">8</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">MC</div>
                    </div>
                    <div style="position: absolute; bottom: 47%; left: 50%; transform: translateX(-50%);">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--success), #00cc6a); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(0,255,136,0.5), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">6</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">MDC</div>
                    </div>
                    <div style="position: absolute; bottom: 45%; right: 25%;">
                        <div style="width: 45px; height: 45px; background: linear-gradient(135deg, var(--success), #00cc6a); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(0,255,136,0.5), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">11</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">MC</div>
                    </div>
                    
                    <!-- Attaque -->
                    <div style="position: absolute; top: 25%; left: 15%;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, var(--warning), #dd8800); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.2rem; box-shadow: 0 4px 16px rgba(255,170,0,0.6), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">7</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">AG</div>
                    </div>
                    <div style="position: absolute; top: 15%; left: 50%; transform: translateX(-50%);">
                        <div style="width: 50px; height: 50px; background: linear-gradient(135deg, var(--warning), #dd8800); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.3rem; box-shadow: 0 4px 20px rgba(255,170,0,0.7), 0 0 0 4px rgba(255,255,255,0.4); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">9</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.75rem; font-weight: 700; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">BU</div>
                    </div>
                    <div style="position: absolute; top: 25%; right: 15%;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, var(--warning), #dd8800); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: white; font-size: 1.2rem; box-shadow: 0 4px 16px rgba(255,170,0,0.6), 0 0 0 3px rgba(255,255,255,0.3); cursor: pointer; transition: var(--transition);" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">10</div>
                        <div style="text-align: center; margin-top: 0.5rem; font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">AD</div>
                    </div>
                </div>
                
                <!-- Instructions tactiques -->
                <div>
                    <div class="card" style="margin-bottom: 1.5rem;">
                        <h3 style="margin-bottom: 1rem; font-size: 1.25rem; color: var(--primary);">⚙️ Formation</h3>
                        <div style="display: grid; gap: 0.75rem; font-size: 0.9rem;">
                            <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; border-left: 3px solid var(--primary);">
                                <strong>Type:</strong> 4-3-3
                            </div>
                            <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; border-left: 3px solid var(--secondary);">
                                <strong>Style:</strong> Possession Offensive
                            </div>
                            <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; border-left: 3px solid var(--success);">
                                <strong>Mentalité:</strong> Attaque
                            </div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3 style="margin-bottom: 1rem; font-size: 1.25rem; color: var(--success);">📋 Instructions</h3>
                        <ul style="list-style: none; padding: 0; display: grid; gap: 0.75rem;">
                            <li style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: start; gap: 0.75rem; font-size: 0.875rem;">
                                <span style="color: var(--primary); font-size: 1.2rem;">⚡</span>
                                <span>Pressing intense dès la perte du ballon</span>
                            </li>
                            <li style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: start; gap: 0.75rem; font-size: 0.875rem;">
                                <span style="color: var(--secondary); font-size: 1.2rem;">🎯</span>
                                <span>Jeu court en phase de construction</span>
                            </li>
                            <li style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: start; gap: 0.75rem; font-size: 0.875rem;">
                                <span style="color: var(--success); font-size: 1.2rem;">↔️</span>
                                <span>Utilisation des couloirs avec les ailiers</span>
                            </li>
                            <li style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: start; gap: 0.75rem; font-size: 0.875rem;">
                                <span style="color: var(--warning); font-size: 1.2rem;">🔄</span>
                                <span>Buteur en pivot pour combiner</span>
                            </li>
                            <li style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: start; gap: 0.75rem; font-size: 0.875rem;">
                                <span style="color: var(--primary); font-size: 1.2rem;">↗️</span>
                                <span>Montées des latéraux en surnombre</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="section" id="matches">
        <div class="container">
            <div class="section-header">
                <h2 class="section-title">Prochains Matchs</h2>
                <p class="section-subtitle">Suivez nos rencontres en direct</p>
            </div>
            <div class="grid-2">
                ${db.matches.filter(m => m.status === 'scheduled').map(match => `
                <div class="card">
                    <div class="card-header">
                        <span class="badge" style="background: var(--primary); color: white;">${match.competition}</span>
                        <span style="color: var(--text-muted); font-size: 0.9rem;">${match.date}</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 0;">
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚽</div>
                            <div style="font-weight: 700; font-size: 1.25rem;">FTY</div>
                        </div>
                        <div style="font-size: 1.5rem; font-weight: 900; color: var(--text-muted);">VS</div>
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎮</div>
                            <div style="font-weight: 700; font-size: 1.25rem;">${match.adversaire}</div>
                        </div>
                    </div>
                    <div style="text-align: center; color: var(--text-muted); font-size: 0.9rem;">
                        📍 ${match.stadium}
                    </div>
                </div>
                `).join('')}
            </div>
        </div>
    </div>

    <div class="section" style="background: var(--bg-secondary);">
        <div class="container">
            <div class="section-header">
                <h2 class="section-title">Derniers Communiqués</h2>
            </div>
            <div class="grid-2">
                ${db.communiques.slice(0, 4).map(comm => `
                <div class="card">
                    <h3 style="margin-bottom: 0.75rem;">${comm.title}</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 1rem;">${comm.content}</p>
                    <div style="display: flex; justify-content: space-between; font-size: 0.875rem; color: var(--text-muted);">
                        <span>Par ${comm.author}</span>
                        <span>${comm.date}</span>
                    </div>
                </div>
                `).join('')}
            </div>
        </div>
    </div>
    `;
    
    res.send(publicLayout('Accueil', content, theme));
});

// ============ PAGE CANDIDATURE ============
app.get('/candidature', (req, res) => {
    const theme = req.session.user?.theme || 'dark';
    
    const content = `
    <div style="padding-top: 120px; min-height: 100vh;">
        <div class="container" style="max-width: 700px;">
            <div style="text-align: center; margin-bottom: 3rem;">
                <h1 class="display-2" style="margin-bottom: 1rem;">Rejoindre FTY Club</h1>
                <p class="text-secondary" style="font-size: 1.25rem;">
                    Prêt à faire partie de l'élite ? Remplis ta candidature.
                </p>
            </div>
            
            ${req.query.success ? `
            <div class="alert alert-success text-center">
                ✅ Candidature envoyée ! Connecte-toi au panel pour suivre son statut.
            </div>
            ` : ''}
            
            <div class="card">
                <form action="/candidature" method="POST">
                    <div class="form-group">
                        <label class="form-label">Nom / Pseudo *</label>
                        <input type="text" name="name" class="form-control" required placeholder="Ton pseudo en jeu">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Position souhaitée *</label>
                        <select name="position" class="form-control" required>
                            <option value="">-- Sélectionne --</option>
                            <option value="Gardien">Gardien</option>
                            <option value="Défenseur">Défenseur</option>
                            <option value="Milieu">Milieu</option>
                            <option value="Attaquant">Attaquant</option>
                            <option value="Staff">Staff / Manager</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">ID Discord *</label>
                        <input type="text" name="discordId" class="form-control" required placeholder="Ex: 123456789012345678">
                        <small class="text-muted" style="display: block; margin-top: 0.5rem;">
                            Copie ton ID Discord (clique droit sur ton profil → Copier l'identifiant)
                        </small>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Expérience FC *</label>
                        <textarea name="experience" class="form-control" required placeholder="Parle-nous de ton expérience sur FC (années jouées, niveau, clubs précédents...)"></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Motivation *</label>
                        <textarea name="motivation" class="form-control" required placeholder="Pourquoi veux-tu rejoindre FTY Club ?"></textarea>
                    </div>
                    
                    <button type="submit" class="btn btn-primary btn-full btn-lg">
                        🚀 Envoyer ma Candidature
                    </button>
                </form>
            </div>
            
            <div class="text-center mt-32">
                <p class="text-muted">
                    Déjà membre ? <a href="/panel/login" style="color: var(--primary);">Connecte-toi au panel</a>
                </p>
            </div>
        </div>
    </div>
    `;
    
    res.send(publicLayout('Candidature', content, theme));
});

app.post('/candidature', (req, res) => {
    const db = readDB();
    if (!db.candidatures) db.candidatures = [];
    
    const candidature = {
        id: Date.now().toString(),
        name: req.body.name || 'Anonyme',
        position: req.body.position || 'Non précisé',
        discordId: req.body.discordId || '',
        motivation: req.body.motivation || '',
        experience: req.body.experience || '',
        date: new Date().toISOString(),
        status: 'pending',
        requiresLogin: true
    };
    
    db.candidatures.unshift(candidature);
    writeDB(db);
    addLog('Nouvelle candidature', req.body.name || 'Anonyme', req.body.position || '?', {});
    
    res.redirect('/candidature?success=1');
});

// ============ DISCORD OAUTH ============
app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify email'
    });
    
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    
    if (!code) {
        return res.redirect('/panel/login?error=' + encodeURIComponent('Code OAuth manquant'));
    }
    
    try {
        // Exchange code for token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: DISCORD_REDIRECT_URI
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        const { access_token } = tokenResponse.data;
        
        // Get user info
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        });
        
        const discordUser = userResponse.data;
        const db = readDB();
        
        // Find user by Discord ID
        let user = db.users.find(u => u.discordId === discordUser.id);
        
        if (!user) {
            return res.redirect('/panel/login?error=' + encodeURIComponent('Aucun compte lié à ce Discord. Contacte un admin.'));
        }
        
        // Update Discord info
        user.discordUsername = `${discordUser.username}#${discordUser.discriminator}`;
        user.discordAvatar = discordUser.avatar;
        user.lastLogin = new Date().toISOString();
        
        const clientIP = getClientIP(req);
        if (!user.ip.includes(clientIP)) user.ip.push(clientIP);
        
        writeDB(db);
        addLog('Connexion Discord OAuth', user.username, user.accountType, { discordId: discordUser.id }, clientIP);
        
        // Create session
        req.session.user = {
            username: user.username,
            accountType: user.accountType,
            theme: user.theme || 'dark'
        };
        
        res.redirect('/panel/dashboard');
        
    } catch (error) {
        console.error('Discord OAuth Error:', error);
        res.redirect('/panel/login?error=' + encodeURIComponent('Erreur OAuth Discord'));
    }
});

// ============ API UPDATE THEME ============
app.post('/api/update-theme', (req, res) => {
    if (!req.session.user) return res.json({ success: false });
    
    const db = readDB();
    const user = db.users.find(u => u.username === req.session.user.username);
    
    if (user) {
        user.theme = req.body.theme;
        req.session.user.theme = req.body.theme;
        writeDB(db);
    }
    
    res.json({ success: true });
});

// ============ PANEL LOGIN ============
function errorPage(title, message) {
    return `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - FTY Club</title>
    <style>${GLOBAL_CSS}</style>
</head>
<body style="display: flex; align-items: center; justify-content: center; min-height: 100vh;">
    <div style="text-align: center; max-width: 500px; padding: 2rem;">
        <h1 style="font-size: 3rem; margin-bottom: 1rem;">⛔</h1>
        <h2 style="margin-bottom: 1rem;">${title}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 2rem;">${message}</p>
        <a href="/panel/dashboard" class="btn btn-primary">← Retour au Panel</a>
    </div>
</body>
</html>`;
}

app.get('/panel/login', (req, res) => {
    if (req.session.user) return res.redirect('/panel/dashboard');
    
    const error = req.query.error;
    const msg = req.query.msg;
    
    const html = `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connexion - FTY Club Pro</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>⚽</text></svg>">
    <style>${GLOBAL_CSS}</style>
    <style>
        .login-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            position: relative;
            overflow: hidden;
        }
        
        .login-bg {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(circle at 30% 50%, var(--primary-glow) 0%, transparent 50%),
                radial-gradient(circle at 70% 50%, var(--secondary-glow) 0%, transparent 50%);
            opacity: 0.2;
        }
        
        .login-card {
            position: relative;
            z-index: 1;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 3rem;
            max-width: 450px;
            width: 100%;
            backdrop-filter: blur(20px);
            box-shadow: var(--shadow-xl);
        }
        
        .login-header {
            text-align: center;
            margin-bottom: 2rem;
        }
        
        .login-logo {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        
        .login-title {
            font-size: 2rem;
            font-weight: 900;
            font-family: var(--font-display);
            margin-bottom: 0.5rem;
        }
        
        .login-subtitle {
            color: var(--text-secondary);
        }
        
        .divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 2rem 0;
        }
        
        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid var(--border);
        }
        
        .divider span {
            padding: 0 1rem;
            color: var(--text-muted);
            font-size: 0.875rem;
        }
        
        .oauth-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            width: 100%;
            padding: 1rem;
            background: #5865F2;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            text-decoration: none;
        }
        
        .oauth-btn:hover {
            background: #4752C4;
            transform: translateY(-2px);
            box-shadow: 0 6px 24px rgba(88, 101, 242, 0.4);
        }
        
        .oauth-icon {
            width: 24px;
            height: 24px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-bg"></div>
        <div class="login-card">
            <div class="login-header">
                <div class="login-logo">⚽</div>
                <h1 class="login-title">FTY CLUB</h1>
                <p class="login-subtitle">Panel d'Administration Pro</p>
            </div>
            
            ${error ? `<div class="alert alert-danger">${decodeURIComponent(error)}</div>` : ''}
            ${msg ? `<div class="alert alert-info">${decodeURIComponent(msg)}</div>` : ''}
            
            <form action="/panel/login" method="POST">
                <div class="form-group">
                    <label class="form-label">Identifiant</label>
                    <input type="text" name="username" class="form-control" required autofocus>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Mot de passe</label>
                    <input type="password" name="password" class="form-control" required>
                </div>
                
                <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; font-size: 0.875rem;">
                    <a href="/panel/forgot-username" style="color: var(--text-secondary); text-decoration: none; transition: var(--transition);" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-secondary)'">
                        🔍 Identifiant oublié ?
                    </a>
                    <span style="color: var(--border);">·</span>
                    <a href="/panel/forgot-password" style="color: var(--text-secondary); text-decoration: none; transition: var(--transition);" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-secondary)'">
                        🔑 Mot de passe oublié ?
                    </a>
                </div>
                
                <button type="submit" class="btn btn-primary btn-full btn-lg">
                    🔐 Se Connecter
                </button>
            </form>
            
            <div class="text-center mt-24">
                <a href="/" style="color: var(--text-muted); text-decoration: none; font-size: 0.9rem;">
                    ← Retour au site
                </a>
            </div>
        </div>
    </div>
</body>
</html>`;
    
    res.send(html);
});

app.post('/panel/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    
    if (!user || !comparePassword(password, user.password)) {
        return res.redirect('/panel/login?error=' + encodeURIComponent('Identifiants incorrects'));
    }
    
    if (user.banned) {
        return res.redirect('/panel/login?error=' + encodeURIComponent('Compte banni'));
    }
    
    if (user.suspended) {
        return res.redirect('/panel/login?error=' + encodeURIComponent('Compte suspendu'));
    }
    
    const clientIP = getClientIP(req);
    user.lastLogin = new Date().toISOString();
    if (!user.ip.includes(clientIP)) user.ip.push(clientIP);
    
    writeDB(db);
    addLog('Connexion classique', username, user.accountType, {}, clientIP);
    
    req.session.user = {
        username: user.username,
        accountType: user.accountType,
        theme: user.theme || 'dark'
    };
    
    res.redirect(user.mustChangePassword ? '/panel/change-password' : '/panel/dashboard');
});

// ============ FORGOT USERNAME ============
app.get('/panel/forgot-username', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Identifiant oublié - FTY Club</title>
    <style>${GLOBAL_CSS}</style>
    <style>
        .recovery-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            background: 
                radial-gradient(circle at 30% 50%, var(--primary-glow) 0%, transparent 50%),
                radial-gradient(circle at 70% 50%, var(--secondary-glow) 0%, transparent 50%);
        }
        .recovery-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 3rem;
            max-width: 500px;
            width: 100%;
            backdrop-filter: blur(20px);
            box-shadow: var(--shadow-xl);
        }
        .icon-container {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, var(--secondary) 0%, var(--primary) 100%);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.5rem;
        }
    </style>
</head>
<body>
    <div class="recovery-container">
        <div class="recovery-card">
            <div style="text-align: center; margin-bottom: 2rem;">
                <div class="icon-container">🔍</div>
                <h1 style="font-size: 2rem; font-weight: 900; margin-bottom: 0.5rem; font-family: var(--font-display);">Identifiant oublié ?</h1>
                <p style="color: var(--text-secondary);">Entrez votre Discord ID pour retrouver votre identifiant</p>
            </div>
            
            ${req.query.error ? `<div class="alert alert-danger">${decodeURIComponent(req.query.error)}</div>` : ''}
            ${req.query.success ? `<div class="alert alert-success" style="font-size: 1.1rem; text-align: center;"><strong>Votre identifiant est:</strong><br><span style="font-size: 1.5rem; color: var(--primary); font-weight: 900; font-family: var(--font-display);">${req.query.username || ''}</span></div>` : ''}
            
            <form action="/panel/forgot-username" method="POST">
                <div class="form-group">
                    <label class="form-label">Discord ID</label>
                    <input type="text" name="discordId" class="form-control" required placeholder="123456789012345678" pattern="[0-9]{17,19}">
                    <small class="text-muted" style="display: block; margin-top: 0.5rem;">
                        Votre ID Discord à 18 chiffres
                    </small>
                </div>
                
                <button type="submit" class="btn btn-primary btn-full btn-lg" style="margin-bottom: 1rem;">
                    🔍 Rechercher
                </button>
            </form>
            
            <div class="divider"><span>OU</span></div>
            
            <a href="/auth/discord?action=forgot-username" class="btn btn-full" style="background: #5865F2; color: white; display: flex; align-items: center; justify-content: center; gap: 0.75rem;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                Rechercher avec Discord
            </a>
            
            <div class="text-center mt-24">
                <a href="/panel/login" style="color: var(--text-muted); text-decoration: none;">
                    ← Retour à la connexion
                </a>
            </div>
        </div>
    </div>
</body>
</html>`;
    res.send(html);
});

app.post('/panel/forgot-username', (req, res) => {
    const { discordId } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.discordId === discordId);
    
    if (!user) {
        return res.redirect('/panel/forgot-username?error=' + encodeURIComponent('Aucun compte trouvé avec ce Discord ID'));
    }
    
    res.redirect('/panel/forgot-username?success=1&username=' + encodeURIComponent(user.username));
});

// ============ FORGOT PASSWORD ============
app.get('/panel/forgot-password', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mot de passe oublié - FTY Club</title>
    <style>${GLOBAL_CSS}</style>
    <style>
        .recovery-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            background: 
                radial-gradient(circle at 30% 50%, var(--primary-glow) 0%, transparent 50%),
                radial-gradient(circle at 70% 50%, var(--secondary-glow) 0%, transparent 50%);
        }
        .recovery-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 3rem;
            max-width: 550px;
            width: 100%;
            backdrop-filter: blur(20px);
            box-shadow: var(--shadow-xl);
        }
        .icon-container {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, var(--warning) 0%, var(--primary) 100%);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.5rem;
        }
    </style>
</head>
<body>
    <div class="recovery-container">
        <div class="recovery-card">
            <div style="text-align: center; margin-bottom: 2rem;">
                <div class="icon-container">🔑</div>
                <h1 style="font-size: 2rem; font-weight: 900; margin-bottom: 0.5rem; font-family: var(--font-display);">Mot de passe oublié ?</h1>
                <p style="color: var(--text-secondary);">Connectez-vous avec Discord ou contactez un administrateur</p>
            </div>
            
            <a href="/auth/discord" class="btn btn-full btn-lg" style="background: #5865F2; color: white; display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin-bottom: 1.5rem;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                Se connecter avec Discord
            </a>
            
            <div class="divider"><span>OU</span></div>
            
            <div class="alert alert-info">
                <h3 style="margin-bottom: 0.75rem; font-size: 1.1rem;">📞 Demande de réinitialisation</h3>
                <p style="margin-bottom: 0.75rem;">Pour réinitialiser votre mot de passe, contactez un administrateur:</p>
                <ul style="padding-left: 1.5rem; margin-bottom: 0;">
                    <li><strong>xywez</strong> (Owner)</li>
                    <li>Discord: <strong>FTY Club Official</strong></li>
                </ul>
            </div>
            
            <div style="padding: 1.5rem; background: var(--bg-tertiary); border-radius: 8px; margin-top: 1.5rem; border: 1px solid var(--border);">
                <h3 style="margin-bottom: 1rem; font-size: 1rem; color: var(--text-secondary);">📋 Informations à fournir:</h3>
                <ul style="color: var(--text-secondary); padding-left: 1.5rem; font-size: 0.95rem;">
                    <li>Votre identifiant</li>
                    <li>Votre Discord ID</li>
                    <li>Raison de la réinitialisation</li>
                </ul>
            </div>
            
            <div class="text-center mt-24">
                <a href="/panel/login" class="btn btn-outline btn-full">
                    ← Retour à la connexion
                </a>
            </div>
        </div>
    </div>
</body>
</html>`;
    res.send(html);
});

// ============ PANEL LAYOUT ============
function panelLayout(user, title, content, active = '') {
    const theme = user.theme || 'dark';
    
    return `<!DOCTYPE html>
<html lang="fr" data-theme="${theme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Panel FTY</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>⚽</text></svg>">
    <style>${GLOBAL_CSS}</style>
    <style>
        .panel-wrapper {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 280px;
            background: var(--bg-secondary);
            border-right: 1px solid var(--border);
            padding: 2rem 0;
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            overflow-y: auto;
        }
        
        .sidebar-brand {
            padding: 0 1.5rem 2rem;
            border-bottom: 1px solid var(--border);
            margin-bottom: 2rem;
        }
        
        .sidebar-logo {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        
        .sidebar-title {
            font-family: var(--font-display);
            font-size: 1.5rem;
            font-weight: 900;
        }
        
        .sidebar-user {
            padding: 0 1.5rem;
            margin-bottom: 2rem;
        }
        
        .sidebar-user-info {
            background: var(--bg-tertiary);
            padding: 1rem;
            border-radius: 8px;
            border: 1px solid var(--border);
        }
        
        .sidebar-user-name {
            font-weight: 600;
            margin-bottom: 0.25rem;
        }
        
        .sidebar-user-role {
            font-size: 0.875rem;
            color: var(--text-muted);
        }
        
        .sidebar-menu {
            list-style: none;
        }
        
        .sidebar-item {
            margin-bottom: 0.25rem;
        }
        
        .sidebar-link {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.875rem 1.5rem;
            color: var(--text-secondary);
            text-decoration: none;
            transition: var(--transition);
            border-left: 3px solid transparent;
        }
        
        .sidebar-link:hover {
            background: var(--bg-card-hover);
            color: var(--text-primary);
        }
        
        .sidebar-link.active {
            background: var(--bg-card-hover);
            color: var(--primary);
            border-left-color: var(--primary);
        }
        
        .sidebar-icon {
            font-size: 1.25rem;
            width: 24px;
            text-align: center;
        }
        
        .main-content {
            flex: 1;
            margin-left: 280px;
            padding: 2rem;
        }
        
        .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 2rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid var(--border);
        }
        
        .page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 2rem;
        }
        
        .page-title {
            font-size: 2rem;
            font-weight: 900;
            font-family: var(--font-display);
        }
        
        .page-title span {
            color: var(--primary);
        }
        
        .page-breadcrumb {
            color: var(--text-muted);
            font-size: 0.9rem;
            margin-top: 0.25rem;
        }
        
        .topbar-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        @media (max-width: 1024px) {
            .sidebar {
                width: 70px;
            }
            .main-content {
                margin-left: 70px;
            }
            .sidebar-link span {
                display: none;
            }
            .sidebar-brand,
            .sidebar-user {
                display: none;
            }
        }
    </style>
</head>
<body>
    <div class="panel-wrapper">
        <aside class="sidebar">
            <div class="sidebar-brand">
                <div class="sidebar-logo">⚽</div>
                <div class="sidebar-title">FTY PANEL</div>
            </div>
            
            <div class="sidebar-user">
                <div class="sidebar-user-info">
                    <div class="sidebar-user-name">${user.username}</div>
                    <div class="sidebar-user-role">${ROLE_LABELS[user.accountType]}</div>
                </div>
            </div>
            
            <ul class="sidebar-menu">
                <li class="sidebar-item">
                    <a href="/panel/dashboard" class="sidebar-link ${active === 'dashboard' ? 'active' : ''}">
                        <span class="sidebar-icon">🏠</span>
                        <span>Dashboard</span>
                    </a>
                </li>
                ${HIERARCHY[user.accountType] >= HIERARCHY['capitaine'] ? `
                <li class="sidebar-item">
                    <a href="/panel/users" class="sidebar-link ${active === 'users' ? 'active' : ''}">
                        <span class="sidebar-icon">👥</span>
                        <span>Membres</span>
                    </a>
                </li>
                ` : ''}
                ${HIERARCHY[user.accountType] >= HIERARCHY['manager'] ? `
                <li class="sidebar-item">
                    <a href="/panel/matches" class="sidebar-link ${active === 'matches' ? 'active' : ''}">
                        <span class="sidebar-icon">⚽</span>
                        <span>Matchs</span>
                    </a>
                </li>
                <li class="sidebar-item">
                    <a href="/panel/candidatures" class="sidebar-link ${active === 'candidatures' ? 'active' : ''}">
                        <span class="sidebar-icon">📝</span>
                        <span>Candidatures</span>
                    </a>
                </li>
                ` : ''}
                ${HIERARCHY[user.accountType] >= HIERARCHY['administrateur'] ? `
                <li class="sidebar-item">
                    <a href="/panel/logs" class="sidebar-link ${active === 'logs' ? 'active' : ''}">
                        <span class="sidebar-icon">📋</span>
                        <span>Logs</span>
                    </a>
                </li>
                ` : ''}
                ${HIERARCHY[user.accountType] >= HIERARCHY['owner'] ? `
                <li class="sidebar-item">
                    <a href="/panel/system" class="sidebar-link ${active === 'system' ? 'active' : ''}">
                        <span class="sidebar-icon">⚙️</span>
                        <span>Système</span>
                    </a>
                </li>
                <li class="sidebar-item">
                    <a href="/panel/bot-config" class="sidebar-link ${active === 'bot' ? 'active' : ''}">
                        <span class="sidebar-icon">🤖</span>
                        <span>Bot Discord</span>
                    </a>
                </li>
                ` : ''}
                <li class="sidebar-item">
                    <a href="/panel/profile" class="sidebar-link ${active === 'profile' ? 'active' : ''}">
                        <span class="sidebar-icon">👤</span>
                        <span>Profil</span>
                    </a>
                </li>
                <li class="sidebar-item">
                    <a href="/panel/logout" class="sidebar-link">
                        <span class="sidebar-icon">🚪</span>
                        <span>Déconnexion</span>
                    </a>
                </li>
            </ul>
        </aside>
        
        <main class="main-content">
            <div class="topbar">
                <div>
                    <h1 class="page-title">${title}</h1>
                </div>
                <div class="topbar-actions">
                    <button class="theme-toggle" onclick="toggleTheme()">
                        <span class="theme-icon">🌙</span>
                    </button>
                    <a href="/" class="btn btn-outline btn-sm" target="_blank">
                        🌐 Site Public
                    </a>
                </div>
            </div>
            
            ${content}
        </main>
    </div>
    
    <script>
        function toggleTheme() {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
            
            fetch('/api/update-theme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: newTheme })
            });
        }

        function updateThemeIcon(theme) {
            const icon = document.querySelector('.theme-icon');
            icon.textContent = theme === 'dark' ? '🌙' : '☀️';
        }

        updateThemeIcon('${theme}');
    </script>
</body>
</html>`;
}

// ============ PANEL DASHBOARD ============
app.get('/panel/dashboard', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const content = `
    <div class="grid-4">
        <div class="card text-center">
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">👥</div>
            <div style="font-size: 2rem; font-weight: 900; color: var(--primary); margin-bottom: 0.5rem;">${db.users.length}</div>
            <div style="color: var(--text-secondary);">Membres</div>
        </div>
        <div class="card text-center">
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">⚽</div>
            <div style="font-size: 2rem; font-weight: 900; color: var(--secondary); margin-bottom: 0.5rem;">${db.matches.length}</div>
            <div style="color: var(--text-secondary);">Matchs</div>
        </div>
        <div class="card text-center">
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">🏆</div>
            <div style="font-size: 2rem; font-weight: 900; color: var(--success); margin-bottom: 0.5rem;">${db.stats.wins}</div>
            <div style="color: var(--text-secondary);">Victoires</div>
        </div>
        <div class="card text-center">
            <div style="font-size: 3rem; margin-bottom: 0.5rem;">📝</div>
            <div style="font-size: 2rem; font-weight: 900; color: var(--warning); margin-bottom: 0.5rem;">${(db.candidatures || []).filter(c => c.status === 'pending').length}</div>
            <div style="color: var(--text-secondary);">Candidatures</div>
        </div>
    </div>
    
    <div class="grid-2 mt-32">
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">📋 Derniers Logs</h2>
            </div>
            ${(db.logs || []).slice(0, 5).map(log => `
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
                    <div style="font-weight: 600;">${log.action}</div>
                    <div style="font-size: 0.875rem; color: var(--text-muted);">
                        ${log.executor} → ${log.target} · ${new Date(log.timestamp).toLocaleString('fr')}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🎮 Prochains Matchs</h2>
            </div>
            ${db.matches.filter(m => m.status === 'scheduled').slice(0, 3).map(match => `
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
                    <div style="font-weight: 600;">FTY vs ${match.adversaire}</div>
                    <div style="font-size: 0.875rem; color: var(--text-muted);">
                        ${match.date} · ${match.competition}
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Dashboard', content, 'dashboard'));
});

// ============ BOT CONFIG (OWNER ONLY) ============
app.get('/panel/bot-config', isAuthenticated, hasRole('owner'), (req, res) => {
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Configuration <span>Bot Discord</span></div>
            <div class="page-breadcrumb">Panel · Système · Bot Discord</div>
        </div>
    </div>
    
    <div class="grid-2">
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🤖 Informations Bot</h2>
            </div>
            <p class="text-secondary mb-16">
                Le bot Discord FTY est synchronisé avec la base de données du panel.
            </p>
            <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">Fichier:</div>
                <code style="color: var(--primary);">bot-simplifie.js</code>
            </div>
            <div style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px;">
                <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">Base de données:</div>
                <code style="color: var(--success);">database.json (partagée)</code>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">⚙️ Configuration</h2>
            </div>
            <p class="text-secondary mb-16">
                Créez un fichier <code>config.json</code> avec:
            </p>
            <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem;">
{
  "token": "VOTRE_BOT_TOKEN",
  "panelUrl": "http://localhost:3000/panel"
}</pre>
        </div>
        
        <div class="card" style="grid-column: 1 / -1;">
            <div class="card-header">
                <h2 class="card-title">🚀 Démarrage</h2>
            </div>
            <div class="grid-2">
                <div>
                    <h3 style="margin-bottom: 0.75rem;">1. Installation</h3>
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; font-size: 0.875rem;">npm install discord.js</pre>
                </div>
                <div>
                    <h3 style="margin-bottom: 0.75rem;">2. Lancement</h3>
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; font-size: 0.875rem;">node bot-simplifie.js</pre>
                </div>
            </div>
        </div>
        
        <div class="card" style="grid-column: 1 / -1;">
            <div class="card-header">
                <h2 class="card-title">📝 Fonctionnalités</h2>
            </div>
            <div class="grid-3">
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <h4 style="margin-bottom: 0.5rem;">✅ Modération</h4>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Warn, kick, ban avec logs</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <h4 style="margin-bottom: 0.5rem;">🎫 Tickets</h4>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Système de support automatisé</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <h4 style="margin-bottom: 0.5rem;">⚽ Matchs</h4>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Annonces de matchs</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <h4 style="margin-bottom: 0.5rem;">📊 Stats</h4>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Statistiques du serveur</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <h4 style="margin-bottom: 0.5rem;">🛡️ Protection</h4>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Anti-spam, anti-link</p>
                </div>
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <h4 style="margin-bottom: 0.5rem;">🎛️ Panel</h4>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Commande /panel pour accès</p>
                </div>
            </div>
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Bot Discord', content, 'bot'));
});

// ============ AUTRES ROUTES DU PANEL (simplifiées pour la longueur) ============
app.get('/panel/users', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Gestion des <span>Membres</span></div>
        </div>
        <a href="/panel/users/create" class="btn btn-primary">➕ Nouveau Membre</a>
    </div>
    
    <div class="card">
        <table class="table">
            <thead>
                <tr>
                    <th>Membre</th>
                    <th>Rôle</th>
                    <th>Discord</th>
                    <th>Dernière Connexion</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${db.users.map(u => `
                <tr>
                    <td><strong>${u.username}</strong></td>
                    <td><span class="badge" style="background: ${ROLE_COLORS[u.accountType]}20; color: ${ROLE_COLORS[u.accountType]}">${ROLE_LABELS[u.accountType]}</span></td>
                    <td><code style="font-size: 0.8rem;">${u.discordId || 'Non lié'}</code></td>
                    <td style="font-size: 0.875rem; color: var(--text-muted);">${u.lastLogin ? new Date(u.lastLogin).toLocaleString('fr') : 'Jamais'}</td>
                    <td>
                        <a href="/panel/users/${u.id}/edit" class="btn btn-sm btn-outline">✏️</a>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    `;
    
    res.send(panelLayout(user, 'Membres', content, 'users'));
});

app.get('/panel/users/create', isAuthenticated, hasRole('manager'), (req, res) => {
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Nouveau <span>Membre</span></div>
            <div class="page-breadcrumb">Panel · Membres · Créer</div>
        </div>
    </div>
    
    ${req.query.error ? `<div class="alert alert-danger">${decodeURIComponent(req.query.error)}</div>` : ''}
    ${req.query.success ? `<div class="alert alert-success">${decodeURIComponent(req.query.success)}</div>` : ''}
    
    <div class="card" style="max-width: 800px;">
        <form action="/panel/users/create" method="POST">
            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label">Nom d'utilisateur *</label>
                    <input type="text" name="username" class="form-control" required placeholder="pseudo">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Mot de passe *</label>
                    <input type="password" name="password" class="form-control" required placeholder="Minimum 8 caractères">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Rôle *</label>
                    <select name="accountType" class="form-control" required>
                        <option value="">-- Sélectionner --</option>
                        ${Object.keys(HIERARCHY).filter(role => HIERARCHY[role] < HIERARCHY[user.accountType]).map(role => `
                            <option value="${role}">${ROLE_LABELS[role]}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Discord ID (optionnel)</label>
                    <input type="text" name="discordId" class="form-control" placeholder="123456789012345678">
                    <small class="text-muted" style="display: block; margin-top: 0.5rem;">
                        ID Discord de l'utilisateur pour OAuth
                    </small>
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Notes (optionnel)</label>
                <textarea name="notes" class="form-control" rows="3" placeholder="Informations complémentaires..."></textarea>
            </div>
            
            <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                <button type="submit" class="btn btn-primary">✅ Créer le Membre</button>
                <a href="/panel/users" class="btn btn-outline">❌ Annuler</a>
            </div>
        </form>
    </div>
    `;
    
    res.send(panelLayout(user, 'Nouveau Membre', content, 'users'));
});

app.post('/panel/users/create', isAuthenticated, hasRole('manager'), (req, res) => {
    const { username, password, accountType, discordId, notes } = req.body;
    const db = readDB();
    
    // Vérifications
    if (!username || !password || !accountType) {
        return res.redirect('/panel/users/create?error=' + encodeURIComponent('Tous les champs obligatoires doivent être remplis'));
    }
    
    if (password.length < 8) {
        return res.redirect('/panel/users/create?error=' + encodeURIComponent('Le mot de passe doit contenir au moins 8 caractères'));
    }
    
    if (db.users.find(u => u.username === username)) {
        return res.redirect('/panel/users/create?error=' + encodeURIComponent('Ce nom d\'utilisateur existe déjà'));
    }
    
    if (discordId && db.users.find(u => u.discordId === discordId)) {
        return res.redirect('/panel/users/create?error=' + encodeURIComponent('Ce Discord ID est déjà lié à un compte'));
    }
    
    // Vérifier que l'utilisateur ne peut pas créer un rôle supérieur au sien
    if (HIERARCHY[accountType] >= HIERARCHY[req.session.user.accountType]) {
        return res.redirect('/panel/users/create?error=' + encodeURIComponent('Vous ne pouvez pas créer un rôle supérieur ou égal au vôtre'));
    }
    
    // Créer l'utilisateur
    const newUser = {
        id: 'user-' + Date.now(),
        username: username,
        password: hashPassword(password),
        accountType: accountType,
        discordId: discordId || null,
        discordUsername: null,
        discordAvatar: null,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        suspended: false,
        banned: false,
        blacklisted: false,
        mustChangePassword: false,
        theme: 'dark',
        ip: [],
        warns: [],
        notes: notes || ''
    };
    
    db.users.push(newUser);
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Création utilisateur', req.session.user.username, username, { accountType: accountType }, clientIP);
    
    res.redirect('/panel/users?success=' + encodeURIComponent(`Membre ${username} créé avec succès`));
});

// ============ ÉDITION UTILISATEUR (AJOUTÉ) ============
app.get('/panel/users/:userId/edit', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const targetUserId = req.params.userId;
    
    const targetUser = db.users.find(u => u.id === targetUserId);
    
    if (!targetUser) {
        return res.status(404).send(errorPage('Utilisateur introuvable', 'Cet utilisateur n\'existe pas.'));
    }
    
    if (HIERARCHY[targetUser.accountType] >= HIERARCHY['manager'] && user.accountType !== 'owner') {
        return res.status(403).send(errorPage('Accès Refusé', 'Vous ne pouvez pas modifier cet utilisateur.'));
    }
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Modifier <span>${targetUser.username}</span></div>
            <div class="page-breadcrumb">Panel · Utilisateurs · Édition</div>
        </div>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${decodeURIComponent(req.query.success)}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${decodeURIComponent(req.query.error)}</div>` : ''}
    
    <div class="grid-2">
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">👤 Informations Utilisateur</h2>
            </div>
            <form method="POST" action="/panel/users/${targetUserId}/edit">
                <div class="form-group">
                    <label>Nom d'utilisateur</label>
                    <input type="text" class="form-control" value="${targetUser.username}" disabled>
                    <small class="text-muted">Le nom d'utilisateur ne peut pas être modifié</small>
                </div>
                
                <div class="form-group">
                    <label>Rôle</label>
                    <select name="accountType" class="form-control" ${user.accountType !== 'owner' ? 'disabled' : ''}>
                        ${Object.keys(ROLE_LABELS).map(role => `
                            <option value="${role}" ${targetUser.accountType === role ? 'selected' : ''}>
                                ${ROLE_LABELS[role]}
                            </option>
                        `).join('')}
                    </select>
                    ${user.accountType !== 'owner' ? '<small class="text-muted">Seul le owner peut modifier les rôles</small>' : ''}
                </div>
                
                <div class="form-group">
                    <label>Discord ID</label>
                    <input type="text" class="form-control" value="${targetUser.discordId || 'Non lié'}" disabled>
                </div>
                
                <div class="form-group">
                    <label>Statut</label>
                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem;">
                            <input type="checkbox" name="suspended" ${targetUser.suspended ? 'checked' : ''}>
                            <span>Suspendu</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem;">
                            <input type="checkbox" name="banned" ${targetUser.banned ? 'checked' : ''}>
                            <span>Banni</span>
                        </label>
                    </div>
                </div>
                
                <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                    <button type="submit" class="btn btn-primary">💾 Sauvegarder</button>
                    <a href="/panel/users" class="btn btn-outline">❌ Annuler</a>
                </div>
            </form>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🔒 Réinitialiser Mot de Passe</h2>
            </div>
            <form method="POST" action="/panel/users/${targetUserId}/reset-password" onsubmit="return confirm('Réinitialiser le mot de passe de cet utilisateur ?')">
                <div class="form-group">
                    <label>Nouveau mot de passe</label>
                    <input type="password" name="newPassword" class="form-control" placeholder="Entrez le nouveau mot de passe" required minlength="6">
                    <small class="text-muted">Minimum 6 caractères</small>
                </div>
                
                <div class="form-group">
                    <label>Confirmer le mot de passe</label>
                    <input type="password" name="confirmPassword" class="form-control" placeholder="Confirmez le mot de passe" required minlength="6">
                </div>
                
                <button type="submit" class="btn btn-warning btn-full">🔑 Réinitialiser le Mot de Passe</button>
            </form>
            
            <hr style="margin: 2rem 0; border: none; border-top: 1px solid var(--border);">
            
            <div>
                <h3 style="font-size: 1rem; margin-bottom: 1rem;">Informations</h3>
                <div style="font-size: 0.9rem; color: var(--text-secondary);">
                    <div style="padding: 0.5rem 0;">Membre depuis: ${new Date(targetUser.createdAt).toLocaleDateString('fr')}</div>
                    <div style="padding: 0.5rem 0;">Dernière connexion: ${targetUser.lastLogin ? new Date(targetUser.lastLogin).toLocaleString('fr') : 'Jamais'}</div>
                </div>
            </div>
        </div>
    </div>
    
    ${user.accountType === 'owner' ? `
    <div class="card" style="margin-top: 1.5rem; border-color: var(--danger);">
        <div class="card-header">
            <h2 class="card-title" style="color: var(--danger);">⚠️ Zone Dangereuse</h2>
        </div>
        <form method="POST" action="/panel/users/${targetUserId}/delete" onsubmit="return confirm('ATTENTION : Supprimer cet utilisateur de façon permanente ?')">
            <p style="color: var(--text-secondary); margin-bottom: 1rem;">
                Cette action est <strong>irréversible</strong>. L'utilisateur et toutes ses données seront supprimés.
            </p>
            <button type="submit" class="btn btn-danger">🗑️ Supprimer l'Utilisateur</button>
        </form>
    </div>
    ` : ''}
    `;
    
    res.send(panelLayout(user, `Éditer ${targetUser.username}`, content, 'users'));
});

app.post('/panel/users/:userId/edit', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const targetUserId = req.params.userId;
    const { accountType, suspended, banned } = req.body;
    
    const targetUserIndex = db.users.findIndex(u => u.id === targetUserId);
    
    if (targetUserIndex === -1) {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    }
    
    const targetUser = db.users[targetUserIndex];
    
    if (HIERARCHY[targetUser.accountType] >= HIERARCHY['manager'] && user.accountType !== 'owner') {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Permissions insuffisantes'));
    }
    
    if (user.accountType === 'owner' && accountType) {
        targetUser.accountType = accountType;
    }
    
    targetUser.suspended = suspended === 'on';
    targetUser.banned = banned === 'on';
    
    db.users[targetUserIndex] = targetUser;
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Modification utilisateur', user.username, targetUser.username, { 
        role: targetUser.accountType, 
        suspended: targetUser.suspended,
        banned: targetUser.banned
    }, clientIP);
    
    res.redirect(`/panel/users/${targetUserId}/edit?success=` + encodeURIComponent('Utilisateur modifié avec succès'));
});

app.post('/panel/users/:userId/reset-password', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const targetUserId = req.params.userId;
    const { newPassword, confirmPassword } = req.body;
    
    if (!newPassword || !confirmPassword) {
        return res.redirect(`/panel/users/${targetUserId}/edit?error=` + encodeURIComponent('Tous les champs sont requis'));
    }
    
    if (newPassword !== confirmPassword) {
        return res.redirect(`/panel/users/${targetUserId}/edit?error=` + encodeURIComponent('Les mots de passe ne correspondent pas'));
    }
    
    if (newPassword.length < 6) {
        return res.redirect(`/panel/users/${targetUserId}/edit?error=` + encodeURIComponent('Le mot de passe doit faire au moins 6 caractères'));
    }
    
    const targetUserIndex = db.users.findIndex(u => u.id === targetUserId);
    
    if (targetUserIndex === -1) {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    }
    
    const targetUser = db.users[targetUserIndex];
    
    if (HIERARCHY[targetUser.accountType] >= HIERARCHY['manager'] && user.accountType !== 'owner') {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Permissions insuffisantes'));
    }
    
    const hashedPassword = crypto.createHash('sha256').update(newPassword).digest('hex');
    targetUser.password = hashedPassword;
    
    db.users[targetUserIndex] = targetUser;
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Reset mot de passe', user.username, targetUser.username, {}, clientIP);
    
    res.redirect(`/panel/users/${targetUserId}/edit?success=` + encodeURIComponent('Mot de passe réinitialisé avec succès'));
});

app.post('/panel/users/:userId/delete', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const targetUserId = req.params.userId;
    
    const targetUserIndex = db.users.findIndex(u => u.id === targetUserId);
    
    if (targetUserIndex === -1) {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    }
    
    const targetUser = db.users[targetUserIndex];
    
    if (targetUser.username === user.username) {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Vous ne pouvez pas vous supprimer vous-même'));
    }
    
    db.users.splice(targetUserIndex, 1);
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Suppression utilisateur', user.username, targetUser.username, {}, clientIP);
    
    res.redirect('/panel/users?success=' + encodeURIComponent(`Utilisateur ${targetUser.username} supprimé`));
});

app.get('/panel/candidatures', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Candidatures <span>en Attente</span></div>
        </div>
    </div>
    
    <div class="grid-2">
        ${(db.candidatures || []).filter(c => c.status === 'pending').map(cand => `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${cand.name}</h3>
                <span class="badge" style="background: var(--warning); color: #000;">En attente</span>
            </div>
            <div style="margin-bottom: 1rem;">
                <div style="margin-bottom: 0.5rem;"><strong>Position:</strong> ${cand.position}</div>
                <div style="margin-bottom: 0.5rem;"><strong>Discord ID:</strong> <code>${cand.discordId}</code></div>
                <div style="margin-bottom: 0.5rem;"><strong>Date:</strong> ${new Date(cand.date).toLocaleString('fr')}</div>
            </div>
            <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 1rem;">
                <div style="font-weight: 600; margin-bottom: 0.5rem;">Expérience:</div>
                <p style="font-size: 0.9rem; color: var(--text-secondary);">${cand.experience}</p>
            </div>
            <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 1rem;">
                <div style="font-weight: 600; margin-bottom: 0.5rem;">Motivation:</div>
                <p style="font-size: 0.9rem; color: var(--text-secondary);">${cand.motivation}</p>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <form action="/panel/candidatures/${cand.id}/accept" method="POST" style="flex: 1;">
                    <button type="submit" class="btn btn-success btn-full btn-sm">✅ Accepter</button>
                </form>
                <form action="/panel/candidatures/${cand.id}/reject" method="POST" style="flex: 1;">
                    <button type="submit" class="btn btn-danger btn-full btn-sm">❌ Refuser</button>
                </form>
            </div>
        </div>
        `).join('')}
    </div>
    `;
    
    res.send(panelLayout(user, 'Candidatures', content, 'candidatures'));
});

app.post('/panel/candidatures/:id/accept', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const candidature = db.candidatures.find(c => c.id === req.params.id);
    
    if (!candidature) {
        return res.redirect('/panel/candidatures?error=' + encodeURIComponent('Candidature introuvable'));
    }
    
    candidature.status = 'accepted';
    candidature.reviewedBy = req.session.user.username;
    candidature.reviewedAt = new Date().toISOString();
    
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Candidature acceptée', req.session.user.username, candidature.name, { position: candidature.position }, clientIP);
    
    res.redirect('/panel/candidatures?success=' + encodeURIComponent(`Candidature de ${candidature.name} acceptée`));
});

app.post('/panel/candidatures/:id/reject', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const candidature = db.candidatures.find(c => c.id === req.params.id);
    
    if (!candidature) {
        return res.redirect('/panel/candidatures?error=' + encodeURIComponent('Candidature introuvable'));
    }
    
    candidature.status = 'rejected';
    candidature.reviewedBy = req.session.user.username;
    candidature.reviewedAt = new Date().toISOString();
    
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Candidature refusée', req.session.user.username, candidature.name, { position: candidature.position }, clientIP);
    
    res.redirect('/panel/candidatures?success=' + encodeURIComponent(`Candidature de ${candidature.name} refusée`));
});

// ============ LOGS ============
app.get('/panel/logs', isAuthenticated, hasRole('administrateur'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const limit = parseInt(req.query.limit) || 50;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Logs <span>Système</span></div>
            <div class="page-breadcrumb">Panel · Logs</div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
            <a href="/panel/logs?limit=50" class="btn btn-sm ${limit === 50 ? 'btn-primary' : 'btn-outline'}">50</a>
            <a href="/panel/logs?limit=100" class="btn btn-sm ${limit === 100 ? 'btn-primary' : 'btn-outline'}">100</a>
            <a href="/panel/logs?limit=500" class="btn btn-sm ${limit === 500 ? 'btn-primary' : 'btn-outline'}">500</a>
        </div>
    </div>
    
    <div class="card">
        <div style="margin-bottom: 1rem; color: var(--text-muted); font-size: 0.9rem;">
            Total: ${(db.logs || []).length} logs · Affichage: ${Math.min(limit, (db.logs || []).length)}
        </div>
        <table class="table">
            <thead>
                <tr>
                    <th>Date/Heure</th>
                    <th>Action</th>
                    <th>Exécuteur</th>
                    <th>Cible</th>
                    <th>IP</th>
                </tr>
            </thead>
            <tbody>
                ${(db.logs || []).slice(0, limit).map(log => `
                <tr>
                    <td style="font-size: 0.875rem; color: var(--text-muted);">${new Date(log.timestamp).toLocaleString('fr')}</td>
                    <td><strong>${log.action}</strong></td>
                    <td>${log.executor}</td>
                    <td>${log.target}</td>
                    <td><code style="font-size: 0.8rem;">${log.ip || 'N/A'}</code></td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    `;
    
    res.send(panelLayout(user, 'Logs', content, 'logs'));
});

// ============ MATCHES ============
app.get('/panel/matches', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Gestion des <span>Matchs</span></div>
        </div>
        <a href="/panel/matches/create" class="btn btn-primary">➕ Nouveau Match</a>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">${decodeURIComponent(req.query.success)}</div>` : ''}
    
    <div class="grid-2">
        ${db.matches.map(match => `
        <div class="card">
            <div class="card-header">
                <span class="badge" style="background: var(--primary); color: white;">${match.competition}</span>
                <span class="badge" style="background: ${match.status === 'scheduled' ? 'var(--warning)' : match.status === 'live' ? 'var(--success)' : 'var(--text-muted)'}; color: ${match.status === 'scheduled' || match.status === 'live' ? '#000' : 'white'};">
                    ${match.status === 'scheduled' ? '📅 Prévu' : match.status === 'live' ? '🔴 En cours' : '✅ Terminé'}
                </span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 0;">
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚽</div>
                    <div style="font-weight: 700; font-size: 1.25rem;">FTY</div>
                    ${match.score ? `<div style="font-size: 2rem; font-weight: 900; color: var(--primary); margin-top: 0.5rem;">${match.score.home}</div>` : ''}
                </div>
                <div style="font-size: 1.5rem; font-weight: 900; color: var(--text-muted);">VS</div>
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎮</div>
                    <div style="font-weight: 700; font-size: 1.25rem;">${match.adversaire}</div>
                    ${match.score ? `<div style="font-size: 2rem; font-weight: 900; color: var(--text-muted); margin-top: 0.5rem;">${match.score.away}</div>` : ''}
                </div>
            </div>
            <div style="text-align: center; padding-top: 1rem; border-top: 1px solid var(--border);">
                <div style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">
                    📅 ${match.date}
                </div>
                <div style="color: var(--text-muted); font-size: 0.875rem;">
                    📍 ${match.stadium || 'FTY Arena'}
                </div>
            </div>
        </div>
        `).join('')}
    </div>
    `;
    
    res.send(panelLayout(user, 'Matchs', content, 'matches'));
});

app.get('/panel/matches/create', isAuthenticated, hasRole('manager'), (req, res) => {
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Nouveau <span>Match</span></div>
            <div class="page-breadcrumb">Panel · Matchs · Créer</div>
        </div>
    </div>
    
    <div class="card" style="max-width: 800px;">
        <form action="/panel/matches/create" method="POST">
            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label">Adversaire *</label>
                    <input type="text" name="adversaire" class="form-control" required placeholder="Nom de l'équipe adverse">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Date et heure *</label>
                    <input type="text" name="date" class="form-control" required placeholder="20/02/2026 - 20h00">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Compétition *</label>
                    <select name="competition" class="form-control" required>
                        <option value="">-- Sélectionner --</option>
                        <option value="Championnat">Championnat</option>
                        <option value="Coupe FTY">Coupe FTY</option>
                        <option value="Tournoi">Tournoi</option>
                        <option value="Amical">Amical</option>
                        <option value="Play-offs">Play-offs</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Stade</label>
                    <input type="text" name="stadium" class="form-control" value="FTY Arena" placeholder="FTY Arena">
                </div>
            </div>
            
            <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                <button type="submit" class="btn btn-primary">✅ Créer le Match</button>
                <a href="/panel/matches" class="btn btn-outline">❌ Annuler</a>
            </div>
        </form>
    </div>
    `;
    
    res.send(panelLayout(user, 'Nouveau Match', content, 'matches'));
});

app.post('/panel/matches/create', isAuthenticated, hasRole('manager'), (req, res) => {
    const { adversaire, date, competition, stadium } = req.body;
    const db = readDB();
    
    if (!adversaire || !date || !competition) {
        return res.redirect('/panel/matches/create?error=' + encodeURIComponent('Tous les champs obligatoires doivent être remplis'));
    }
    
    const newMatch = {
        id: 'match-' + Date.now(),
        adversaire: adversaire,
        date: date,
        competition: competition,
        stadium: stadium || 'FTY Arena',
        status: 'scheduled',
        score: null
    };
    
    db.matches.push(newMatch);
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Création match', req.session.user.username, adversaire, { competition: competition }, clientIP);
    
    res.redirect('/panel/matches?success=' + encodeURIComponent(`Match contre ${adversaire} créé avec succès`));
});

app.get('/panel/system', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).send(errorPage('Accès Refusé', 'Réservé au compte owner xywez uniquement.'));
    }
    
    const db = readDB();
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Panneau <span>Système</span></div>
            <div class="page-breadcrumb">Panel · Système · Owner</div>
        </div>
    </div>
    
    <div class="alert alert-warning">
        ⚠️ Les actions ici sont irréversibles. Procédez avec prudence.
    </div>
    
    <div class="grid-2">
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">💾 Base de Données</h2>
            </div>
            <p class="text-secondary mb-16">
                Taille: ${JSON.stringify(db).length} caractères<br>
                Users: ${db.users.length} · Logs: ${(db.logs || []).length}
            </p>
            <a href="/panel/system/backup" class="btn btn-primary btn-full mb-8">💾 Télécharger Backup</a>
            <a href="/panel/system/clear-logs" class="btn btn-warning btn-full mb-8" onclick="return confirm('Effacer tous les logs ?')">🗑️ Effacer Logs</a>
            <a href="/panel/system/reset-db" class="btn btn-danger btn-full" onclick="return confirm('RESET TOTAL ? IRRÉVERSIBLE !')">💥 Reset DB</a>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">⚙️ Serveur</h2>
            </div>
            <div style="font-size: 0.9rem;">
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">Node.js: <strong>${process.version}</strong></div>
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">Port: <strong>${PORT}</strong></div>
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">Uptime: <strong>${Math.floor(process.uptime() / 60)} min</strong></div>
                <div style="padding: 0.75rem 0;">Mémoire: <strong>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB</strong></div>
            </div>
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Système', content, 'system'));
});

app.get('/panel/system/backup', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') return res.status(403).send('Accès refusé');
    const db = readDB();
    res.setHeader('Content-Disposition', 'attachment; filename=fty-backup-' + Date.now() + '.json');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(db, null, 2));
});

app.get('/panel/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/panel/login');
});

app.get('/panel/profile', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const userDB = db.users.find(u => u.username === user.username);
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Mon <span>Profil</span></div>
        </div>
    </div>
    
    <div class="grid-2">
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">👤 Informations</h2>
            </div>
            <div style="font-size: 0.95rem;">
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
                    <span class="text-muted">Identifiant:</span> <strong>${userDB.username}</strong>
                </div>
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
                    <span class="text-muted">Rôle:</span> 
                    <span class="badge" style="background: ${ROLE_COLORS[userDB.accountType]}20; color: ${ROLE_COLORS[userDB.accountType]}">${ROLE_LABELS[userDB.accountType]}</span>
                </div>
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
                    <span class="text-muted">Discord ID:</span> <code>${userDB.discordId || 'Non lié'}</code>
                </div>
                <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
                    <span class="text-muted">Membre depuis:</span> ${new Date(userDB.createdAt).toLocaleDateString('fr')}
                </div>
                <div style="padding: 0.75rem 0;">
                    <span class="text-muted">Dernière connexion:</span> ${userDB.lastLogin ? new Date(userDB.lastLogin).toLocaleString('fr') : 'N/A'}
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🔒 Sécurité</h2>
            </div>
            <a href="/panel/change-password" class="btn btn-warning btn-full mb-16">🔑 Changer Mot de Passe</a>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">
                <div><strong>Statut:</strong> ${userDB.suspended ? '<span class="text-danger">Suspendu</span>' : userDB.banned ? '<span class="text-danger">Banni</span>' : '<span class="text-success">Actif</span>'}</div>
            </div>
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Profil', content, 'profile'));
});

// ============ START SERVER ============
initDB();
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ⚽  FTY CLUB PRO - SYSTÈME COMPLET V2.0  ⚽           ║
║                                                          ║
║   🌐  Site Public:    http://localhost:${PORT}              ║
║   🎛️   Panel Admin:   http://localhost:${PORT}/panel         ║
║   🔑  Login:          /panel/login                       ║
║   🔗  Discord OAuth:  /auth/discord                      ║
║                                                          ║
║   👑  Owner: xywez / Yaakoub.80                          ║
║   🎮  Fondateurs: xywez & Tom (11 ans)                   ║
║                                                          ║
║   ✨  Features:                                          ║
║   • OAuth Discord                                        ║
║   • Thèmes Sombre/Clair                                  ║
║   • Stade 3D (Three.js)                                  ║
║   • Histoire du Club                                     ║
║   • Panel Owner complet                                  ║
║   • Bot Discord intégré                                  ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
    `);
});
