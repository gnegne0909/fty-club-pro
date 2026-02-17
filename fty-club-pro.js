const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// ============================================================
// ===           GÉO-IP MODULE V3                          ===
// ============================================================
const GEOIP_CACHE = {};

async function getGeoIP(ip) {
    if (!ip || ip === '127.0.0.1' || ip === 'unknown' || ip === '::1' ||
        ip.startsWith('192.168') || ip.startsWith('10.') || ip.startsWith('172.')) {
        return { country: 'Local', countryCode: 'LO', city: 'Localhost', isp: 'Réseau Local', emoji: '🏠', proxy: false, vpn: false };
    }
    if (GEOIP_CACHE[ip] && Date.now() - GEOIP_CACHE[ip].ts < 3600000) return GEOIP_CACHE[ip].data;

    function toFlag(cc) {
        if (!cc || cc.length !== 2) return '🌍';
        try { return cc.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)); }
        catch(e) { return '🌍'; }
    }

    // API 1: ipapi.co — HTTPS, fonctionne sur Render
    try {
        const r = await axios.get(`https://ipapi.co/${ip}/json/`, {
            timeout: 5000, headers: { 'User-Agent': 'FTYClubPro/3.0' }
        });
        const d = r.data;
        if (d && d.country_name && !d.error && !d.reason) {
            const geo = {
                country: d.country_name || '?', countryCode: d.country_code || '??',
                city: d.city || d.region || '?', isp: d.org || '?',
                emoji: toFlag(d.country_code), lat: d.latitude, lon: d.longitude,
                proxy: false, vpn: false, timezone: d.timezone || ''
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e1) {}

    // API 2: ip-api.com — HTTP fallback avec détection VPN/proxy
    try {
        const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,lat,lon,proxy,hosting`, { timeout: 5000 });
        const d = r.data;
        if (d && d.status === 'success') {
            const geo = {
                country: d.country || '?', countryCode: d.countryCode || '??',
                city: d.city || '?', isp: d.isp || '?',
                emoji: toFlag(d.countryCode), lat: d.lat, lon: d.lon,
                proxy: d.proxy || false, vpn: d.proxy || d.hosting || false
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e2) {}

    // API 3: ipwho.is — dernier recours
    try {
        const r = await axios.get(`https://ipwho.is/${ip}`, { timeout: 5000 });
        const d = r.data;
        if (d && d.success !== false && d.country) {
            const geo = {
                country: d.country || '?', countryCode: d.country_code || '??',
                city: d.city || d.region || '?', isp: (d.connection && d.connection.isp) || '?',
                emoji: toFlag(d.country_code), lat: d.latitude, lon: d.longitude,
                proxy: false, vpn: false
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e3) {}

    return { country: 'Inconnu', countryCode: '??', city: '?', isp: '?', emoji: '🌍', proxy: false, vpn: false };
}

const PORT = process.env.PORT || 3000;

// Configuration Discord OAuth
const DISCORD_CLIENT_ID = '1470568087966187541';
const DISCORD_CLIENT_SECRET = 'MF1XhUGt6WUWY42HrpOzRN8kUscXga1r';
const DISCORD_REDIRECT_URI = 'https://fty-club-pro-1.onrender.com/auth/discord/callback';

// ID Discord xywez - Seul owner autorisé aux pages critiques
const SUPER_ADMIN_DISCORD_ID = '969065205067825222';

// ============================================================
// ===           CONFIGURATION BOT DISCORD                  ===
// ============================================================
const PANEL_API_KEY = process.env.PANEL_API_KEY || 'fty-secret-api-key-2026';
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

let botStatus = {
    isReady: false,
    status: 'offline',
    activity: { name: 'Chargement...', type: 0 },
    guilds: 0,
    members: 0,
    logs: [],
    commands: []
};

async function callBotAPI(endpoint, method = 'GET', data = null) {
    try {
        const config = {
            method,
            url: `${BOT_API_URL}${endpoint}`,
            headers: { 'x-api-key': PANEL_API_KEY, 'Content-Type': 'application/json' },
            timeout: 5000
        };
        if (data) config.data = data;
        const response = await axios(config);
        return response.data;
    } catch (error) {
        return null;
    }
}

async function sendDiscordDM(discordId, title, message, color = '#3b82f6') {
    try {
        await callBotAPI('/api/send-dm', 'POST', {
            apiKey: PANEL_API_KEY,
            discordId,
            embed: { title, description: message, color, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro' } }
        });
        return true;
    } catch { return false; }
}

setInterval(async () => {
    const status = await callBotAPI('/api/status');
    if (status) botStatus = status;
}, 30000);

(async () => {
    const status = await callBotAPI('/api/status');
    if (status) botStatus = status;
})();


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'fty-club-ultra-secret-2026-xywez-pro',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
// rateLimiter et checkBlockedIP enregistrés après leur définition (voir plus bas)

// Sur Render le dossier src est read-only - /tmp persiste pendant la session
const DB_FILE = process.env.RENDER ? '/tmp/fty-database.json' : path.join(__dirname, 'database.json');

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
    'owner': '#9333ea', 'fondateur': '#7c3aed', 'cofondateur': '#8b5cf6',
    'manager': '#a855f7', 'administrateur': '#c084fc', 'moderateur': '#d946ef',
    'support': '#ec4899', 'capitaine': '#f472b6', 'joueur': '#fbbf24'
};

// Histoire enrichie du club
const CLUB_HISTORY = [];

// Stade virtuel
const STADIUM_DATA = {};

function initDB() {
    if (fs.existsSync(DB_FILE)) {
        console.log('📂 Base de données existante chargée');
        return;
    }
    console.log('📝 Création de la base de données initiale...');
    const initialDB = {
        users: [{
            username: 'xywez',
            password: hashPassword('xywez2026'),
            accountType: 'owner',
            role: 'owner',
            loginAttempts: 0,
            discordId: SUPER_ADMIN_DISCORD_ID,
            discordUsername: null,
            discordAvatar: null,
            firstName: 'Yaakoub',
            lastName: '',
            createdAt: new Date().toISOString(),
            lastLogin: null,
            ipAddress: null,
            platforms: ['PC'],
            sanctions: []
        }],
        applications: [],
        notifications: [],
        teamMembers: [],
        matches: [],
        announcements: [],
        logs: [],
        notes: [],
        blockedIPs: [],
        whitelistedIPs: [],
        publicSettings: {},
        serverConfig: { configured: false, categories: {}, channels: {}, roles: {} },
        antiRaid: { enabled: true, joinThreshold: 5, timeWindow: 10, doubleCompteEnabled: true, antiLinkEnabled: true },
        dmTickets: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
    console.log('✅ Base de données créée');
}

// ============================================================
// Valeurs par défaut pour TOUS les champs de la DB
// ============================================================
const DEFAULT_COMMUNIQUES = [
    { id: '1', title: '🎉 Bienvenue sur le nouveau site FTY !', content: 'Découvrez notre plateforme professionnelle avec OAuth Discord, thèmes personnalisables et bien plus !', date: '15/02/2026', author: 'xywez' },
    { id: '2', title: '🏆 Victoire Écrasante 5-1 !', content: 'FTY domine son adversaire dans un match spectaculaire au FTY Arena !', date: '12/02/2026', author: 'Tom' }
];
const DEFAULT_MATCHES = [
    { id: '1', adversaire: 'RIVAL FC', date: '20/02/2026 - 20h00', competition: 'Championnat', status: 'scheduled', score: null, stadium: 'FTY Arena' },
    { id: '2', adversaire: 'CHALLENGER ESports', date: '25/02/2026 - 21h00', competition: 'Coupe FTY', status: 'scheduled', score: null, stadium: 'FTY Arena' }
];
const DEFAULT_STATS = { wins: 15, draws: 4, losses: 2, goals: 58, goalsAgainst: 21, winRate: 71.4 };
const DEFAULT_SETTINGS = {
    maintenanceMode: false,
    maintenanceMessage: 'Le site est temporairement indisponible. Revenez bientôt !',
};

const DEFAULT_PUBLIC_SETTINGS = {
    heroTitle: 'FTY CLUB PRO',
    heroSubtitle: "L'équipe e-sport qui repousse les limites",
    logoText: 'FTY',
    primaryColor: '#9333ea',
    accentColor: '#ec4899',
    discordInvite: 'https://discord.gg/fty',
    showStats: true,
    showTactique: true,
    showMatchs: true,
    showEquipe: true,
    chatbotEnabled: true,
    guideEnabled: true,
    announcementBanner: '',
    announcementActive: false,
    customFooter: '© 2026 FTY Club Pro - Tous droits réservés',
    maintenanceMode: false,
    maintenanceMessage: 'Site en maintenance. Revenez bientôt !'
};

function ensureDBFields(data) {
    let changed = false;
    const arrays = ['users','applications','notifications','teamMembers','matches',
                    'announcements','logs','notes','blockedIPs','dmTickets','messages',
                    'communiques','conferences','sanctions','tickets','blacklist',
                    'suggestions','candidatures','resetRequests'];
    for (const key of arrays) {
        if (!Array.isArray(data[key])) { data[key] = []; changed = true; }
    }
    if (!data.stats || typeof data.stats !== 'object') { data.stats = { ...DEFAULT_STATS }; changed = true; }
    const sv = data.stats;
    if (sv.wins === undefined) { sv.wins = 0; changed = true; }
    if (sv.draws === undefined) { sv.draws = 0; changed = true; }
    if (sv.losses === undefined) { sv.losses = 0; changed = true; }
    if (sv.goals === undefined) { sv.goals = 0; changed = true; }
    if (sv.goalsAgainst === undefined) { sv.goalsAgainst = 0; changed = true; }
    if (sv.winRate === undefined) { sv.winRate = 0; changed = true; }
    if (!data.antiRaid || typeof data.antiRaid !== 'object') {
        data.antiRaid = { enabled: true, joinThreshold: 5, timeWindow: 10, doubleCompteEnabled: true, antiLinkEnabled: true };
        changed = true;
    }
    if (!data.settings || typeof data.settings !== 'object') { data.settings = { ...DEFAULT_SETTINGS }; changed = true; }
    if (!Array.isArray(data.whitelistedIPs)) { data.whitelistedIPs = []; changed = true; }
    if (!data.publicSettings || typeof data.publicSettings !== 'object') {
        data.publicSettings = { ...DEFAULT_PUBLIC_SETTINGS }; changed = true;
    } else {
        for (const k of Object.keys(DEFAULT_PUBLIC_SETTINGS)) {
            if (data.publicSettings[k] === undefined) { data.publicSettings[k] = DEFAULT_PUBLIC_SETTINGS[k]; changed = true; }
        }
    }
    if (!data.serverConfig || typeof data.serverConfig !== 'object') {
        data.serverConfig = { configured: false, categories: {}, channels: {}, roles: {} }; changed = true;
    }
    if (data.communiques.length === 0) { data.communiques = DEFAULT_COMMUNIQUES; changed = true; }
    if (data.matches.length === 0) { data.matches = DEFAULT_MATCHES; changed = true; }
    // Migration users
    data.users.forEach(u => {
        if (!u.role) { u.role = u.accountType || 'joueur'; changed = true; }
        if (!u.accountType) { u.accountType = u.role || 'joueur'; changed = true; }
        if (u.loginAttempts === undefined) { u.loginAttempts = 0; changed = true; }
        if (!Array.isArray(u.sanctions)) { u.sanctions = []; changed = true; }
    });
    return changed;
}

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) { initDB(); }
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        const changed = ensureDBFields(data);
        if (changed) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
        return data;
    } catch (e) {
        console.error('❌ Erreur readDB, réinitialisation:', e.message);
        initDB();
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function addLog(action, executor, target, details, ip, ci) {
    const db = readDB();
    if (!db.logs) db.logs = [];
    const entry = {
        id: Date.now().toString(), action, executor, target,
        details: details || {}, ip: ip || '',
        device: (ci && ci.device) || '',
        browser: (ci && ci.browser) || '',
        os: (ci && ci.os) || '',
        timestamp: new Date().toISOString(),
        geo: null
    };
    db.logs.unshift(entry);
    if (db.logs.length > 10000) db.logs = db.logs.slice(0, 10000);
    writeDB(db);
    // Enrichissement géo-IP en arrière-plan
    if (ip && ip !== 'unknown' && ip !== '127.0.0.1' && ip !== '::1') {
        getGeoIP(ip).then(geo => {
            try {
                const db2 = readDB();
                const found = db2.logs.find(l => l.id === entry.id);
                if (found) { found.geo = geo; writeDB(db2); }
            } catch(e) {}
        }).catch(() => {});
    }
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
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) {
        const first = fwd.split(',')[0].trim();
        if (first.startsWith('::ffff:')) return first.replace('::ffff:', '');
        if (first !== '::1' && first !== '127.0.0.1') return first;
    }
    const real = req.headers['x-real-ip'];
    if (real) return real.replace('::ffff:', '');
    const r = (req.connection && req.connection.remoteAddress) || (req.socket && req.socket.remoteAddress) || 'unknown';
    return r.replace('::ffff:', '').replace('::1', '127.0.0.1');
}

function getClientInfo(req) {
    const ua = req.headers['user-agent'] || '';
    let device = '💻 Desktop';
    if (/Android/i.test(ua)) device = '📱 Android';
    else if (/iPhone|iPod/i.test(ua)) device = '📱 iPhone';
    else if (/iPad/i.test(ua)) device = '📟 iPad';
    else if (/Mobile/i.test(ua)) device = '📱 Mobile';
    let browser = 'Inconnu';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/Chrome\/[0-9]/i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
    else if (/Firefox\/[0-9]/i.test(ua)) browser = 'Firefox';
    else if (/Safari\/[0-9]/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Chromium/i.test(ua)) browser = 'Chromium';
    else if (/MSIE|Trident/i.test(ua)) browser = 'IE';
    let os = '';
    if (/Windows NT 10/i.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
    else if (/Windows NT 6\.1/i.test(ua)) os = 'Windows 7';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Android ([0-9.]+)/i.test(ua)) os = 'Android ' + ua.match(/Android ([0-9.]+)/i)[1];
    else if (/OS ([0-9_]+) like Mac/i.test(ua)) os = 'iOS ' + ua.match(/OS ([0-9_]+)/i)[1].replace(/_/g,'.');
    else if (/Linux/i.test(ua)) os = 'Linux';
    return { device, browser, os };
}

// ===== ANTI-DDOS : Rate limiter en mémoire =====
const _rl = {};
function rateLimiter(req, res, next) {
    const ip = getClientIP(req);
    const now = Date.now();
    if (!_rl[ip] || now - _rl[ip].t > 60000) _rl[ip] = { n: 0, t: now };
    _rl[ip].n++;
    if (_rl[ip].n > 200) {
        return res.status(429).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>429</title>
        <style>body{background:#0a0014;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;text-align:center;padding:2rem;}
/* ========== RESPONSIVE MOBILE ========== */
@media (max-width: 768px) {
    .container { padding: 0 1rem !important; }
    .page-header { flex-direction: column; gap: 1rem; }
    .page-title { font-size: 1.75rem !important; }
    
    .grid-2, .grid-3, .grid-4 { 
        grid-template-columns: 1fr !important; 
        gap: 1rem !important;
    }
    
    .card { 
        padding: 1.25rem !important; 
        border-radius: 12px !important;
    }
    
    .btn { 
        padding: 0.75rem 1.25rem !important;
        font-size: 0.875rem !important;
        width: 100%;
        justify-content: center;
    }
    
    .form-control, .form-select {
        font-size: 16px !important; /* Évite le zoom sur iOS */
    }
    
    table {
        display: block;
        overflow-x: auto;
        font-size: 0.8rem;
    }
    
    td, th {
        padding: 0.5rem !important;
        white-space: nowrap;
    }
    
    .mobile-hidden { display: none !important; }
    
    /* Navigation mobile */
    .navbar-menu {
        position: fixed;
        top: 80px;
        left: 0;
        right: 0;
        background: var(--bg-secondary);
        flex-direction: column;
        padding: 1rem;
        transform: translateX(-100%);
        transition: transform 0.3s ease;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        max-height: calc(100vh - 80px);
        overflow-y: auto;
    }
    
    .navbar-menu.active {
        transform: translateX(0);
    }
    
    .navbar-toggle {
        display: block !important;
    }
}

@media (max-width: 480px) {
    .page-title { font-size: 1.5rem !important; }
    .section-title { font-size: 1.75rem !important; }
    .card { padding: 1rem !important; }
}

</style></head>
        <body><div style="font-size:4rem">🛡️</div><h1>Protection Anti-DDoS Active</h1><p>Trop de requêtes depuis votre IP.<br>Réessayez dans 60 secondes.</p></body></html>`);
    }
    next();
}

// Rate limiter spécial pour le login (15 tentatives / 15 min)
const _loginRl = {};
function loginRateLimiter(req, res, next) {
    const ip = getClientIP(req);
    const now = Date.now();
    if (!_loginRl[ip] || now - _loginRl[ip].t > 900000) _loginRl[ip] = { n: 0, t: now };
    _loginRl[ip].n++;
    if (_loginRl[ip].n > 15) {
        return res.status(429).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>429</title>
        <style>body{background:#0a0014;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;text-align:center;padding:2rem;}</style></head>
        <body><div style="font-size:4rem">🚫</div><h1>IP Temporairement Bloquée</h1><p>Trop de tentatives de connexion.<br>Réessayez dans 15 minutes.</p></body></html>`);
    }
    next();
}

// Vérification liste noire IPs avec whitelist
function checkBlockedIP(req, res, next) {
    const db = readDB();
    const ip = getClientIP(req);
    // Whitelist bypass
    if ((db.whitelistedIPs || []).find(w => w.ip === ip)) return next();
    const blocked = (db.blockedIPs || []).find(b => b.ip === ip);
    if (blocked) {
        return res.status(403).send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>403</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at center,#1a0b2e,#000)}</style></head>
        <body><div style="max-width:400px"><div style="font-size:5rem;margin-bottom:1rem">🚫</div><h1 style="color:#ef4444;font-size:2rem;margin-bottom:.75rem">Accès Refusé</h1><p style="color:rgba(255,255,255,.7)">Votre IP a été bloquée.<br>Raison : ${blocked.reason || 'N/A'}</p></div></body></html>`);
    }
    next();
}

// Maintenance mode
function checkMaintenance(req, res, next) {
    if (req.path.startsWith('/panel') || req.path.startsWith('/auth') || req.path.startsWith('/api')) return next();
    try {
        const db = readDB();
        const ps = db.publicSettings || {};
        if (ps.maintenanceMode) {
            return res.status(503).send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance</title>
            <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at center,#1a0b2e,#000)}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.badge{animation:pulse 2s infinite;display:inline-block;background:rgba(245,158,11,.2);color:#f59e0b;border:1px solid #f59e0b;padding:.5rem 1.5rem;border-radius:50px;font-weight:700;margin:1rem 0}</style></head>
            <body><div style="max-width:500px"><div style="font-size:5rem;margin-bottom:1rem">🔧</div><h1 style="color:#9333ea;font-size:3rem;margin-bottom:.5rem">FTY CLUB PRO</h1><div class="badge">⚙️ Maintenance en cours</div><p style="color:rgba(255,255,255,.7);margin-top:.75rem">${ps.maintenanceMessage || 'Le site est temporairement indisponible. Revenez bientôt !'}</p></div></body></html>`);
        }
    } catch(e) {}
    next();
}

// ✅ Middlewares de sécurité
app.use(rateLimiter);
app.use(checkBlockedIP);
app.use(checkMaintenance);

// ===== NOTIFICATIONS =====
function addNotification(db, targetUsername, type, title, message, priority) {
    if (!db.notifications) db.notifications = [];
    db.notifications.unshift({
        id: 'n_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        targetUsername, type, title, message,
        priority: priority || 'normal',
        read: false,
        createdAt: new Date().toISOString()
    });
    if (db.notifications.length > 10000) db.notifications = db.notifications.slice(0, 10000);
}

function notifyHigherRanks(db, fromUsername, fromRole, title, message) {
    const fromRank = HIERARCHY[fromRole] || 0;
    db.users.forEach(u => {
        const uRank = HIERARCHY[u.role || u.accountType] || 0;
        if (uRank > fromRank && u.username !== fromUsername && !u.banned && !u.suspended) {
            addNotification(db, u.username, 'security', title, message, 'high');
        }
    });
}

function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/panel/login');
}

function hasRole(minRole) {
    return (req, res, next) => {
        if (!req.session.user) return res.redirect('/panel/login');
        
        // Si la route demande le rôle owner, SEUL xywez peut y accéder
        if (minRole === 'owner') {
            const isXywez = req.session.user.discordId === SUPER_ADMIN_DISCORD_ID || 
                           req.session.user.username === 'xywez';
            
            if (isXywez && req.session.user.role === 'owner') {
                return next();
            }
            return res.status(403).send(errorPage('Accès Refusé', '❌ Cette section est réservée à xywez uniquement.'));
        }
        
        // Pour les autres rôles, vérification normale
        if (HIERARCHY[req.session.user.role] >= HIERARCHY[minRole]) return next();
        res.status(403).send(errorPage('Accès Refusé', 'Vous n\'avez pas les permissions nécessaires.'));
    };
}

// ============ STYLES GLOBAUX AVEC THÈMES ============
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700;800;900&family=Titillium+Web:wght@300;400;600;700;900&family=Roboto+Mono:wght@400;500;700&display=swap');

/* ========== RESET ========== */
*, *::before, *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

:root {
    /* 🎨 DESIGN NOIR & NÉON */
    --primary: #00FFA3;
    --primary-dark: #00CC82;
    --primary-glow: rgba(0, 255, 163, 0.8);
    --secondary: #00D4FF;
    --secondary-glow: rgba(0, 212, 255, 0.8);
    --accent: #FF006B;
    --accent-glow: rgba(255, 0, 107, 0.8);
    --success: #00FFA3;
    --warning: #FFB800;
    --danger: #FF006B;
    --info: #00D4FF;
    --purple: #9333EA;
    --font-display: 'Exo 2', sans-serif;
    --font-body: 'Titillium Web', sans-serif;
    --font-mono: 'Roboto Mono', monospace;
    --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    --shadow-glow: 0 0 20px var(--primary-glow), 0 0 40px var(--primary-glow), 0 0 60px var(--primary-glow);
    --shadow-glow-secondary: 0 0 20px var(--secondary-glow), 0 0 40px var(--secondary-glow);
}

[data-theme="dark"] {
    --bg-primary: #000000;
    --bg-secondary: #0A0A0F;
    --bg-tertiary: #141420;
    --bg-card: rgba(0, 255, 163, 0.08);
    --bg-card-hover: rgba(0, 255, 163, 0.15);
    --text-primary: #FFFFFF;
    --text-secondary: rgba(255, 255, 255, 0.9);
    --text-muted: rgba(255, 255, 255, 0.6);
    --border: rgba(0, 255, 163, 0.2);
    --border-hover: rgba(0, 255, 163, 0.4);
}

[data-theme="light"] {
    --bg-primary: #F5F7FA;
    --bg-secondary: #FFFFFF;
    --bg-tertiary: #E8ECF1;
    --bg-card: rgba(0, 0, 0, 0.02);
    --bg-card-hover: rgba(0, 0, 0, 0.05);
    --text-primary: #0A0E14;
    --text-secondary: rgba(0, 0, 0, 0.8);
    --text-muted: rgba(0, 0, 0, 0.5);
    --border: rgba(0, 0, 0, 0.1);
    --border-hover: rgba(0, 0, 0, 0.2);
}

/* ========== BASE ========== */
html {
    scroll-behavior: smooth;
    -webkit-font-smoothing: antialiased;
}

body {
    font-family: var(--font-body);
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 100vh;
    overflow-x: hidden;
    line-height: 1.6;
    position: relative;
}

/* Animated background */
body::before {
    content: '';
    position: fixed;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle at 20% 50%, var(--primary-glow) 0%, transparent 50%),
                radial-gradient(circle at 80% 50%, var(--secondary-glow) 0%, transparent 50%);
    animation: rotate 20s linear infinite;
    opacity: 0.3;
    pointer-events: none;
}

@keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* ========== ANIMATIONS ========== */
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
    from { opacity: 0; transform: translateX(-30px); }
    to { opacity: 1; transform: translateX(0); }
}

@keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
}

@keyframes glow {
    0%, 100% { filter: drop-shadow(0 0 5px var(--primary)) drop-shadow(0 0 10px var(--primary)); }
    50% { filter: drop-shadow(0 0 15px var(--primary)) drop-shadow(0 0 30px var(--primary)) drop-shadow(0 0 45px var(--primary)); }
}

.logo-glow {
    animation: glow 3s ease-in-out infinite;
}

/* ========== SCROLLBAR ========== */
::-webkit-scrollbar { width: 12px; }
::-webkit-scrollbar-track { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--primary), var(--secondary));
    border-radius: 6px;
    border: 2px solid var(--bg-secondary);
}

/* ========== TYPOGRAPHY ========== */
h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.03em;
}

.display-1 {
    font-size: clamp(3rem, 10vw, 7rem);
    font-weight: 900;
    text-transform: uppercase;
    background: linear-gradient(135deg, var(--primary), var(--accent), var(--secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    filter: drop-shadow(0 0 30px var(--primary-glow));
}

.text-gradient {
    background: linear-gradient(135deg, var(--primary), var(--accent));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

/* ========== LAYOUT ========== */
.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 2rem;
}

@media (max-width: 768px) {
    .container { padding: 0 1rem; }
}

/* ========== GRID ========== */
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2rem; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; }

@media (max-width: 1024px) {
    .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}

/* ========== CARDS ========== */
.card {
    background: var(--bg-card);
    border: 2px solid var(--border);
    border-radius: 20px;
    padding: 2rem;
    transition: var(--transition);
    backdrop-filter: blur(20px);
    position: relative;
    overflow: hidden;
}

.card::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--primary-glow), transparent);
    transition: left 0.5s;
}

.card:hover::before {
    left: 100%;
}

.card:hover {
    border-color: var(--primary);
    transform: translateY(-8px);
    box-shadow: 0 20px 60px var(--primary-glow);
}

/* ========== BUTTONS ========== */
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem 2rem;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: var(--transition);
    position: relative;
    overflow: hidden;
}

.btn::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transform: translate(-50%, -50%);
    transition: width 0.6s, height 0.6s;
}

.btn:hover::before {
    width: 400px;
    height: 400px;
}

.btn-primary {
    background: linear-gradient(135deg, var(--primary), var(--accent));
    color: #000;
    font-weight: 900;
    box-shadow: 0 10px 40px var(--primary-glow);
}

.btn-primary:hover {
    transform: translateY(-4px);
    box-shadow: 0 15px 60px var(--primary-glow);
}

.btn-full { width: 100%; }

/* ========== FORMS ========== */
.form-group {
    margin-bottom: 1.5rem;
}

.form-label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 700;
    font-family: var(--font-display);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.9rem;
}

.form-input {
    width: 100%;
    padding: 1rem 1.25rem;
    font-family: var(--font-body);
    font-size: 1rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 12px;
    color: var(--text-primary);
    transition: var(--transition);
}

.form-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 4px var(--primary-glow);
}

textarea.form-input {
    resize: vertical;
    min-height: 120px;
}

.form-hint {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
}

/* ========== INPUTS ULTRA STYLÉS VIOLET/NOIR ========== */
.form-control, input[type="text"], input[type="password"], input[type="email"], 
select, textarea {
    width: 100%;
    padding: 1rem 1.5rem;
    font-family: var(--font-body);
    font-size: 1rem;
    font-weight: 500;
    background: linear-gradient(135deg, rgba(15, 3, 24, 0.95), rgba(26, 11, 46, 0.9));
    border: 2px solid rgba(147, 51, 234, 0.4);
    border-radius: 12px;
    color: var(--text-primary);
    transition: all 0.3s ease;
    backdrop-filter: blur(20px);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
}

.form-control::placeholder, input::placeholder, textarea::placeholder {
    color: rgba(255, 255, 255, 0.4);
    font-weight: 400;
}

.form-control:hover, input:hover, select:hover, textarea:hover {
    border-color: rgba(147, 51, 234, 0.7);
    background: linear-gradient(135deg, rgba(26, 11, 46, 1), rgba(42, 20, 66, 0.95));
    box-shadow: 0 6px 20px rgba(147, 51, 234, 0.25);
}

.form-control:focus, input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--primary);
    background: linear-gradient(135deg, rgba(26, 11, 46, 1), rgba(42, 20, 66, 1));
    box-shadow: 0 0 0 4px rgba(147, 51, 234, 0.3), 
                0 0 20px var(--primary-glow),
                0 8px 30px rgba(0, 0, 0, 0.5);
    transform: translateY(-2px);
}

select.form-control {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='%239333ea'%3E%3Cpath d='M5 8l5 5 5-5z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 1rem center;
    background-size: 20px;
    padding-right: 3rem;
}

textarea.form-control {
    min-height: 120px;
    resize: vertical;
}

@media (max-width: 768px) {
    .form-control, input, select, textarea {
        padding: 1.25rem 1.5rem;
        font-size: 1.1rem;
        border-radius: 14px;
    }
    
    /* Mobile: Container plus large */
    .container {
        max-width: 100% !important;
        padding: 0 1.5rem !important;
    }
    
    /* Mobile: Titres plus petits */
    .hero-title, .display-2, .display-3 {
        font-size: clamp(2rem, 8vw, 3.5rem) !important;
    }
    
    /* Mobile: Grilles en colonne unique */
    .grid-2, .grid-3, .grid-4 {
        grid-template-columns: 1fr !important;
        gap: 1.5rem !important;
    }
    
    /* Mobile: Stade tactique en colonne */
    .tactique-grid {
        grid-template-columns: 1fr !important;
        gap: 2rem !important;
    }
    
    .tactique-terrain {
        min-height: 500px !important;
        padding: 2rem 1rem !important;
        overflow-x: auto;
    }
    
    /* Mobile: Menu hamburger */
    .navbar {
        padding: 1rem 1.5rem !important;
    }
    
    .navbar-menu {
        padding: 0 !important;
        background: rgba(15, 3, 24, 0.98) !important;
        backdrop-filter: blur(20px);
        border-bottom: 2px solid var(--primary);
    }
    
    .navbar-link {
        padding: 1.25rem 2rem !important;
        border-bottom: 1px solid rgba(147, 51, 234, 0.2);
        font-size: 1.1rem !important;
    }
    
    .navbar-link:hover {
        background: rgba(147, 51, 234, 0.1);
    }
    
    /* Mobile: Boutons plus grands */
    .btn {
        padding: 1.25rem 2rem !important;
        font-size: 1.1rem !important;
        width: 100%;
    }
    
    .btn-lg {
        padding: 1.5rem 2rem !important;
        font-size: 1.2rem !important;
    }
    
    /* Mobile: Cards plus d'espace */
    .card {
        padding: 1.5rem !important;
        margin-bottom: 1.5rem !important;
    }
    
    /* Mobile: Sections padding */
    .section {
        padding: 3rem 0 !important;
    }
    
    .section-header {
        margin-bottom: 2rem !important;
    }
    
    /* Mobile: Timeline verticale */
    .timeline-item {
        flex-direction: column !important;
        gap: 1rem !important;
    }
    
    /* Mobile: Hero padding */
    .hero {
        padding: 6rem 1.5rem 3rem !important;
        min-height: 80vh !important;
    }
    
    /* Mobile: Stats cards empilées */
    .stats-grid {
        grid-template-columns: 1fr 1fr !important;
    }
    
    /* Mobile: Textes plus lisibles */
    body {
        font-size: 16px !important;
        line-height: 1.6 !important;
    }
    
    p, .text-secondary {
        font-size: 1rem !important;
    }
    
    /* Mobile: Logos et icônes */
    .logo {
        font-size: 1.1rem !important;
    }
    
    .logo-icon {
        width: 32px !important;
        height: 32px !important;
    }
}

/* ========== ALERTS ========== */
.alert {
    padding: 1.25rem 1.5rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 1rem;
    border: 2px solid;
    animation: fadeInUp 0.5s ease-out;
}

.alert-success {
    background: rgba(0, 255, 163, 0.15);
    border-color: var(--success);
    color: var(--success);
}

.alert-danger {
    background: rgba(255, 0, 107, 0.15);
    border-color: var(--danger);
    color: var(--danger);
}

.alert-warning {
    background: rgba(255, 184, 0, 0.15);
    border-color: var(--warning);
    color: var(--warning);
}

.alert-info {
    background: rgba(0, 212, 255, 0.15);
    border-color: var(--info);
    color: var(--info);
}

/* ========== TABLES ========== */
.table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 0.5rem;
}

.table thead th {
    padding: 1rem;
    text-align: left;
    font-family: var(--font-display);
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.85rem;
    letter-spacing: 0.1em;
    color: var(--primary);
}

.table tbody tr {
    background: var(--bg-card);
    transition: var(--transition);
}

.table tbody tr:hover {
    background: var(--bg-card-hover);
    transform: scale(1.02);
    box-shadow: 0 5px 20px var(--primary-glow);
}

.table td {
    padding: 1.25rem 1rem;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
}

.table td:first-child {
    border-left: 2px solid var(--border);
    border-radius: 12px 0 0 12px;
}

.table td:last-child {
    border-right: 2px solid var(--border);
    border-radius: 0 12px 12px 0;
}

/* ========== UTILITIES ========== */
.text-center { text-align: center; }
.text-primary { color: var(--primary); }
.text-secondary { color: var(--text-secondary); }
.text-muted { color: var(--text-muted); }

.mb-8 { margin-bottom: 0.5rem; }
.mb-16 { margin-bottom: 1rem; }
.mb-24 { margin-bottom: 1.5rem; }
.mb-32 { margin-bottom: 2rem; }

@media (max-width: 768px) {
    .mobile-hidden { display: none !important; }
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
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='width: 40px; height: 40px;'%3E
    %3Cdefs%3E
        %3ClinearGradient id='ftyGrad' x1='0%' y1='0%' x2='100%' y2='100%'%3E
            %3Cstop offset='0%' style='stop-color:%2300FFA3;stop-opacity:1' /%3E
            %3Cstop offset='50%' style='stop-color:%2300D4FF;stop-opacity:1' /%3E
            %3Cstop offset='100%' style='stop-color:%23FF006B;stop-opacity:1' /%3E
        %3C/linearGradient%3E
        %3Cfilter id='glow'%3E
            %3CfeGaussianBlur stdDeviation='4' result='coloredBlur'/%3E
            %3CfeMerge%3E
                %3CfeMergeNode in='coloredBlur'/%3E
                %3CfeMergeNode in='SourceGraphic'/%3E
            %3C/feMerge%3E
        %3C/filter%3E
    %3C/defs%3E
    %3Ccircle cx='50' cy='50' r='45' fill='url(%23ftyGrad)' opacity='0.2'/%3E
    %3Cpath d='M50 15 L75 30 L75 70 L50 85 L25 70 L25 30 Z' fill='none' stroke='url(%23ftyGrad)' stroke-width='3' filter='url(%23glow)'/%3E
    %3Ccircle cx='50' cy='50' r='22' fill='%230A0E14' stroke='url(%23ftyGrad)' stroke-width='2.5'/%3E
    %3Ctext x='50' y='60' font-family='Arial Black' font-size='18' font-weight='900' fill='%2300FFA3' text-anchor='middle' filter='url(%23glow)'%3EFTY%3C/text%3E
%3C/svg%3E"><text y='0.9em' font-size='90'>⚽</text></svg>">
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
        
        /* Mobile Menu */
        .mobile-menu-toggle {
            display: none;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            width: 40px;
            height: 40px;
            border-radius: 8px;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 1.5rem;
        }
        
        @media (max-width: 768px) {
            .navbar-menu {
                position: fixed;
                top: 80px;
                left: 0;
                right: 0;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border);
                flex-direction: column;
                gap: 0;
                padding: 1rem 0;
                transform: translateY(-100%);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s;
                z-index: 1000;
            }
            
            .navbar-menu.active {
                transform: translateY(0);
                opacity: 1;
                visibility: visible;
            }
            
            .navbar-link {
                padding: 1rem 2rem;
                width: 100%;
            }
            
            .navbar-link::after {
                display: none;
            }
            
            .mobile-menu-toggle {
                display: flex;
            }
            
            .navbar-actions {
                gap: 0.5rem;
            }
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
                <span class="navbar-brand-logo logo-glow"><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='width: 40px; height: 40px;'>
    <defs>
        <linearGradient id='ftyGrad' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' style='stop-color:#00FFA3;stop-opacity:1' />
            <stop offset='50%' style='stop-color:#00D4FF;stop-opacity:1' />
            <stop offset='100%' style='stop-color:#FF006B;stop-opacity:1' />
        </linearGradient>
        <filter id='glow'>
            <feGaussianBlur stdDeviation='4' result='coloredBlur'/>
            <feMerge>
                <feMergeNode in='coloredBlur'/>
                <feMergeNode in='SourceGraphic'/>
            </feMerge>
        </filter>
    </defs>
    <circle cx='50' cy='50' r='45' fill='url(#ftyGrad)' opacity='0.2'/>
    <path d='M50 15 L75 30 L75 70 L50 85 L25 70 L25 30 Z' fill='none' stroke='url(#ftyGrad)' stroke-width='3' filter='url(#glow)'/>
    <circle cx='50' cy='50' r='22' fill='#0A0E14' stroke='url(#ftyGrad)' stroke-width='2.5'/>
    <text x='50' y='60' font-family='Arial Black' font-size='18' font-weight='900' fill='#00FFA3' text-anchor='middle' filter='url(#glow)'>FTY</text>
</svg></span>
                <span>FTY CLUB</span>
            </a>
            <ul class="navbar-menu" id="navbarMenu">
                <li><a href="/" class="navbar-link">Accueil</a></li>
                <li><a href="/#histoire" class="navbar-link">Histoire</a></li>
                <li><a href="/#tactique" class="navbar-link">Tactique</a></li>
                <li><a href="/#matches" class="navbar-link">Matchs</a></li>
                <li><a href="/candidature" class="navbar-link">Candidature</a></li>
            </ul>
            <div class="navbar-actions">
                <button class="mobile-menu-toggle" id="mobileMenuToggle" onclick="toggleMobileMenu()">☰</button>
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
        
        // Mobile menu management
        function toggleMobileMenu() {
            const menu = document.getElementById('navbarMenu');
            menu.classList.toggle('active');
        }
        
        // Close mobile menu when clicking on a link
        document.querySelectorAll('.navbar-link').forEach(link => {
            link.addEventListener('click', () => {
                const menu = document.getElementById('navbarMenu');
                menu.classList.remove('active');
            });
        });
        
        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('navbarMenu');
            const toggle = document.getElementById('mobileMenuToggle');
            if (menu && toggle && !menu.contains(e.target) && !toggle.contains(e.target)) {
                menu.classList.remove('active');
            }
        });

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
            
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 2rem;" class="tactique-grid">
                <!-- Terrain tactique -->
                <div style="background: linear-gradient(180deg, #1a5c3a 0%, #2a7c4f 50%, #1a5c3a 100%); border-radius: 16px; padding: 3rem 2rem; position: relative; min-height: 650px; border: 3px solid #0a3d25; box-shadow: inset 0 0 80px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.3);" class="tactique-terrain">
                    
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
                                <strong>Type:</strong> ${db.publicSettings.tacticFormation || '4-3-3'}
                            </div>
                            <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; border-left: 3px solid var(--secondary);">
                                <strong>Style:</strong> ${db.publicSettings.tacticStyle || 'Possession Offensive'}
                            </div>
                            <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; border-left: 3px solid var(--success);">
                                <strong>Mentalité:</strong> ${db.publicSettings.tacticMentality || 'Attaque'}
                            </div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3 style="margin-bottom: 1rem; font-size: 1.25rem; color: var(--success);">📋 Instructions</h3>
                        <ul style="list-style: none; padding: 0; display: grid; gap: 0.75rem;">
                            ${(db.publicSettings.tacticInstructions || [
                                'Pressing intense dès la perte du ballon',
                                'Jeu court en phase de construction',
                                'Utilisation des couloirs avec les ailiers',
                                'Buteur en pivot pour combiner',
                                'Montées des latéraux en surnombre'
                            ]).map((instruction, i) => {
                                const icons = ['⚡', '🎯', '↔️', '🔄', '↗️', '🛡️', '⚽', '🎮'];
                                const colors = ['var(--primary)', 'var(--secondary)', 'var(--success)', 'var(--warning)', 'var(--primary)'];
                                return `<li style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: start; gap: 0.75rem; font-size: 0.875rem;">
                                <span style="color: ${colors[i % colors.length]}; font-size: 1.2rem;">${icons[i % icons.length]}</span>
                                <span>${instruction}</span>
                            </li>`;
                            }).join('')}
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
    const state = req.query.state || 'login';
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify email',
        state: state
    });
    
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const action = req.query.state || 'login';
    
    if (!code) {
        return res.redirect('/panel/login?error=' + encodeURIComponent('Code OAuth manquant'));
    }
    
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: DISCORD_REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        
        const { access_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const discordUser = userResponse.data;
        const db = readDB();
        let user = db.users.find(u => u.discordId === discordUser.id);
        
        if (!user) {
            return res.redirect('/panel/login?error=' + encodeURIComponent('Aucun compte lié à ce Discord'));
        }
        
        // RÉCUPÉRATION IDENTIFIANT (NE CONNECTE PAS)
        if (action === 'forgot-username') {
            return res.redirect('/panel/forgot-username?success=1&username=' + encodeURIComponent(user.username));
        }
        
        // DEMANDE RESET MDP AVEC HIÉRARCHIE
        if (action === 'reset-password') {
            if (user.role === 'owner') {
                const staffEligible = db.users.filter(u => u.discordId === SUPER_ADMIN_DISCORD_ID);
                if (staffEligible.length === 0) {
                    return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Seul xywez peut reset un Owner'));
                }
            } else {
                const userLevel = HIERARCHY[user.role] || 0;
                const staffEligible = db.users.filter(u => 
                    HIERARCHY[u.role] >= userLevel && u.username !== user.username
                );
                if (staffEligible.length === 0) {
                    return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Aucun staff de niveau suffisant'));
                }
            }
            
            if (!db.resetRequests) db.resetRequests = [];
            const existingRequest = db.resetRequests.find(r => r.username === user.username && r.status === 'pending');
            if (existingRequest) {
                return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Une demande est déjà en cours'));
            }
            
            db.resetRequests.push({
                id: Date.now().toString(),
                username: user.username,
                role: user.role,
                discordId: discordUser.id,
                discordUsername: `${discordUser.username}#${discordUser.discriminator || '0'}`,
                reason: 'Demande via Discord OAuth',
                requestDate: new Date().toISOString(),
                status: 'pending',
                treatedBy: null,
                treatedDate: null,
                newPassword: null,
                restrictedTo: user.role === 'owner' ? SUPER_ADMIN_DISCORD_ID : null
            });
            
            writeDB(db);
            addLog('Demande reset mdp', user.username, user.role, { onlyXywez: user.role === 'owner' }, getClientIP(req));
            return res.redirect('/panel/forgot-password?success=1');
        }
        
        // NE PAS CONNECTER AUTOMATIQUEMENT
        return res.redirect('/panel/login?error=' + encodeURIComponent('Discord sert uniquement à récupérer ton ID ou réinitialiser ton mdp'));
        
    } catch (error) {
        console.error('Discord OAuth Error:', error);
        return res.redirect('/panel/login?error=' + encodeURIComponent('Erreur OAuth Discord'));
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
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='width: 40px; height: 40px;'%3E
    %3Cdefs%3E
        %3ClinearGradient id='ftyGrad' x1='0%' y1='0%' x2='100%' y2='100%'%3E
            %3Cstop offset='0%' style='stop-color:%2300FFA3;stop-opacity:1' /%3E
            %3Cstop offset='50%' style='stop-color:%2300D4FF;stop-opacity:1' /%3E
            %3Cstop offset='100%' style='stop-color:%23FF006B;stop-opacity:1' /%3E
        %3C/linearGradient%3E
        %3Cfilter id='glow'%3E
            %3CfeGaussianBlur stdDeviation='4' result='coloredBlur'/%3E
            %3CfeMerge%3E
                %3CfeMergeNode in='coloredBlur'/%3E
                %3CfeMergeNode in='SourceGraphic'/%3E
            %3C/feMerge%3E
        %3C/filter%3E
    %3C/defs%3E
    %3Ccircle cx='50' cy='50' r='45' fill='url(%23ftyGrad)' opacity='0.2'/%3E
    %3Cpath d='M50 15 L75 30 L75 70 L50 85 L25 70 L25 30 Z' fill='none' stroke='url(%23ftyGrad)' stroke-width='3' filter='url(%23glow)'/%3E
    %3Ccircle cx='50' cy='50' r='22' fill='%230A0E14' stroke='url(%23ftyGrad)' stroke-width='2.5'/%3E
    %3Ctext x='50' y='60' font-family='Arial Black' font-size='18' font-weight='900' fill='%2300FFA3' text-anchor='middle' filter='url(%23glow)'%3EFTY%3C/text%3E
%3C/svg%3E"><text y='0.9em' font-size='90'>⚽</text></svg>">
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

app.post('/panel/login', loginRateLimiter, (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const ip = getClientIP(req);
    const ci = getClientInfo(req);
    const user = db.users.find(u => u.username === username);

    if (!user) {
        addLog('❌ Tentative connexion (inconnu)', username || '?', 'login', {}, ip, ci);
        return res.redirect('/panel/login?error=' + encodeURIComponent('Identifiants incorrects'));
    }
    if (user.banned) {
        addLog('🚫 Connexion refusée (banni)', username, 'login', {}, ip, ci);
        return res.redirect('/panel/login?error=' + encodeURIComponent('Compte banni. Contactez un administrateur.'));
    }
    if (user.suspended) {
        addLog('⛔ Connexion refusée (suspendu)', username, 'login', {}, ip, ci);
        const raison = user.suspendReason ? ` — ${user.suspendReason}` : '';
        return res.redirect('/panel/login?error=' + encodeURIComponent('Compte suspendu' + raison));
    }
    if (!comparePassword(password, user.password)) {
        if (!user.loginAttempts) user.loginAttempts = 0;
        user.loginAttempts++;
        const restantes = 3 - user.loginAttempts;
        addLog(`❌ MDP incorrect (${user.loginAttempts}/3)`, username, 'login', { tentatives: user.loginAttempts }, ip, ci);
        if (user.loginAttempts >= 3) {
            user.suspended = true;
            user.suspendReason = `Suspension automatique : 3 MDP incorrects depuis IP ${ip}`;
            user.loginAttempts = 0;
            writeDB(db);
            addLog('🔒 Compte suspendu (3 MDP incorrects)', 'SYSTÈME', username, { ip }, ip, ci);
            const db2 = readDB();
            notifyHigherRanks(db2, username, user.role || user.accountType || 'joueur',
                '🔒 Suspension automatique',
                `Le compte <b>${username}</b> a été suspendu après 3 tentatives MDP incorrectes.<br>
                IP: <code>${ip}</code> · ${ci.device} · ${ci.browser} · ${ci.os}`
            );
            writeDB(db2);
            return res.redirect('/panel/login?error=' + encodeURIComponent('Compte suspendu après 3 tentatives incorrectes. Contactez un administrateur.'));
        }
        writeDB(db);
        return res.redirect('/panel/login?error=' + encodeURIComponent(
            `Mot de passe incorrect. ${restantes} tentative${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''} avant suspension automatique.`
        ));
    }
    // ✅ Connexion réussie
    user.loginAttempts = 0;
    user.lastLogin = new Date().toISOString();
    if (!user.ip) user.ip = [];
    if (!user.ip.includes(ip)) user.ip.push(ip);
    writeDB(db);
    addLog('🔐 Connexion panel', username, username, {}, ip, ci);
    req.session.user = {
        username: user.username,
        role: user.role || user.accountType || 'joueur',
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
        <div class="recovery-container" style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem;">
            <div class="card" style="max-width: 500px; width: 100%;">
                <div style="text-align: center; margin-bottom: 2rem;">
                    <div class="logo-glow" style="margin: 0 auto 1.5rem; display: inline-block;"><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='width: 80px; height: 80px;'>
    <defs>
        <linearGradient id='ftyGrad' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' style='stop-color:#00FFA3;stop-opacity:1' />
            <stop offset='50%' style='stop-color:#00D4FF;stop-opacity:1' />
            <stop offset='100%' style='stop-color:#FF006B;stop-opacity:1' />
        </linearGradient>
        <filter id='glow'>
            <feGaussianBlur stdDeviation='4' result='coloredBlur'/>
            <feMerge>
                <feMergeNode in='coloredBlur'/>
                <feMergeNode in='SourceGraphic'/>
            </feMerge>
        </filter>
    </defs>
    <circle cx='50' cy='50' r='45' fill='url(#ftyGrad)' opacity='0.2'/>
    <path d='M50 15 L75 30 L75 70 L50 85 L25 70 L25 30 Z' fill='none' stroke='url(#ftyGrad)' stroke-width='3' filter='url(#glow)'/>
    <circle cx='50' cy='50' r='22' fill='#0A0E14' stroke='url(#ftyGrad)' stroke-width='2.5'/>
    <text x='50' y='60' font-family='Arial Black' font-size='18' font-weight='900' fill='#00FFA3' text-anchor='middle' filter='url(#glow)'>FTY</text>
</svg></div>
                    <h1 class="display-3" style="margin-bottom: 0.5rem;">Nom d'utilisateur oublié ?</h1>
                    <p style="color: var(--text-secondary);">Connecte-toi avec Discord pour le retrouver</p>
                </div>
                
                ${req.query.success ? `<div class="alert alert-success">✅ Ton identifiant : <strong>${req.query.username}</strong></div>` : ''}
                ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
                
                <a href="/auth/discord?state=forgot-username" class="btn btn-primary btn-full" style="font-size: 1.1rem; padding: 1.25rem;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                    </svg>
                    Continuer avec Discord
                </a>
                
                <div style="text-align: center; margin-top: 1.5rem;">
                    <a href="/panel/login" style="color: var(--text-muted); text-decoration: none; font-weight: 600;">
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
    <title>Mot de passe oublié - FTY Club Pro</title>
    <style>${GLOBAL_CSS}</style>
    <style>
        .recovery-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }
        .recovery-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 2rem;
            max-width: 450px;
            width: 100%;
        }
        @media (max-width: 430px) {
            .recovery-card {
                padding: 1.5rem;
            }
        }
    </style>
</head>
<body>
        <div class="recovery-container" style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem;">
            <div class="card" style="max-width: 500px; width: 100%;">
                <div style="text-align: center; margin-bottom: 2rem;">
                    <div class="logo-glow" style="margin: 0 auto 1.5rem; display: inline-block;"><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='width: 80px; height: 80px;'>
    <defs>
        <linearGradient id='ftyGrad' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' style='stop-color:#00FFA3;stop-opacity:1' />
            <stop offset='50%' style='stop-color:#00D4FF;stop-opacity:1' />
            <stop offset='100%' style='stop-color:#FF006B;stop-opacity:1' />
        </linearGradient>
        <filter id='glow'>
            <feGaussianBlur stdDeviation='4' result='coloredBlur'/>
            <feMerge>
                <feMergeNode in='coloredBlur'/>
                <feMergeNode in='SourceGraphic'/>
            </feMerge>
        </filter>
    </defs>
    <circle cx='50' cy='50' r='45' fill='url(#ftyGrad)' opacity='0.2'/>
    <path d='M50 15 L75 30 L75 70 L50 85 L25 70 L25 30 Z' fill='none' stroke='url(#ftyGrad)' stroke-width='3' filter='url(#glow)'/>
    <circle cx='50' cy='50' r='22' fill='#0A0E14' stroke='url(#ftyGrad)' stroke-width='2.5'/>
    <text x='50' y='60' font-family='Arial Black' font-size='18' font-weight='900' fill='#00FFA3' text-anchor='middle' filter='url(#glow)'>FTY</text>
</svg></div>
                    <h1 class="display-3" style="margin-bottom: 0.5rem;">Mot de passe oublié ?</h1>
                    <p style="color: var(--text-secondary);">Connecte-toi avec Discord pour demander un reset</p>
                </div>
                
                ${req.query.success ? '<div class="alert alert-success">✅ Demande envoyée ! Le staff va la traiter.</div>' : ''}
                ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
                
                <a href="/auth/discord?state=reset-password" class="btn btn-primary btn-full" style="font-size: 1.1rem; padding: 1.25rem;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                    </svg>
                    Continuer avec Discord
                </a>
                
                <div style="text-align: center; margin-top: 1.5rem;">
                    <a href="/panel/login" style="color: var(--text-muted); text-decoration: none; font-weight: 600;">
                        ← Retour à la connexion
                    </a>
                </div>
            </div>
        </div>
    </body>
</html>`;
    res.send(html);
});

app.post('/panel/forgot-password', (req, res) => {
    const { username, discordId, reason } = req.body;
    
    if (!username || !discordId) {
        return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Nom d\'utilisateur et Discord ID requis'));
    }
    
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    
    if (!user) {
        return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Aucun compte trouvé avec ce nom d\'utilisateur'));
    }
    
    if (user.discordId !== discordId) {
        return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Discord ID incorrect pour ce compte'));
    }
    
    // Initialiser resetRequests si nécessaire
    if (!db.resetRequests) db.resetRequests = [];
    
    // Vérifier si une demande existe déjà
    const existingRequest = db.resetRequests.find(r => r.username === username && r.status === 'pending');
    
    if (existingRequest) {
        return res.redirect('/panel/forgot-password?error=' + encodeURIComponent('Une demande est déjà en cours pour ce compte'));
    }
    
    // Créer la demande
    db.resetRequests.push({
        id: Date.now().toString(),
        username: user.username,
        role: user.role,
        discordId: user.discordId,
        discordUsername: user.discordUsername || 'Non lié',
        reason: reason || 'Aucune raison fournie',
        requestDate: new Date().toISOString(),
        status: 'pending',
        treatedBy: null,
        treatedDate: null,
        newPassword: null
    });
    
    writeDB(db);
    addLog('Demande reset mot de passe', username, user.role, { reason }, getClientIP(req));
    
    res.redirect('/panel/forgot-password?success=1');
});

// ============ PANEL LAYOUT FUNCTION ============
function panelLayout(user, pageTitle, content, activePage) {
    activePage = activePage || '';
    const roleLabel = ROLE_LABELS[user.role] || user.role;
    const roleColor = ROLE_COLORS[user.role] || '#ffffff';

    // Compteurs live
    const dbP = readDB();
    const unreadNotifs = (dbP.notifications || []).filter(n => n.targetUsername === user.username && !n.read).length;
    const unreadMsgs = (dbP.messages || []).filter(m => m.to === user.username && !m.read).length;

    // Menu dynamique
    const menu = [];
    menu.push({ icon: '📊', label: 'Dashboard', href: '/panel/dashboard', id: 'dashboard' });
    if (user.role === 'owner') menu.push({ icon: '🤖', label: 'Bot Discord', href: '/panel/bot-config', id: 'bot' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '👥', label: 'Membres', href: '/panel/users', id: 'users' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) menu.push({ icon: '📝', label: 'Candidatures', href: '/panel/candidatures', id: 'candidatures' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '📋', label: 'Logs', href: '/panel/logs', id: 'logs' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) menu.push({ icon: '🔑', label: 'Demandes Reset', href: '/panel/reset-requests', id: 'reset-requests' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) menu.push({ icon: '⚽', label: 'Matchs', href: '/panel/matches', id: 'matches' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) {
        const openTickets = (dbP.dmTickets||[]).filter(t=>t.status!=='closed').length;
        menu.push({ icon: '🎫', label: 'Tickets', href: '/panel/tickets', id: 'tickets', badge: openTickets });
    }
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '📢', label: 'Annonces', href: '/panel/annonces', id: 'annonces' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '🔨', label: 'Modération', href: '/panel/moderation', id: 'moderation' });
    if (user.role === 'owner') menu.push({ icon: '🤖', label: 'Bot Discord', href: '/panel/bot', id: 'bot' });
    if (user.role === 'owner') menu.push({ icon: '⚙️', label: 'Système', href: '/panel/system', id: 'system' });
    menu.push({ icon: '✉️', label: 'Messagerie', href: '/panel/messages', id: 'messages', badge: unreadMsgs });
    menu.push({ icon: '📌', label: 'Mes Notes', href: '/panel/notes', id: 'notes' });
    menu.push({ icon: '👤', label: 'Mon Profil', href: '/panel/profile', id: 'profile' });
    if (user.role === 'capitaine' || HIERARCHY[user.role] >= HIERARCHY['manager']) menu.push({ icon: '🎯', label: 'Panel Capitaine', href: '/panel/capitaine', id: 'capitaine' });
    if (user.role === 'owner') {
        menu.push({ icon: '🔧', label: 'Maintenance', href: '/panel/owner/maintenance', id: 'maintenance' });
        menu.push({ icon: '🎨', label: 'Site Public', href: '/panel/owner/public-settings', id: 'public-settings' });
        menu.push({ icon: '🛡️', label: 'Gestion IP', href: '/panel/owner/ip-manager', id: 'ip-manager' });
    }
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '🌍', label: 'Logs Géo-IP', href: '/panel/logs-geo', id: 'logs-geo' });

    const menuHTML = menu.map(item => `
        <a href="${item.href}" class="sidebar-link ${activePage === item.id ? 'active' : ''}">
            <span class="sidebar-icon">${item.icon}</span>
            <span class="sidebar-label">${item.label}</span>
            ${(item.badge > 0) ? `<span style="margin-left:auto;background:#ef4444;color:#fff;border-radius:10px;padding:1px 7px;font-size:0.7rem;font-weight:700;">${item.badge}</span>` : ''}
        </a>`).join('');
    
    return `<!DOCTYPE html>
<html lang="fr" data-theme="${user.theme || 'dark'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle} - FTY Club Pro Panel</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='width: 40px; height: 40px;'%3E
    %3Cdefs%3E
        %3ClinearGradient id='ftyGrad' x1='0%' y1='0%' x2='100%' y2='100%'%3E
            %3Cstop offset='0%' style='stop-color:%2300FFA3;stop-opacity:1' /%3E
            %3Cstop offset='50%' style='stop-color:%2300D4FF;stop-opacity:1' /%3E
            %3Cstop offset='100%' style='stop-color:%23FF006B;stop-opacity:1' /%3E
        %3C/linearGradient%3E
        %3Cfilter id='glow'%3E
            %3CfeGaussianBlur stdDeviation='4' result='coloredBlur'/%3E
            %3CfeMerge%3E
                %3CfeMergeNode in='coloredBlur'/%3E
                %3CfeMergeNode in='SourceGraphic'/%3E
            %3C/feMerge%3E
        %3C/filter%3E
    %3C/defs%3E
    %3Ccircle cx='50' cy='50' r='45' fill='url(%23ftyGrad)' opacity='0.2'/%3E
    %3Cpath d='M50 15 L75 30 L75 70 L50 85 L25 70 L25 30 Z' fill='none' stroke='url(%23ftyGrad)' stroke-width='3' filter='url(%23glow)'/%3E
    %3Ccircle cx='50' cy='50' r='22' fill='%230A0E14' stroke='url(%23ftyGrad)' stroke-width='2.5'/%3E
    %3Ctext x='50' y='60' font-family='Arial Black' font-size='18' font-weight='900' fill='%2300FFA3' text-anchor='middle' filter='url(%23glow)'%3EFTY%3C/text%3E
%3C/svg%3E"><text y='0.9em' font-size='90'>⚽</text></svg>">
    <style>${GLOBAL_CSS}</style>
    <style>
        /* ── Panel Layout ── */
        .panel-wrap{display:flex;min-height:100vh;background:var(--bg-primary)}
        
        /* SIDEBAR */
        .sidebar{
            width:260px;background:var(--bg-secondary);border-right:1px solid var(--border);
            display:flex;flex-direction:column;position:fixed;height:100vh;left:0;top:0;z-index:200;
            transition:transform .3s cubic-bezier(.4,0,.2,1);
        }
        .sidebar-hd{padding:1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
        .sidebar-brand{font-family:var(--font-display);font-size:1.2rem;font-weight:900;background:linear-gradient(135deg,var(--primary),var(--secondary));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none;}
        .sidebar-user{padding:1rem 1.25rem;border-bottom:1px solid var(--border);}
        .s-user-row{display:flex;align-items:center;gap:.75rem;}
        .s-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--secondary));display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;}
        .s-name{font-size:.875rem;font-weight:700;margin-bottom:.2rem;}
        .s-role{font-size:.7rem;padding:.1rem .5rem;border-radius:4px;display:inline-block;}
        .sidebar-nav{flex:1;padding:.75rem 0;overflow-y:auto;scrollbar-width:none;}
        .sidebar-nav::-webkit-scrollbar{display:none}
        .sidebar-link{display:flex;align-items:center;gap:.75rem;padding:.7rem 1.25rem;color:var(--text-secondary);text-decoration:none;transition:all .15s;font-weight:500;font-size:.875rem;border-left:3px solid transparent;}
        .sidebar-link:hover{background:var(--bg-tertiary);color:var(--text-primary);border-left-color:rgba(147,51,234,.4);}
        .sidebar-link.active{background:rgba(147,51,234,.15);color:var(--text-primary);border-left-color:var(--primary);}
        .sidebar-icon{font-size:1.1rem;width:22px;text-align:center;flex-shrink:0;}
        .sidebar-ft{padding:1rem 1.25rem;border-top:1px solid var(--border);}
        
        /* MAIN */
        .main-content{flex:1;margin-left:260px;padding:1.75rem;min-width:0;}
        .page-header{margin-bottom:1.75rem;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem;}
        .page-title{font-size:1.75rem;font-weight:900;font-family:var(--font-display);margin-bottom:.25rem;line-height:1.2;}
        .page-title span{background:linear-gradient(135deg,var(--primary),var(--secondary));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
        .page-breadcrumb{color:var(--text-muted);font-size:.8rem;}
        
        /* MOBILE HEADER */
        .mob-hd{display:none;align-items:center;justify-content:space-between;padding:.875rem 1rem;background:var(--bg-secondary);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:150;}
        .mob-menu-btn{background:var(--bg-tertiary);border:1px solid var(--border);width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.25rem;flex-shrink:0;}
        .mob-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:190;backdrop-filter:blur(4px);}
        .mob-overlay.on{display:block;}
        .sidebar-close-btn{display:none;background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;padding:.25rem;}
        
        /* RESPONSIVE ── tablet */
        @media(max-width:1024px){
            .sidebar{width:240px}
            .main-content{margin-left:240px}
        }
        
        /* RESPONSIVE ── mobile */
        @media(max-width:768px){
            .sidebar{transform:translateX(-100%);width:280px;box-shadow:8px 0 40px rgba(0,0,0,.5);}
            .sidebar.open{transform:translateX(0)}
            .sidebar-close-btn{display:block}
            .main-content{margin-left:0;padding:1rem;}
            .mob-hd{display:flex}
            .page-title{font-size:1.4rem}
            .grid-2,.grid-3,.grid-4{grid-template-columns:1fr!important}
            .card{padding:1.25rem;border-radius:12px}
            table{font-size:.8rem}
            .btn{padding:.7rem 1rem;font-size:.85rem}
            /* Stack page-header on mobile */
            .page-header{flex-direction:column;gap:.75rem;}
            .page-header .btn{align-self:flex-start}
        }
        
        @media(min-width:769px){
            .mob-hd{display:none!important}
        }
        
        /* CARDS & STATS */
        .card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:1.5rem;margin-bottom:1.5rem;}
        .stat-card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:1.5rem;text-align:center;transition:transform .2s;}
        .stat-card:hover{transform:translateY(-4px);}
        .stat-icon{font-size:2rem;margin-bottom:.5rem;}
        .stat-value{font-size:1.75rem;font-weight:900;font-family:var(--font-display);margin-bottom:.25rem;}
        .stat-label{color:var(--text-muted);font-size:.8rem;}
        
        /* FORM ELEMENTS IN PANEL */
        .form-group{margin-bottom:1.25rem}
        .form-label{display:block;margin-bottom:.4rem;font-weight:600;font-size:.875rem;color:var(--text-secondary)}
        .form-control{width:100%;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:8px;padding:.7rem .875rem;color:var(--text-primary);font-size:.9rem;font-family:inherit;outline:none;transition:border-color .2s}
        .form-control:focus{border-color:var(--primary)}
        textarea.form-control{resize:vertical;min-height:80px}
        select.form-control{cursor:pointer}
        .btn-sm{padding:.4rem .875rem;font-size:.8rem}
        .btn-full{width:100%}
        .btn-success{background:#10b98120;color:#10b981;border:1px solid #10b98140}
        .btn-success:hover{background:#10b98140}
        .btn-warning{background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b40}
        .btn-warning:hover{background:#f59e0b40}
        .btn-outline{background:transparent;color:var(--text-primary);border:1px solid var(--border)}
        .btn-outline:hover{border-color:var(--primary);color:var(--primary)}
        
        /* TABLE */
        table{width:100%;border-collapse:collapse}
        th{padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid var(--border);}
        td{padding:.75rem;border-bottom:1px solid var(--border);font-size:.875rem;vertical-align:middle;}
        tr:hover td{background:rgba(147,51,234,.05)}
        .overflow-table{overflow-x:auto;-webkit-overflow-scrolling:touch}
        
        /* ALERTS */
        .alert{padding:1rem 1.25rem;border-radius:10px;margin-bottom:1.25rem;font-size:.875rem;}
        .alert-success{background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#10b981;}
        .alert-error{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#ef4444;}
        .alert-info{background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.4);color:#c084fc;}
        .alert-warning{background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:#f59e0b;}
    </style>
</head>
<body>
    <!-- Mobile overlay -->
    <div class="mob-overlay" id="mobOverlay"></div>
    
    <!-- Mobile top header -->
    <header class="mob-hd">
        <button class="mob-menu-btn" id="mobMenuBtn" aria-label="Menu">☰</button>
        <a href="/" style="font-family:var(--font-display);font-size:1.1rem;font-weight:900;background:linear-gradient(135deg,var(--primary),var(--secondary));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none;">⚽ FTY PANEL</a>
        <a href="/panel/notifications" style="position:relative;text-decoration:none;font-size:1.35rem;padding:4px;">
            🔔${unreadNotifs > 0 ? `<span style="position:absolute;top:0;right:0;background:#ef4444;color:#fff;border-radius:50%;min-width:16px;height:16px;font-size:.6rem;font-weight:900;display:flex;align-items:center;justify-content:center;">${unreadNotifs > 99 ? '99+' : unreadNotifs}</span>` : ''}
        </a>
    </header>
    
    <div class="panel-wrap">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-hd">
                <a href="/" class="sidebar-brand">⚽ FTY CLUB</a>
                <button class="sidebar-close-btn" id="sidebarCloseBtn" aria-label="Fermer">×</button>
            </div>
            
            <div class="sidebar-user">
                <div class="s-user-row">
                    <div class="s-avatar">👤</div>
                    <div style="min-width:0;flex:1;">
                        <div class="s-name">${user.username}</div>
                        <span class="s-role" style="background:${roleColor}20;color:${roleColor};">${roleLabel}</span>
                    </div>
                    <a href="/panel/notifications" title="Notifications" style="position:relative;text-decoration:none;font-size:1.25rem;margin-left:.5rem;flex-shrink:0;">
                        🔔${unreadNotifs > 0 ? `<span style="position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;border-radius:50%;min-width:16px;height:16px;font-size:.6rem;font-weight:900;display:flex;align-items:center;justify-content:center;">${unreadNotifs > 99 ? '99+' : unreadNotifs}</span>` : ''}
                    </a>
                </div>
            </div>
            
            <nav class="sidebar-nav">
                ${menuHTML}
            </nav>
            
            <div class="sidebar-ft">
                <a href="/panel/logout" class="btn btn-full" style="background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);font-size:.85rem;padding:.7rem;">
                    🚪 Déconnexion
                </a>
            </div>
        </aside>
        
        <!-- Main Content -->
        <main class="main-content">
            ${content}
        </main>
    </div>
    
    <script>
        // Theme toggle
        function updateTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            fetch('/api/update-theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
        }
        // Mobile menu — new system
        const sidebar = document.getElementById('sidebar');
        const mobOverlay = document.getElementById('mobOverlay');
        const mobMenuBtn = document.getElementById('mobMenuBtn');
        const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        
        function openSidebar() {
            sidebar.classList.add('open');
            mobOverlay.classList.add('on');
        }
        function closeSidebar() {
            sidebar.classList.remove('open');
            mobOverlay.classList.remove('on');
        }
        if (mobMenuBtn) mobMenuBtn.addEventListener('click', openSidebar);
        if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
        if (mobOverlay) mobOverlay.addEventListener('click', closeSidebar);
        // Close on nav link click (mobile)
        document.querySelectorAll('.sidebar-link').forEach(l => l.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebar();
        }));

        // ===== SYSTÈME DE NOTIFICATIONS PUSH (PC + Mobile) =====
        let _prevNotifCount = ${unreadNotifs};
        let _prevMsgCount = ${unreadMsgs};

        // Demander permission push au chargement
        async function initPushNotifs() {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'default') {
                const perm = await Notification.requestPermission();
                if (perm === 'granted') showToast('🔔 Notifications push activées !', 'success');
            }
        }
        initPushNotifs();

        function sendPushNotif(title, body, url) {
            if ('Notification' in window && Notification.permission === 'granted') {
                const n = new Notification(title, {
                    body,
                    icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%239333ea%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2248%22 text-anchor=%22middle%22 fill=%22white%22%3EFTY%3C/text%3E%3C/svg%3E',
                    tag: 'fty-notif',
                    requireInteraction: false
                });
                if (url) n.onclick = () => { window.focus(); window.location.href = url; n.close(); };
                setTimeout(() => n.close(), 5000);
            }
        }

        function showToast(msg, type) {
            const colors = { success:'#10b981', error:'#ef4444', info:'#8b5cf6', warning:'#f59e0b' };
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:' + (colors[type]||'#8b5cf6') + ';color:#fff;padding:14px 20px;border-radius:12px;font-weight:600;font-size:0.9rem;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,0.5);cursor:pointer;line-height:1.4;';
            t.innerHTML = msg;
            t.onclick = () => t.remove();
            document.body.appendChild(t);
            const anim = t.animate([{opacity:0,transform:'translateX(120%)'},{opacity:1,transform:'translateX(0)'}], {duration:300,fill:'forwards'});
            setTimeout(() => { t.animate([{opacity:1},{opacity:0}],{duration:300}).onfinish = () => t.remove(); }, 4500);
        }

        // Polling toutes les 12 secondes
        setInterval(async () => {
            try {
                const r = await fetch('/api/notifications/poll');
                const d = await r.json();
                // Nouvelles notifs
                if (d.notifs > _prevNotifCount) {
                    const diff = d.notifs - _prevNotifCount;
                    sendPushNotif('🔔 FTY Club', diff + ' nouvelle' + (diff>1?'s':'') + ' notification' + (diff>1?'s':''), '/panel/notifications');
                    showToast('🔔 ' + diff + ' nouvelle' + (diff>1?'s':'') + ' notification' + (diff>1?'s':'') + ' — <a href="/panel/notifications" style="color:#fff;text-decoration:underline">Voir</a>', 'info');
                    const badge = document.getElementById('notif-badge');
                    if (badge) { badge.textContent = d.notifs; badge.style.display = 'flex'; }
                }
                // Nouveaux messages
                if (d.msgs > _prevMsgCount) {
                    const diff = d.msgs - _prevMsgCount;
                    sendPushNotif('✉️ FTY Club', diff + ' nouveau' + (diff>1?'x':'') + ' message' + (diff>1?'s':''), '/panel/messages');
                    showToast('✉️ ' + diff + ' nouveau' + (diff>1?'x':'') + ' message' + (diff>1?'s':'') + ' — <a href="/panel/messages" style="color:#fff;text-decoration:underline">Voir</a>', 'info');
                }
                _prevNotifCount = d.notifs;
                _prevMsgCount = d.msgs;
            } catch(e) {}
        }, 12000);
    </script>
</body>
</html>`;
}

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
                        ${log.geo ? `<br><span style="color:var(--primary);">${log.geo.city}, ${log.geo.country} ${log.geo.emoji}</span>` : ''}
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
app.get('/panel/bot-config', isAuthenticated, hasRole('owner'), async (req, res) => {
    const user = req.session.user;
    
    // Récupérer le statut du bot
    const botInfo = await callBotAPI('/api/status') || { 
        ready: false, 
        guilds: 0, 
        members: 0, 
        uptime: 0,
        commands: []
    };
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Configuration <span>Bot Discord</span></div>
            <div class="page-breadcrumb">Panel · Système · Bot Discord</div>
        </div>
        <div class="badge" style="background:${botInfo.ready ? 'linear-gradient(135deg,#10b981,#6366f1)' : 'linear-gradient(135deg,#ef4444,#dc2626)'};">
            ${botInfo.ready ? '🟢 En ligne' : '🔴 Hors ligne'}
        </div>
    </div>
    
    <!-- Stats du bot en temps réel -->
    <div class="grid-3" style="margin-bottom:2rem;">
        <div class="card text-center" style="background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(99,102,241,0.1));">
            <div style="font-size:3rem;margin-bottom:0.5rem;">🌐</div>
            <div style="font-size:2rem;font-weight:900;color:var(--primary);">${botInfo.guilds}</div>
            <div style="color:var(--text-secondary);">Serveurs</div>
        </div>
        <div class="card text-center" style="background:linear-gradient(135deg,rgba(236,72,153,0.1),rgba(99,102,241,0.1));">
            <div style="font-size:3rem;margin-bottom:0.5rem;">👥</div>
            <div style="font-size:2rem;font-weight:900;color:var(--secondary);">${botInfo.members}</div>
            <div style="color:var(--text-secondary);">Membres</div>
        </div>
        <div class="card text-center" style="background:linear-gradient(135deg,rgba(255,0,107,0.1),rgba(147,51,234,0.1));">
            <div style="font-size:3rem;margin-bottom:0.5rem;">⏱️</div>
            <div style="font-size:2rem;font-weight:900;color:var(--accent);">${Math.floor(botInfo.uptime / 60)}m</div>
            <div style="color:var(--text-secondary);">Uptime</div>
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
    const myRank = HIERARCHY[user.role] || 0;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Gestion des <span>Membres</span></div>
            <div class="page-breadcrumb">${db.users.length} compte(s) enregistré(s)</div>
        </div>
        ${myRank >= HIERARCHY['manager'] ? '<a href="/panel/users/create" class="btn btn-primary">➕ Nouveau Membre</a>' : ''}
    </div>
    ${req.query.success ? '<div class="alert alert-success">✅ '+req.query.success+'</div>' : ''}
    ${req.query.error ? '<div class="alert alert-danger">❌ '+req.query.error+'</div>' : ''}
    <div class="card">
        <div style="overflow-x:auto;">
        <table class="table">
            <thead>
                <tr>
                    <th>Membre</th>
                    <th>Rôle</th>
                    <th>Discord ID</th>
                    <th>Statut</th>
                    <th>Sanctions</th>
                    <th>Dernière Connexion</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${db.users.map(u => {
                    const uRank = HIERARCHY[u.role||u.accountType]||0;
                    const canAct = myRank > uRank && u.username !== user.username;
                    const isOwner = u.username === 'xywez';
                    const statusColor = u.banned?'#ef4444':u.suspended?'#f59e0b':'#22c55e';
                    const statusLabel = u.banned?'🔨 Banni':u.suspended?'⏸️ Suspendu':'✅ Actif';
                    return '<tr style="' + (u.banned?'opacity:.6':'') + '">' +
                        '<td><strong>' + u.username + '</strong></td>' +
                        '<td><span class="badge" style="background:' + (ROLE_COLORS[u.role||u.accountType]||'#888') + '20;color:' + (ROLE_COLORS[u.role||u.accountType]||'#888') + '">' + (ROLE_LABELS[u.role||u.accountType]||u.role) + '</span></td>' +
                        '<td><code style="font-size:.75rem;">' + (u.discordId||'Non lié') + '</code></td>' +
                        '<td><span style="color:' + statusColor + ';font-weight:600;font-size:.85rem;">' + statusLabel + '</span></td>' +
                        '<td style="color:var(--text-muted);font-size:.85rem;">' + (u.sanctions||[]).length + ' sanction(s)</td>' +
                        '<td style="font-size:.8rem;color:var(--text-muted);">' + (u.lastLogin?new Date(u.lastLogin).toLocaleString('fr'):'Jamais') + '</td>' +
                        '<td><div style="display:flex;gap:.25rem;flex-wrap:wrap;">' +
                            (canAct && myRank >= HIERARCHY['manager'] ? '<a href="/panel/users/' + u.username + '/edit" class="btn btn-sm btn-outline" title="Modifier">✏️</a>' : '') +
                            (canAct && myRank >= HIERARCHY['moderateur'] && !u.suspended && !u.banned ? '<a href="/panel/moderation/suspend/' + u.username + '" class="btn btn-sm" style="background:#f59e0b20;color:#f59e0b;" title="Suspendre">⏸️</a>' : '') +
                            (canAct && myRank >= HIERARCHY['moderateur'] && u.suspended ? '<a href="/panel/moderation/unsuspend/' + u.username + '" class="btn btn-sm" style="background:#22c55e20;color:#22c55e;" title="Réactiver">▶️</a>' : '') +
                            (canAct && myRank >= HIERARCHY['administrateur'] && !u.banned ? '<a href="/panel/moderation/ban/' + u.username + '" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" title="Bannir" onclick="return confirm(\'Bannir ce membre ?\')">🔨</a>' : '') +
                            (canAct && myRank >= HIERARCHY['administrateur'] && u.banned ? '<a href="/panel/moderation/unban/' + u.username + '" class="btn btn-sm" style="background:#22c55e20;color:#22c55e;" title="Débannir">✅</a>' : '') +
                            (canAct && u.discordId && myRank >= HIERARCHY['moderateur'] ? '<a href="/panel/moderation/discord-kick/' + u.username + '" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" title="Kick Discord" onclick="return confirm(\'Kick Discord ce membre ?\')">👢</a>' : '') +
                            (canAct && myRank >= HIERARCHY['manager'] ? '<a href="/panel/users/' + u.username + '/reset-password" class="btn btn-sm btn-outline" title="Reset MDP">🔑</a>' : '') +
                            (!isOwner && canAct && myRank >= HIERARCHY['owner'] ? '<a href="/panel/users/' + u.username + '/delete" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" title="Supprimer" onclick="return confirm(\'Supprimer ce membre ?\')">🗑️</a>' : '') +
                        '</div></td>' +
                    '</tr>';
                }).join('')}
            </tbody>
        </table>
        </div>
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
                        ${Object.keys(HIERARCHY).filter(role => HIERARCHY[role] < HIERARCHY[user.role]).map(role => `
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


app.post('/panel/users/create', isAuthenticated, hasRole('owner'), async (req, res) => {
    const { username, password, role, discordId } = req.body;
    const user = req.session.user;
    
    if (!username || !password || !role) {
        return res.redirect('/panel/users?error=Tous les champs sont requis');
    }
    
    if (user.username !== 'xywez' && HIERARCHY[user.role] <= HIERARCHY[role]) {
        return res.redirect('/panel/users?error=Vous ne pouvez pas créer un compte de rang égal ou supérieur');
    }
    
    const db = readDB();
    
    if (db.users.find(u => u.username === username)) {
        return res.redirect('/panel/users?error=Ce nom d\'utilisateur existe déjà');
    }
    
    const newUser = {
        username,
        password: hashPassword(password),
        accountType: role,
        role,
        loginAttempts: 0,
        discordId: discordId || null,
        discordUsername: null,
        discordAvatar: null,
        firstName: '',
        lastName: '',
        createdAt: new Date().toISOString(),
        lastLogin: null,
        ipAddress: null,
        platforms: [],
        sanctions: []
    };
    
    db.users.push(newUser);
    writeDB(db);
    
    if (discordId) {
        await sendDiscordDM(
            discordId,
            '✅ Compte Panel Créé',
            `Votre compte panel FTY Club Pro a été créé!\n\n**Informations de connexion:**\n• Nom d'utilisateur: \`${username}\`\n• Mot de passe: \`${password}\`\n• Rôle: ${ROLE_LABELS[role]}\n\n🔗 Connectez-vous sur: https://fty-club-pro-1.onrender.com/panel/login\n\n⚠️ Changez votre mot de passe dès votre première connexion!`,
            '#22c55e'
        );
    }
    
    addLog('✅ Compte créé', user.username, username, { role }, getClientIP(req), getClientInfo(req));
    res.redirect(`/panel/users?success=Compte ${username} créé${discordId ? ' (identifiants envoyés en DM)' : ''}`);
});


// ============ EDIT USER ============
app.get('/panel/users/:id/edit', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const targetUser = db.users.find(u => u.id === req.params.id);
    
    if (!targetUser) {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    }
    
    const content = `
        <h1>Modifier ${targetUser.username}</h1>
        <form method="POST" action="/panel/users/${targetUser.id}/update">
            <div class="form-group">
                <label>Rôle</label>
                <select name="role" class="form-control" required>
                    ${Object.keys(HIERARCHY).map(role => `
                        <option value="${role}" ${targetUser.role === role ? 'selected' : ''}>${ROLE_LABELS[role]}</option>
                    `).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Discord ID</label>
                <input type="text" name="discordId" class="form-control" value="${targetUser.discordId || ''}" placeholder="Ex: 123456789">
            </div>
            <div class="form-group">
                <label>Statut</label>
                <select name="status" class="form-control">
                    <option value="active" ${!targetUser.suspended && !targetUser.banned ? 'selected' : ''}>Actif</option>
                    <option value="suspended" ${targetUser.suspended ? 'selected' : ''}>Suspendu</option>
                    <option value="banned" ${targetUser.banned ? 'selected' : ''}>Banni</option>
                </select>
            </div>
            <button type="submit" class="btn btn-primary">Sauvegarder</button>
            <a href="/panel/users" class="btn btn-secondary">Annuler</a>
        </form>
    `;
    
    res.send(panelLayout(req.session.user, `Modifier ${targetUser.username}`, content, 'users'));
});

app.post('/panel/users/:id/update', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.params.id);
    
    if (!user) {
        return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    }
    
    const { role, discordId, status } = req.body;
    
    user.role = role;
    user.accountType = role;
    user.discordId = discordId || user.discordId;
    user.suspended = status === 'suspended';
    user.banned = status === 'banned';
    
    writeDB(db);
    addLog('Modification utilisateur', req.session.user.username, user.username, { role, status }, getClientIP(req));
    
    res.redirect('/panel/users?success=' + encodeURIComponent(`${user.username} modifié`));
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
    const filter = req.query.filter || '';
    let logs = db.logs || [];
    if (filter) logs = logs.filter(l => [l.action,l.executor,l.target,l.ip].join(' ').toLowerCase().includes(filter.toLowerCase()));
    const content = `
    <div class="page-header">
        <div><div class="page-title">Logs <span>Système</span></div><div class="page-breadcrumb">Total: ${(db.logs||[]).length}</div></div>
        <div style="display:flex;gap:0.5rem;">
            <a href="/panel/logs?limit=50" class="btn btn-sm ${limit===50?'btn-primary':'btn-outline'}">50</a>
            <a href="/panel/logs?limit=200" class="btn btn-sm ${limit===200?'btn-primary':'btn-outline'}">200</a>
            <a href="/panel/logs?limit=500" class="btn btn-sm ${limit===500?'btn-primary':'btn-outline'}">500</a>
        </div>
    </div>
    <div class="card" style="padding:1rem;margin-bottom:1rem;">
        <form method="GET" style="display:flex;gap:0.75rem;align-items:center;">
            <input type="hidden" name="limit" value="${limit}">
            <input name="filter" value="${filter}" placeholder="🔍 Filtrer par action, user, IP..." class="form-control" style="flex:1;">
            <button type="submit" class="btn btn-primary">Filtrer</button>
            ${filter ? `<a href="/panel/logs?limit=${limit}" class="btn btn-outline">✕ Reset</a>` : ''}
        </form>
    </div>
    <div class="card" style="overflow-x:auto;">
        <div style="margin-bottom:0.75rem;font-size:0.85rem;color:var(--text-muted);">${filter ? `${logs.length} résultats filtrés` : `Affichage ${Math.min(limit, logs.length)} / ${logs.length}`}</div>
        <table class="table" style="min-width:1000px;">
            <thead><tr>
                <th>Date</th><th>Action</th><th>Exécuteur</th><th>Cible</th><th>IP</th><th>Appareil</th><th>Navigateur</th><th>OS</th>
            </tr></thead>
            <tbody>
                ${logs.slice(0, limit).map(l => `
                <tr>
                    <td style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">${new Date(l.timestamp).toLocaleString('fr-FR')}</td>
                    <td><strong>${l.action||'-'}</strong></td>
                    <td style="font-weight:600;">${l.executor||'-'}</td>
                    <td>${l.target||'-'}</td>
                    <td><code style="font-size:0.76rem;background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;white-space:nowrap;">${l.ip||'-'}</code></td>
                    <td style="font-size:0.82rem;white-space:nowrap;">${l.device||'-'}</td>
                    <td style="font-size:0.82rem;">${l.browser||'-'}</td>
                    <td style="font-size:0.82rem;white-space:nowrap;">${l.os||'-'}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>`;
    res.send(panelLayout(user, 'Logs', content, 'logs'));
});

// ============ DEMANDES RESET MOT DE PASSE ============
app.get('/panel/reset-requests', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const currentUserRank = HIERARCHY[user.role];
    
    if (!db.resetRequests) db.resetRequests = [];
    
    const visibleRequests = db.resetRequests.filter(r => {
        const requestUserRank = HIERARCHY[r.role] || HIERARCHY[r.accountType] || 0;
        return requestUserRank < currentUserRank;
    });
    
    const pendingRequests = visibleRequests.filter(r => r.status === 'pending');
    const treatedRequests = visibleRequests.filter(r => r.status !== 'pending');
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Demandes <span>Reset Mot de Passe</span></div>
            <div class="page-breadcrumb">Panel · Gestion · Reset MDP</div>
        </div>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${req.query.success}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    
    <div class="alert alert-info">
        ℹ️ Vous pouvez uniquement traiter les demandes des membres de rang <strong>inférieur</strong> au vôtre.
    </div>
    
    <!-- Demandes en attente -->
    <div class="card">
        <div class="card-header">
            <h2 class="card-title">⏳ En attente (${pendingRequests.length})</h2>
        </div>
        
        ${pendingRequests.length === 0 ? `
            <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
                <p>Aucune demande en attente</p>
            </div>
        ` : `
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Utilisateur</th>
                            <th>Rôle</th>
                            <th>Discord</th>
                            <th>Raison</th>
                            <th>Date</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pendingRequests.map(request => `
                            <tr>
                                <td>
                                    <div style="font-weight: 600;">${request.username}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-muted);">ID: ${request.id}</div>
                                </td>
                                <td>
                                    <span style="color: ${ROLE_COLORS[request.accountType]};">
                                        ${ROLE_LABELS[request.accountType]}
                                    </span>
                                </td>
                                <td>
                                    ${request.discordUsername}<br>
                                    <span style="font-size: 0.75rem; color: var(--text-muted);">${request.discordId}</span>
                                </td>
                                <td style="max-width: 200px;">
                                    <div style="font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        ${request.reason}
                                    </div>
                                </td>
                                <td>${new Date(request.requestDate).toLocaleDateString('fr-FR')}</td>
                                <td style="text-align: right;">
                                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                        <a href="/panel/reset-requests/approve/${request.id}" 
                                           class="btn btn-sm btn-success"
                                           onclick="return confirm('Approuver et générer un nouveau mot de passe pour ${request.username} ?')">
                                            ✅ Approuver
                                        </a>
                                        <a href="/panel/reset-requests/reject/${request.id}" 
                                           class="btn btn-sm btn-danger"
                                           onclick="return confirm('Rejeter la demande de ${request.username} ?')">
                                            ❌ Rejeter
                                        </a>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    </div>
    
    <!-- Demandes traitées -->
    ${treatedRequests.length > 0 ? `
    <div class="card" style="margin-top: 1.5rem;">
        <div class="card-header">
            <h2 class="card-title">📜 Historique (${treatedRequests.length})</h2>
        </div>
        
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>Utilisateur</th>
                        <th>Statut</th>
                        <th>Traité par</th>
                        <th>Date traitement</th>
                        <th>Nouveau MDP</th>
                    </tr>
                </thead>
                <tbody>
                    ${treatedRequests.slice(0, 20).map(request => `
                        <tr style="opacity: 0.7;">
                            <td>${request.username}</td>
                            <td>
                                ${request.status === 'approved' 
                                    ? '<span style="color: #00ff88;">✅ Approuvé</span>' 
                                    : '<span style="color: #ff0050;">❌ Rejeté</span>'}
                            </td>
                            <td>${request.treatedBy || 'N/A'}</td>
                            <td>${request.treatedDate ? new Date(request.treatedDate).toLocaleDateString('fr-FR') : 'N/A'}</td>
                            <td>
                                ${request.newPassword 
                                    ? `<code style="background: var(--bg-tertiary); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem;">${request.newPassword}</code>` 
                                    : '-'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>
    ` : ''}
    `;
    
    res.send(panelLayout(user, 'Demandes Reset', content, 'reset-requests'));
});

// ============ APPROUVER DEMANDE RESET ============
app.get('/panel/reset-requests/approve/:id', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const currentUserRank = HIERARCHY[user.role];
    const requestId = req.params.id;
    
    if (!db.resetRequests) db.resetRequests = [];
    
    const request = db.resetRequests.find(r => r.id === requestId);
    
    if (!request) {
        return res.redirect('/panel/reset-requests?error=' + encodeURIComponent('Demande introuvable'));
    }
    
    if (request.status !== 'pending') {
        return res.redirect('/panel/reset-requests?error=' + encodeURIComponent('Cette demande a déjà été traitée'));
    }
    
    // Vérifier que l'utilisateur peut traiter cette demande (rang supérieur)
    const requestUserRank = HIERARCHY[request.role] || HIERARCHY[request.accountType] || 0;
    if (requestUserRank >= currentUserRank) {
        return res.redirect('/panel/reset-requests?error=' + encodeURIComponent('Vous ne pouvez pas traiter cette demande (rang insuffisant)'));
    }
    
    // Générer un nouveau mot de passe temporaire
    const newPassword = 'FTY' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Mettre à jour le mot de passe de l'utilisateur
    const targetUser = db.users.find(u => u.username === request.username);
    if (targetUser) {
        targetUser.password = hashPassword(newPassword);
        targetUser.mustChangePassword = true;
    }
    
    // Mettre à jour la demande
    request.status = 'approved';
    request.treatedBy = user.username;
    request.treatedDate = new Date().toISOString();
    request.newPassword = newPassword;
    
    writeDB(db);
    addLog('Demande reset approuvée', user.username, user.role, { 
        targetUser: request.username,
        newPassword: newPassword 
    }, getClientIP(req));
    
    res.redirect('/panel/reset-requests?success=' + encodeURIComponent(`Mot de passe réinitialisé pour ${request.username}. Nouveau MDP : ${newPassword}`));
});

// ============ REJETER DEMANDE RESET ============
app.get('/panel/reset-requests/reject/:id', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const currentUserRank = HIERARCHY[user.role];
    const requestId = req.params.id;
    
    if (!db.resetRequests) db.resetRequests = [];
    
    const request = db.resetRequests.find(r => r.id === requestId);
    
    if (!request) {
        return res.redirect('/panel/reset-requests?error=' + encodeURIComponent('Demande introuvable'));
    }
    
    if (request.status !== 'pending') {
        return res.redirect('/panel/reset-requests?error=' + encodeURIComponent('Cette demande a déjà été traitée'));
    }
    
    // Vérifier que l'utilisateur peut traiter cette demande (rang supérieur)
    const requestUserRank = HIERARCHY[request.role] || HIERARCHY[request.accountType] || 0;
    if (requestUserRank >= currentUserRank) {
        return res.redirect('/panel/reset-requests?error=' + encodeURIComponent('Vous ne pouvez pas traiter cette demande (rang insuffisant)'));
    }
    
    // Mettre à jour la demande
    request.status = 'rejected';
    request.treatedBy = user.username;
    request.treatedDate = new Date().toISOString();
    
    writeDB(db);
    addLog('Demande reset rejetée', user.username, user.role, { 
        targetUser: request.username 
    }, getClientIP(req));
    
    res.redirect('/panel/reset-requests?success=' + encodeURIComponent(`Demande de ${request.username} rejetée`));
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
                <h2 class="card-title">👑 Gestion Owners</h2>
            </div>
            <p class="text-secondary mb-16">
                Gérer les comptes avec privilèges Owner
            </p>
            <a href="/panel/system/owners" class="btn btn-primary btn-full">👑 Gérer les Owners</a>
        </div>
        
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

// ============ GESTION DES OWNERS (XYWEZ UNIQUEMENT) ============
app.get('/panel/system/owners', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).send(errorPage('Accès Refusé', 'Réservé au super admin xywez uniquement.'));
    }
    
    const db = readDB();
    const user = req.session.user;
    const owners = db.users.filter(u => u.accountType === 'owner');
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Gestion des <span>Owners</span></div>
            <div class="page-breadcrumb">Panel · Système · Owners</div>
        </div>
        <a href="/panel/system/owners/create" class="btn btn-primary">
            ➕ Créer un Owner
        </a>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${req.query.success}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    
    <div class="alert alert-warning">
        👑 <strong>Super Admin :</strong> Vous seul pouvez créer, modifier ou supprimer des comptes Owner.
    </div>
    
    <div class="card">
        <div class="card-header">
            <h2 class="card-title">👑 Liste des Owners (${owners.length})</h2>
        </div>
        
        ${owners.length === 0 ? `
            <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                <div style="font-size: 3rem; margin-bottom: 1rem;">👑</div>
                <p>Aucun owner pour le moment</p>
            </div>
        ` : `
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Utilisateur</th>
                            <th>Discord</th>
                            <th>Créé le</th>
                            <th>Dernière connexion</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${owners.map(owner => `
                            <tr>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                                        <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #ff0050, #00d4ff); display: flex; align-items: center; justify-content: center; font-weight: 900;">
                                            ${owner.username.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <div style="font-weight: 600;">${owner.username}</div>
                                            <div style="font-size: 0.875rem; color: var(--text-muted);">
                                                <span style="color: #ff0050;">👑 Owner</span>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    ${owner.discordUsername || '<span style="color: var(--text-muted);">Non lié</span>'}
                                    ${owner.discordId ? `<br><span style="font-size: 0.75rem; color: var(--text-muted);">${owner.discordId}</span>` : ''}
                                </td>
                                <td>${new Date(owner.createdAt).toLocaleDateString('fr-FR')}</td>
                                <td>${owner.lastLogin ? new Date(owner.lastLogin).toLocaleDateString('fr-FR') : 'Jamais'}</td>
                                <td style="text-align: right;">
                                    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                        <a href="/panel/system/owners/edit/${owner.username}" class="btn btn-sm btn-secondary">
                                            ✏️ Modifier
                                        </a>
                                        ${owner.username !== 'xywez' ? `
                                            <a href="/panel/system/owners/toggle-suspend/${owner.username}"
                                               class="btn btn-sm ${owner.suspended ? 'btn-success' : 'btn-warning'}"
                                               onclick="return confirm('${owner.suspended ? 'Réactiver' : 'Suspendre'} le compte de ${owner.username} ?')">
                                                ${owner.suspended ? '✅ Réactiver' : '⛔ Suspendre'}
                                            </a>
                                            <a href="/panel/system/owners/delete/${owner.username}" 
                                               class="btn btn-sm btn-danger"
                                               onclick="return confirm('Supprimer le compte owner ${owner.username} ?')">
                                                🗑️ Supprimer
                                            </a>
                                        ` : `
                                            <span style="font-size: 0.75rem; color: var(--text-muted); padding: 0.5rem;">
                                                🔒 Protégé
                                            </span>
                                        `}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    </div>
    `;
    
    res.send(panelLayout(user, 'Gestion Owners', content, 'system'));
});

// ============ CRÉER UN OWNER ============
app.get('/panel/system/owners/create', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).send(errorPage('Accès Refusé', 'Réservé au super admin xywez uniquement.'));
    }
    
    const user = req.session.user;
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Créer un <span>Owner</span></div>
            <div class="page-breadcrumb">Panel · Système · Owners · Créer</div>
        </div>
    </div>
    
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    
    <div class="card" style="max-width: 600px;">
        <form method="POST" action="/api/system/owners/create">
            <div class="form-group">
                <label class="form-label">Nom d'utilisateur *</label>
                <input type="text" name="username" class="form-input" required minlength="3" maxlength="20" placeholder="Ex: john_doe">
                <small class="form-hint">3-20 caractères, lettres, chiffres, tirets et underscores uniquement</small>
            </div>
            
            <div class="form-group">
                <label class="form-label">Mot de passe *</label>
                <input type="password" name="password" class="form-input" required minlength="6" placeholder="Minimum 6 caractères">
            </div>
            
            <div class="form-group">
                <label class="form-label">Discord ID (optionnel)</label>
                <input type="text" name="discordId" class="form-input" placeholder="Ex: 123456789012345678">
                <small class="form-hint">L'ID Discord de l'utilisateur (18 chiffres)</small>
            </div>
            
            <div class="form-group">
                <label class="form-label">Prénom</label>
                <input type="text" name="firstName" class="form-input" placeholder="Ex: John">
            </div>
            
            <div class="form-group">
                <label class="form-label">Nom</label>
                <input type="text" name="lastName" class="form-input" placeholder="Ex: Doe">
            </div>
            
            <div class="alert alert-warning">
                ⚠️ <strong>Attention :</strong> Le compte aura un accès complet au système avec le rôle Owner.
            </div>
            
            <div style="display: flex; gap: 1rem;">
                <a href="/panel/system/owners" class="btn btn-secondary">← Annuler</a>
                <button type="submit" class="btn btn-primary" style="flex: 1;">👑 Créer le Owner</button>
            </div>
        </form>
    </div>
    `;
    
    res.send(panelLayout(user, 'Créer Owner', content, 'system'));
});

// ============ API CRÉER OWNER ============
app.post('/api/system/owners/create', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).json({ success: false, error: 'Accès refusé' });
    }
    
    const { username, password, discordId, firstName, lastName } = req.body;
    
    if (!username || !password) {
        return res.redirect('/panel/system/owners/create?error=' + encodeURIComponent('Nom d\'utilisateur et mot de passe requis'));
    }
    
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        return res.redirect('/panel/system/owners/create?error=' + encodeURIComponent('Nom d\'utilisateur invalide (3-20 caractères, lettres, chiffres, tirets et underscores)'));
    }
    
    const db = readDB();
    
    if (db.users.find(u => u.username === username)) {
        return res.redirect('/panel/system/owners/create?error=' + encodeURIComponent('Ce nom d\'utilisateur existe déjà'));
    }
    
    if (discordId && db.users.find(u => u.discordId === discordId)) {
        return res.redirect('/panel/system/owners/create?error=' + encodeURIComponent('Ce Discord ID est déjà utilisé'));
    }
    
    const hashedPassword = hashPassword(password);
    
    const newOwner = {
        username,
        password: hashedPassword,
        accountType: 'owner',
        discordId: discordId || null,
        discordUsername: null,
        discordAvatar: null,
        firstName: firstName || '',
        lastName: lastName || '',
        createdAt: new Date().toISOString(),
        lastLogin: null,
        ip: [],
        theme: 'dark',
        mustChangePassword: false
    };
    
    db.users.push(newOwner);
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Création compte Owner', req.session.user.username, 'owner', { 
        createdUser: username,
        discordId: discordId || 'none'
    }, clientIP);
    
    res.redirect('/panel/system/owners?success=' + encodeURIComponent('Owner créé avec succès'));
});

// ============ MODIFIER UN OWNER ============
app.get('/panel/system/owners/edit/:username', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).send(errorPage('Accès Refusé', 'Réservé au super admin xywez uniquement.'));
    }
    
    const db = readDB();
    const user = req.session.user;
    const targetUser = db.users.find(u => u.username === req.params.username && u.accountType === 'owner');
    
    if (!targetUser) {
        return res.status(404).send(errorPage('Owner introuvable', 'Cet owner n\'existe pas.'));
    }
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Modifier <span>${targetUser.username}</span></div>
            <div class="page-breadcrumb">Panel · Système · Owners · Modifier</div>
        </div>
    </div>
    
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    
    <div class="card" style="max-width: 600px;">
        <form method="POST" action="/api/system/owners/edit/${targetUser.username}">
            <div class="form-group">
                <label class="form-label">Nom d'utilisateur</label>
                <input type="text" class="form-input" value="${targetUser.username}" disabled>
                <small class="form-hint">Le nom d'utilisateur ne peut pas être modifié</small>
            </div>
            
            <div class="form-group">
                <label class="form-label">Nouveau mot de passe (laisser vide pour ne pas changer)</label>
                <input type="password" name="password" class="form-input" minlength="6" placeholder="Minimum 6 caractères">
            </div>
            
            <div class="form-group">
                <label class="form-label">Discord ID</label>
                <input type="text" name="discordId" class="form-input" value="${targetUser.discordId || ''}" placeholder="Ex: 123456789012345678">
            </div>
            
            <div class="form-group">
                <label class="form-label">Prénom</label>
                <input type="text" name="firstName" class="form-input" value="${targetUser.firstName || ''}" placeholder="Ex: John">
            </div>
            
            <div class="form-group">
                <label class="form-label">Nom</label>
                <input type="text" name="lastName" class="form-input" value="${targetUser.lastName || ''}" placeholder="Ex: Doe">
            </div>
            
            <div style="display: flex; gap: 1rem;">
                <a href="/panel/system/owners" class="btn btn-secondary">← Annuler</a>
                <button type="submit" class="btn btn-primary" style="flex: 1;">💾 Enregistrer</button>
            </div>
        </form>
    </div>
    `;
    
    res.send(panelLayout(user, 'Modifier Owner', content, 'system'));
});

// ============ API MODIFIER OWNER ============
app.post('/api/system/owners/edit/:username', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).json({ success: false, error: 'Accès refusé' });
    }
    
    const db = readDB();
    const targetUser = db.users.find(u => u.username === req.params.username && u.accountType === 'owner');
    
    if (!targetUser) {
        return res.status(404).send('Owner introuvable');
    }
    
    const { password, discordId, firstName, lastName } = req.body;
    
    // Vérifier si le Discord ID n'est pas déjà utilisé par un autre compte
    if (discordId && discordId !== targetUser.discordId) {
        const existingUser = db.users.find(u => u.discordId === discordId && u.username !== targetUser.username);
        if (existingUser) {
            return res.redirect(`/panel/system/owners/edit/${req.params.username}?error=` + encodeURIComponent('Ce Discord ID est déjà utilisé'));
        }
    }
    
    // Mettre à jour le mot de passe si fourni
    if (password && password.length >= 6) {
        targetUser.password = hashPassword(password);
    }
    
    targetUser.discordId = discordId || null;
    targetUser.firstName = firstName || '';
    targetUser.lastName = lastName || '';
    
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Modification compte Owner', req.session.user.username, 'owner', { 
        modifiedUser: targetUser.username
    }, clientIP);
    
    res.redirect('/panel/system/owners?success=' + encodeURIComponent('Owner modifié avec succès'));
});

// ============ SUPPRIMER UN OWNER ============
app.get('/panel/system/owners/delete/:username', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') {
        return res.status(403).send(errorPage('Accès Refusé', 'Réservé au super admin xywez uniquement.'));
    }
    
    const username = req.params.username;
    
    // Protection : ne pas supprimer xywez
    if (username === 'xywez') {
        return res.status(403).send(errorPage('Action Interdite', 'Le compte xywez ne peut pas être supprimé.'));
    }
    
    const db = readDB();
    const targetUser = db.users.find(u => u.username === username && u.accountType === 'owner');
    
    if (!targetUser) {
        return res.status(404).send(errorPage('Owner introuvable', 'Cet owner n\'existe pas.'));
    }
    
    // Supprimer l'utilisateur
    db.users = db.users.filter(u => u.username !== username);
    writeDB(db);
    
    const clientIP = getClientIP(req);
    addLog('Suppression compte Owner', req.session.user.username, 'owner', { 
        deletedUser: username
    }, clientIP);
    
    res.redirect('/panel/system/owners?success=' + encodeURIComponent('Owner supprimé avec succès'));
});

app.get('/panel/logout', (req, res) => {
    if (req.session.user) addLog('🚪 Déconnexion', req.session.user.username, req.session.user.username, {}, getClientIP(req), getClientInfo(req));
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


// ============================================
// PANEL CAPITAINE - GESTION ÉQUIPE
// ============================================
app.get('/panel/capitaine', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const currentCompo = db.compositions && db.compositions.length > 0 
        ? db.compositions[db.compositions.length - 1] 
        : null;
    
    const currentTactic = db.serverConfig && db.serverConfig.tactic 
        ? db.serverConfig.tactic 
        : {
            formation: '4-3-3',
            style: 'Possession Offensive',
            mentality: 'Attaque'
        };
    
    const content = `
    <style>
        .captain-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
        .quick-action { background: var(--bg-secondary); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border); transition: all 0.3s; cursor: pointer; }
        .quick-action:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); border-color: var(--primary); }
        .quick-action-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
        .quick-action-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--primary); }
        .quick-action-desc { font-size: 0.875rem; color: var(--text-muted); }
        
        @media (max-width: 430px) {
            .captain-grid { grid-template-columns: 1fr; }
            .quick-action { padding: 1.25rem; }
            .quick-action-icon { font-size: 2rem; }
        }
    </style>
    
    <div class="page-header">
        <div>
            <div class="page-title">⚽ Panel <span>Capitaine</span></div>
            <div class="page-breadcrumb">Panel · Capitaine · Gestion d'Équipe</div>
        </div>
    </div>
    
    <div class="captain-grid">
        <div class="quick-action" onclick="window.location='/panel/capitaine/composition'">
            <div class="quick-action-icon">📋</div>
            <div class="quick-action-title">Composition</div>
            <div class="quick-action-desc">Créer et modifier la composition de match</div>
        </div>
        
        <div class="quick-action" onclick="window.location='/panel/capitaine/tactique'">
            <div class="quick-action-icon">🎯</div>
            <div class="quick-action-title">Tactique</div>
            <div class="quick-action-desc">Formation et instructions tactiques</div>
        </div>
        
        <div class="quick-action" onclick="window.location='/panel/capitaine/joueurs'">
            <div class="quick-action-icon">👥</div>
            <div class="quick-action-title">Joueurs</div>
            <div class="quick-action-desc">Suspensions et disponibilités</div>
        </div>
    </div>
    
    <div class="grid-2">
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">📋 Composition Actuelle</h3>
            </div>
            ${currentCompo ? `
                <div style="padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 1rem;">
                    <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                        Match: <strong>${currentCompo.match || 'Non défini'}</strong>
                    </div>
                    <div style="font-size: 0.9rem; color: var(--text-muted);">
                        Créée le: ${new Date(currentCompo.timestamp).toLocaleString('fr')}
                    </div>
                </div>
                <div style="white-space: pre-wrap; font-family: var(--font-mono); font-size: 0.875rem;">
                    ${currentCompo.composition}
                </div>
            ` : `
                <div class="alert alert-info">
                    ℹ️ Aucune composition définie
                </div>
            `}
            <a href="/panel/capitaine/composition" class="btn btn-primary btn-full" style="margin-top: 1rem;">
                ${currentCompo ? '✏️ Modifier' : '➕ Créer'}
            </a>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">🎯 Tactique</h3>
            </div>
            <div style="display: grid; gap: 0.75rem; margin-bottom: 1rem;">
                <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <strong>Formation:</strong> ${currentTactic.formation}
                </div>
                <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <strong>Style:</strong> ${currentTactic.style}
                </div>
                <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px;">
                    <strong>Mentalité:</strong> ${currentTactic.mentality}
                </div>
            </div>
            <a href="/panel/capitaine/tactique" class="btn btn-primary btn-full">
                ⚙️ Modifier
            </a>
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Panel Capitaine', content, 'capitaine'));
});

// COMPOSITION
app.get('/panel/capitaine/composition', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const currentCompo = db.compositions && db.compositions.length > 0 
        ? db.compositions[db.compositions.length - 1] 
        : null;
    
    const joueurs = db.users.filter(u => 
        u.accountType === 'joueur' || 
        u.accountType === 'capitaine'
    );
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">📋 <span>Composition</span></div>
            <div class="page-breadcrumb">Panel · Capitaine · Composition</div>
        </div>
        <a href="/panel/capitaine" class="btn btn-outline">← Retour</a>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${decodeURIComponent(req.query.success)}</div>` : ''}
    
    <div class="card">
        <form action="/panel/capitaine/composition" method="POST">
            <div class="form-group">
                <label class="form-label">Match</label>
                <input type="text" name="match" class="form-control" placeholder="FTY vs Real Madrid - Championnat" value="${currentCompo ? currentCompo.match : ''}" required>
            </div>
            
            <div class="form-group">
                <label class="form-label">Composition</label>
                <textarea name="composition" class="form-control" rows="12" placeholder="Gardien: Tom
Défense:
DG: Lucas
DC: Marie
DC: Alex  
DD: Sarah
Milieu:
MC: Kevin
MC: Emma
MO: Jules
Attaque:
AG: Sophie
BU: Thomas
AD: Hugo" required>${currentCompo ? currentCompo.composition : ''}</textarea>
                <small class="text-muted">Sera affichée sur le site public</small>
            </div>
            
            <button type="submit" class="btn btn-primary btn-full">
                💾 Publier sur le Site
            </button>
        </form>
    </div>
    
    <div class="card" style="margin-top: 1.5rem;">
        <div class="card-header">
            <h3 class="card-title">👥 Joueurs Disponibles</h3>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.75rem;">
            ${joueurs.map(j => `
                <div style="padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; align-items: center; gap: 0.5rem;">
                    <div style="width: 8px; height: 8px; border-radius: 50%; background: ${j.suspended ? '#ff0050' : '#00ff88'};"></div>
                    <span style="font-size: 0.875rem;">${j.username}</span>
                    ${j.suspended ? '<span style="color: var(--danger); font-size: 0.7rem;">SUSP</span>' : ''}
                </div>
            `).join('')}
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Composition', content, 'capitaine'));
});

app.post('/panel/capitaine/composition', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const { match, composition } = req.body;
    
    if (!db.compositions) db.compositions = [];
    
    const newCompo = {
        id: Date.now().toString(),
        match,
        composition,
        moderator: req.session.user.username,
        timestamp: new Date().toISOString()
    };
    
    db.compositions.push(newCompo);
    
    if (!db.serverConfig) db.serverConfig = {};
    db.serverConfig.currentComposition = newCompo;
    
    writeDB(db);
    
    addLog('Composition créée', req.session.user.username, match, { composition }, getClientIP(req));
    
    res.redirect('/panel/capitaine/composition?success=' + encodeURIComponent('Composition publiée sur le site !'));
});

// TACTIQUE
app.get('/panel/capitaine/tactique', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const currentTactic = db.serverConfig && db.serverConfig.tactic 
        ? db.serverConfig.tactic 
        : {
            formation: '4-3-3',
            style: 'Possession Offensive',
            mentality: 'Attaque',
            instructions: []
        };
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🎯 <span>Tactique</span></div>
            <div class="page-breadcrumb">Panel · Capitaine · Tactique</div>
        </div>
        <a href="/panel/capitaine" class="btn btn-outline">← Retour</a>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${decodeURIComponent(req.query.success)}</div>` : ''}
    
    <div class="card">
        <form action="/panel/capitaine/tactique" method="POST">
            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label">Formation</label>
                    <select name="formation" class="form-control" required>
                        <option value="4-3-3" ${currentTactic.formation === '4-3-3' ? 'selected' : ''}>4-3-3</option>
                        <option value="4-4-2" ${currentTactic.formation === '4-4-2' ? 'selected' : ''}>4-4-2</option>
                        <option value="4-2-3-1" ${currentTactic.formation === '4-2-3-1' ? 'selected' : ''}>4-2-3-1</option>
                        <option value="3-5-2" ${currentTactic.formation === '3-5-2' ? 'selected' : ''}>3-5-2</option>
                        <option value="5-3-2" ${currentTactic.formation === '5-3-2' ? 'selected' : ''}>5-3-2</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Style de Jeu</label>
                    <select name="style" class="form-control" required>
                        <option value="Possession Offensive" ${currentTactic.style === 'Possession Offensive' ? 'selected' : ''}>Possession Offensive</option>
                        <option value="Contre-Attaque" ${currentTactic.style === 'Contre-Attaque' ? 'selected' : ''}>Contre-Attaque</option>
                        <option value="Pressing" ${currentTactic.style === 'Pressing' ? 'selected' : ''}>Pressing</option>
                        <option value="Défense Solide" ${currentTactic.style === 'Défense Solide' ? 'selected' : ''}>Défense Solide</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Mentalité</label>
                <select name="mentality" class="form-control" required>
                    <option value="Très Offensive" ${currentTactic.mentality === 'Très Offensive' ? 'selected' : ''}>Très Offensive</option>
                    <option value="Attaque" ${currentTactic.mentality === 'Attaque' ? 'selected' : ''}>Attaque</option>
                    <option value="Équilibrée" ${currentTactic.mentality === 'Équilibrée' ? 'selected' : ''}>Équilibrée</option>
                    <option value="Défensive" ${currentTactic.mentality === 'Défensive' ? 'selected' : ''}>Défensive</option>
                </select>
            </div>
            
            <div class="form-group">
                <label class="form-label">Instructions (une par ligne)</label>
                <textarea name="instructions" class="form-control" rows="6" placeholder="Pressing intense
Jeu court
Utilisation des couloirs
Montées des latéraux" required>${currentTactic.instructions ? currentTactic.instructions.join('\n') : ''}</textarea>
                <small class="text-muted">Affichées sur le site public</small>
            </div>
            
            <button type="submit" class="btn btn-primary btn-full">
                💾 Publier sur le Site
            </button>
        </form>
    </div>
    `;
    
    res.send(panelLayout(user, 'Tactique', content, 'capitaine'));
});

app.post('/panel/capitaine/tactique', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const { formation, style, mentality, instructions } = req.body;
    
    if (!db.serverConfig) db.serverConfig = {};
    if (!db.publicSettings) db.publicSettings = {};
    
    const instructionsArray = instructions.split('\n').filter(i => i.trim());
    
    // PATCH: Sauvegarder dans serverConfig
    db.serverConfig.tactic = {
        formation,
        style,
        mentality,
        instructions: instructionsArray
    };
    
    // PATCH: Dupliquer dans publicSettings pour affichage public
    db.publicSettings.tacticFormation = formation;
    db.publicSettings.tacticStyle = style;
    db.publicSettings.tacticMentality = mentality;
    db.publicSettings.tacticInstructions = instructionsArray;
    
    writeDB(db);
    
    const clientInfo = getClientInfo(req);
    addLog('Tactique modifiée', req.session.user.username, 'Tactique', { formation, style }, getClientIP(req), clientInfo);
    
    res.redirect('/panel/capitaine/tactique?success=' + encodeURIComponent('✅ Tactique publiée sur le site !'));
});
    
    const clientInfo = getClientInfo(req);
    addLog('Tactique modifiée', req.session.user.username, 'Tactique', { formation, style }, getClientIP(req), clientInfo);
    
    res.redirect('/panel/capitaine/tactique?success=' + encodeURIComponent('✅ Tactique publiée sur le site public !'));
});

// GESTION JOUEURS - SUSPENSIONS
app.get('/panel/capitaine/joueurs', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    const joueurs = db.users.filter(u => 
        u.accountType === 'joueur' || 
        u.accountType === 'capitaine'
    );
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">👥 Gestion <span>Joueurs</span></div>
            <div class="page-breadcrumb">Panel · Capitaine · Joueurs</div>
        </div>
        <a href="/panel/capitaine" class="btn btn-outline">← Retour</a>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${decodeURIComponent(req.query.success)}</div>` : ''}
    
    <div class="card">
        <div class="card-header">
            <h3 class="card-title">Liste des Joueurs</h3>
        </div>
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>Joueur</th>
                        <th>Statut</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${joueurs.map(j => `
                    <tr>
                        <td><strong>${j.username}</strong></td>
                        <td>
                            <span class="badge" style="background: ${j.suspended ? '#ff0050' : '#00ff88'}20; color: ${j.suspended ? '#ff0050' : '#00ff88'}">
                                ${j.suspended ? '❌ Suspendu' : '✅ Disponible'}
                            </span>
                        </td>
                        <td>
                            <form action="/panel/capitaine/joueurs/toggle-suspension" method="POST" style="display: inline;">
                                <input type="hidden" name="userId" value="${j.id}">
                                <button type="submit" class="btn btn-sm ${j.suspended ? 'btn-success' : 'btn-warning'}">
                                    ${j.suspended ? '✅ Lever suspension' : '⛔ Suspendre'}
                                </button>
                            </form>
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Joueurs', content, 'capitaine'));
});

app.post('/panel/capitaine/joueurs/toggle-suspension', isAuthenticated, hasRole('capitaine'), (req, res) => {
    const db = readDB();
    const { userId } = req.body;
    
    const joueur = db.users.find(u => u.id === userId);
    if (!joueur) {
        return res.redirect('/panel/capitaine/joueurs?error=Joueur introuvable');
    }
    
    joueur.suspended = !joueur.suspended;
    joueur.suspendedAt = joueur.suspended ? new Date().toISOString() : null;
    
    writeDB(db);
    
    addLog(
        joueur.suspended ? 'Joueur suspendu' : 'Suspension levée',
        req.session.user.username,
        joueur.username,
        {},
        getClientIP(req)
    );
    
    res.redirect('/panel/capitaine/joueurs?success=' + encodeURIComponent(
        `${joueur.username} ${joueur.suspended ? 'suspendu' : 'disponible'}`
    ));
});




// ============================================================
// 🔥 SYSTÈME COMPLET FTY CLUB PRO - TOUTES FONCTIONNALITÉS
// ============================================================

// ========== IDENTIFIANT OUBLIÉ ==========

app.get('/forgot-username', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Identifiant oublié - FTY Club</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 60px;
            max-width: 520px;
            width: 100%;
            box-shadow: 0 30px 80px rgba(0,0,0,0.3);
            animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(40px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon { 
            font-size: 80px; 
            text-align: center; 
            margin-bottom: 24px;
            animation: bounce 2s ease-in-out infinite;
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        h1 { 
            text-align: center; 
            background: linear-gradient(135deg, #6366f1, #d946ef);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 32px; 
            margin-bottom: 12px;
            font-weight: 800;
        }
        .subtitle { 
            text-align: center; 
            color: #64748b; 
            margin-bottom: 40px;
            font-size: 16px;
            line-height: 1.6;
        }
        .info { 
            background: linear-gradient(135deg, #f0f9ff 0%, #e0e7ff 100%);
            border-left: 4px solid #6366f1; 
            padding: 24px; 
            margin-bottom: 32px; 
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
        }
        .info h3 { 
            color: #6366f1; 
            font-size: 18px; 
            margin-bottom: 12px;
            font-weight: 700;
        }
        .info p { 
            color: #475569; 
            line-height: 1.8;
        }
        .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            color: white;
            padding: 20px;
            border-radius: 16px;
            text-decoration: none;
            font-weight: 700;
            font-size: 17px;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3);
        }
        .btn:hover { 
            transform: translateY(-3px);
            box-shadow: 0 20px 50px rgba(99, 102, 241, 0.4);
        }
        .btn:active {
            transform: translateY(-1px);
        }
        .back { 
            display: block; 
            text-align: center; 
            margin-top: 24px; 
            color: #6366f1; 
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s;
        }
        .back:hover { 
            color: #d946ef;
            transform: translateX(-5px);
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">🔍</div>
        <h1>Identifiant oublié ?</h1>
        <p class="subtitle">Récupérez instantanément votre identifiant via Discord</p>
        <div class="info">
            <h3>⚡ Récupération instantanée</h3>
            <p>Votre identifiant s'affichera immédiatement. Vous ne serez pas connecté automatiquement.</p>
        </div>
        <a href="/auth/discord?action=username" class="btn">
            🎮 Récupérer mon identifiant
        </a>
        <a href="/panel/login" class="back">← Retour à la connexion</a>
    </div>
</body>
</html>`);
});

app.get('/username-recovery-result', (req, res) => {
    if (!req.session.discordUser) return res.redirect('/forgot-username');
    
    const db = readDB();
    const user = db.users.find(u => u.discordId === req.session.discordUser.id);
    const discord = req.session.discordUser.username + '#' + req.session.discordUser.discriminator;
    delete req.session.discordUser;
    
    if (!user) {
        return res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Compte non trouvé</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 24px;
            padding: 60px;
            max-width: 520px;
            width: 100%;
            box-shadow: 0 30px 80px rgba(0,0,0,0.3);
            text-align: center;
            animation: slideUp 0.6s ease;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon { font-size: 80px; margin-bottom: 24px; }
        h1 { color: #ef4444; font-size: 28px; margin-bottom: 16px; font-weight: 800; }
        p { color: #64748b; margin-bottom: 20px; line-height: 1.8; }
        .tag { 
            background: #f1f5f9; 
            padding: 16px; 
            border-radius: 12px; 
            margin: 24px 0; 
            font-weight: 700; 
            color: #5865F2;
            font-size: 18px;
        }
        .btn { 
            display: inline-block; 
            background: linear-gradient(135deg, #6366f1, #d946ef);
            color: white; 
            padding: 16px 36px; 
            border-radius: 12px; 
            text-decoration: none; 
            font-weight: 700;
            transition: all 0.3s;
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3);
        }
        .btn:hover { transform: translateY(-2px); }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">❌</div>
        <h1>Aucun compte trouvé</h1>
        <p>Aucun compte FTY lié à :</p>
        <div class="tag">${discord}</div>
        <p>Contactez un administrateur pour lier votre Discord.</p>
        <a href="/panel/login" class="btn">Retour à la connexion</a>
    </div>
</body>
</html>`);
    }
    
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Identifiant récupéré !</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 24px;
            padding: 60px;
            max-width: 640px;
            width: 100%;
            box-shadow: 0 30px 80px rgba(0,0,0,0.3);
            animation: slideUp 0.6s ease;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon { 
            font-size: 80px; 
            text-align: center; 
            margin-bottom: 24px;
            animation: success 0.8s ease;
        }
        @keyframes success {
            0% { opacity: 0; transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }
        h1 { 
            text-align: center;
            background: linear-gradient(135deg, #10b981, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 32px; 
            margin-bottom: 32px;
            font-weight: 800;
        }
        .username-box {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            color: white;
            padding: 40px;
            border-radius: 20px;
            text-align: center;
            margin: 32px 0;
            box-shadow: 0 20px 50px rgba(99, 102, 241, 0.4);
            animation: glow 2s ease-in-out infinite;
        }
        @keyframes glow {
            0%, 100% { box-shadow: 0 20px 50px rgba(99, 102, 241, 0.4); }
            50% { box-shadow: 0 20px 60px rgba(217, 70, 239, 0.6); }
        }
        .username-label { font-size: 14px; opacity: 0.9; margin-bottom: 12px; letter-spacing: 2px; }
        .username-value { 
            font-size: 42px; 
            font-weight: 900; 
            letter-spacing: 1px;
            text-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }
        .warning {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-left: 4px solid #f59e0b;
            padding: 24px;
            margin: 24px 0;
            border-radius: 16px;
            color: #92400e;
            line-height: 1.8;
        }
        .btn {
            display: block;
            background: linear-gradient(135deg, #6366f1, #d946ef);
            color: white;
            padding: 20px;
            border-radius: 16px;
            text-decoration: none;
            font-weight: 700;
            font-size: 18px;
            text-align: center;
            transition: all 0.3s;
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3);
        }
        .btn:hover { 
            transform: translateY(-3px); 
            box-shadow: 0 20px 50px rgba(99, 102, 241, 0.5);
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✅</div>
        <h1>Identifiant récupéré !</h1>
        <div class="username-box">
            <div class="username-label">VOTRE IDENTIFIANT FTY</div>
            <div class="username-value">${user.username}</div>
        </div>
        <div class="warning">
            <p>💡 <strong>Notez-le bien !</strong> Utilisez cet identifiant avec votre mot de passe pour vous connecter.</p>
        </div>
        <a href="/panel/login" class="btn">🔐 Se connecter maintenant</a>
    </div>
</body>
</html>`);
});

// ========== MOT DE PASSE OUBLIÉ ==========

app.get('/forgot-password', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Mot de passe oublié</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card { 
            background: white; 
            border-radius: 24px; 
            padding: 60px; 
            max-width: 520px; 
            width: 100%; 
            box-shadow: 0 30px 80px rgba(0,0,0,0.3);
            animation: slideUp 0.6s ease;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon { font-size: 80px; text-align: center; margin-bottom: 24px; }
        h1 { 
            text-align: center;
            background: linear-gradient(135deg, #6366f1, #d946ef);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 32px; 
            margin-bottom: 12px;
            font-weight: 800;
        }
        .subtitle { text-align: center; color: #64748b; margin-bottom: 40px; font-size: 16px; }
        .info { 
            background: linear-gradient(135deg, #f0f9ff, #e0e7ff);
            border-left: 4px solid #6366f1; 
            padding: 24px; 
            margin-bottom: 32px; 
            border-radius: 16px;
        }
        .info h3 { color: #6366f1; font-size: 18px; margin-bottom: 12px; font-weight: 700; }
        .info ol { color: #475569; padding-left: 24px; line-height: 2; }
        .btn { 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 12px; 
            background: linear-gradient(135deg, #6366f1, #d946ef);
            color: white; 
            padding: 20px; 
            border-radius: 16px; 
            text-decoration: none; 
            font-weight: 700;
            font-size: 17px;
            transition: all 0.3s;
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3);
        }
        .btn:hover { transform: translateY(-3px); box-shadow: 0 20px 50px rgba(99, 102, 241, 0.5); }
        .back { display: block; text-align: center; margin-top: 24px; color: #6366f1; text-decoration: none; font-weight: 600; }
        .back:hover { color: #d946ef; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">🔐</div>
        <h1>Mot de passe oublié ?</h1>
        <p class="subtitle">Demandez une réinitialisation sécurisée</p>
        <div class="info">
            <h3>📋 Procédure</h3>
            <ol>
                <li>Connectez-vous avec Discord</li>
                <li>Confirmez votre demande</li>
                <li>Un admin validera</li>
                <li>Recevez un MDP temporaire</li>
                <li>Changez-le à la connexion</li>
            </ol>
        </div>
        <a href="/auth/discord?action=reset" class="btn">🎮 Continuer avec Discord</a>
        <a href="/panel/login" class="back">← Retour</a>
    </div>
</body>
</html>`);
});

app.get('/password-reset-request', (req, res) => {
    if (!req.session.discordUser) return res.redirect('/forgot-password');
    
    const db = readDB();
    const user = db.users.find(u => u.discordId === req.session.discordUser.id);
    
    if (!user) {
        const discord = req.session.discordUser.username + '#' + req.session.discordUser.discriminator;
        delete req.session.discordUser;
        return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Compte non trouvé</title><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #6366f1, #d946ef); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { background: white; border-radius: 24px; padding: 60px; max-width: 520px; width: 100%; box-shadow: 0 30px 80px rgba(0,0,0,0.3); text-align: center; }
.icon { font-size: 80px; margin-bottom: 24px; }
h1 { color: #ef4444; font-size: 28px; margin-bottom: 16px; font-weight: 800; }
p { color: #64748b; margin-bottom: 20px; }
.tag { background: #f1f5f9; padding: 16px; border-radius: 12px; margin: 24px 0; font-weight: 700; color: #5865F2; }
.btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #d946ef); color: white; padding: 16px 36px; border-radius: 12px; text-decoration: none; font-weight: 700; }
</style></head><body><div class="card">
<div class="icon">❌</div><h1>Compte non trouvé</h1><p>Aucun compte FTY lié à :</p><div class="tag">${discord}</div><p>Contactez un admin.</p>
<a href="/panel/login" class="btn">Retour</a></div></body></html>`);
    }
    
    if (!db.resetRequests) db.resetRequests = [];
    const pending = db.resetRequests.find(r => r.userId === user.id && r.status === 'pending');
    
    if (pending) {
        delete req.session.discordUser;
        return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Demande en cours</title><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #6366f1, #d946ef); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { background: white; border-radius: 24px; padding: 60px; max-width: 520px; width: 100%; box-shadow: 0 30px 80px rgba(0,0,0,0.3); text-align: center; }
.icon { font-size: 80px; margin-bottom: 24px; }
h1 { color: #f59e0b; font-size: 28px; margin-bottom: 16px; font-weight: 800; }
p { color: #64748b; margin-bottom: 20px; line-height: 1.8; }
.btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #d946ef); color: white; padding: 16px 36px; border-radius: 12px; text-decoration: none; font-weight: 700; }
</style></head><body><div class="card">
<div class="icon">⏳</div><h1>Demande en cours</h1><p>Vous avez déjà une demande en attente.</p><p>Un admin la traitera prochainement.</p>
<a href="/panel/login" class="btn">Retour</a></div></body></html>`);
    }
    
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Confirmer la demande</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #6366f1, #d946ef); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: white; border-radius: 24px; padding: 60px; max-width: 640px; width: 100%; box-shadow: 0 30px 80px rgba(0,0,0,0.3); }
        .icon { font-size: 80px; text-align: center; margin-bottom: 24px; }
        h1 { text-align: center; background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 32px; margin-bottom: 32px; font-weight: 800; }
        .info { background: #f8fafc; border-radius: 16px; padding: 28px; margin-bottom: 32px; }
        .info h3 { color: #6366f1; font-size: 18px; margin-bottom: 16px; font-weight: 700; }
        .row { display: flex; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid #e2e8f0; }
        .row:last-child { border-bottom: none; }
        .label { color: #64748b; font-weight: 600; }
        .value { color: #1e293b; font-weight: 700; }
        .warning { background: linear-gradient(135deg, #fef3c7, #fde68a); border-left: 4px solid #f59e0b; padding: 24px; margin-bottom: 32px; border-radius: 16px; color: #92400e; line-height: 1.8; }
        .btns { display: flex; gap: 16px; }
        .btn { flex: 1; padding: 20px; border-radius: 16px; border: none; font-weight: 700; font-size: 17px; cursor: pointer; transition: all 0.3s; text-align: center; text-decoration: none; display: block; }
        .btn-primary { background: linear-gradient(135deg, #6366f1, #d946ef); color: white; box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3); }
        .btn-primary:hover { transform: translateY(-3px); box-shadow: 0 20px 50px rgba(99, 102, 241, 0.5); }
        .btn-secondary { background: #e2e8f0; color: #475569; }
        .btn-secondary:hover { background: #cbd5e1; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✅</div>
        <h1>Confirmer la demande</h1>
        <div class="info">
            <h3>📋 Informations du compte</h3>
            <div class="row">
                <span class="label">Identifiant FTY</span>
                <span class="value">${user.username}</span>
            </div>
            <div class="row">
                <span class="label">Discord</span>
                <span class="value">${req.session.discordUser.username}#${req.session.discordUser.discriminator}</span>
            </div>
        </div>
        <div class="warning">
            <p><strong>⚠️ Important :</strong> Un admin validera et générera un mot de passe temporaire.</p>
        </div>
        <form action="/password-reset-submit" method="POST">
            <div class="btns">
                <button type="submit" class="btn btn-primary">✅ Envoyer la demande</button>
                <a href="/panel/login" class="btn btn-secondary">❌ Annuler</a>
            </div>
        </form>
    </div>
</body>
</html>`);
});

app.post('/password-reset-submit', (req, res) => {
    if (!req.session.discordUser) return res.redirect('/forgot-password');
    
    const db = readDB();
    const user = db.users.find(u => u.discordId === req.session.discordUser.id);
    
    if (!user) return res.redirect('/forgot-password');
    
    const resetRequest = {
        id: `reset_${Date.now()}`,
        userId: user.id,
        username: user.username,
        discordId: user.discordId,
        discordUsername: req.session.discordUser.username,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
        tempPassword: null
    };
    
    if (!db.resetRequests) db.resetRequests = [];
    db.resetRequests.push(resetRequest);
    writeDB(db);
    addLog('Demande reset MDP', user.username, 'Reset', {}, getClientIP(req));
    
    delete req.session.discordUser;
    
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Demande envoyée</title><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #6366f1, #d946ef); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { background: white; border-radius: 24px; padding: 60px; max-width: 520px; width: 100%; box-shadow: 0 30px 80px rgba(0,0,0,0.3); text-align: center; }
.icon { font-size: 80px; margin-bottom: 24px; animation: success 0.8s ease; }
@keyframes success { 0% { transform: scale(0); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
h1 { background: linear-gradient(135deg, #10b981, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 32px; margin-bottom: 16px; font-weight: 800; }
p { color: #64748b; margin-bottom: 16px; line-height: 1.8; }
.info { background: linear-gradient(135deg, #f0f9ff, #e0e7ff); padding: 24px; border-radius: 16px; margin: 28px 0; }
.info p { color: #475569; font-size: 15px; }
.btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #d946ef); color: white; padding: 18px 40px; border-radius: 12px; text-decoration: none; font-weight: 700; margin-top: 20px; box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3); transition: all 0.3s; }
.btn:hover { transform: translateY(-3px); }
</style></head><body><div class="card">
<div class="icon">✉️</div><h1>Demande envoyée !</h1><p>Votre demande a été transmise aux administrateurs.</p>
<div class="info"><p><strong>Prochaine étape :</strong> Un admin validera et générera un mot de passe temporaire.</p></div>
<a href="/panel/login" class="btn">Retour à la connexion</a></div></body></html>`);
});

// ========== GESTION ADMIN RESET MDP ==========

app.get('/panel/admin/reset-requests', isAuthenticated, hasRole('administrateur'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    if (!db.resetRequests) db.resetRequests = [];
    const pending = db.resetRequests.filter(r => r.status === 'pending');
    const processed = db.resetRequests.filter(r => r.status !== 'pending').slice(0, 20);
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🔐 Demandes de <span>Reset MDP</span></div>
            <div class="page-breadcrumb">Panel · Admin · Reset MDP</div>
        </div>
        <a href="/panel/admin" class="btn btn-outline">← Retour</a>
    </div>
    
    ${req.query.success ? '<div class="alert alert-success">✅ ' + decodeURIComponent(req.query.success) + '</div>' : ''}
    
    <div class="card" style="background: linear-gradient(135deg, #f0f9ff 0%, #e0e7ff 100%); border: 2px solid #6366f1;">
        <div class="card-header">
            <h3>⏳ En attente (${pending.length})</h3>
        </div>
        ${pending.length === 0 ? '<div style="padding:50px;text-align:center;color:#64748b"><div style="font-size:64px;margin-bottom:16px">✅</div><p style="font-size:18px;font-weight:600">Aucune demande en attente</p></div>' : `
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>👤 Utilisateur</th>
                        <th>💬 Discord</th>
                        <th>📅 Date demande</th>
                        <th>⚡ Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${pending.map(r => `
                    <tr>
                        <td><strong style="color:#6366f1">${r.username}</strong></td>
                        <td>${r.discordUsername}</td>
                        <td>${new Date(r.requestedAt).toLocaleString('fr-FR')}</td>
                        <td>
                            <form action="/panel/admin/reset-approve" method="POST" style="display:inline">
                                <input type="hidden" name="requestId" value="${r.id}">
                                <button class="btn btn-sm btn-success" style="background: linear-gradient(135deg, #10b981, #6366f1); border: none; padding: 8px 16px; border-radius: 8px; color: white; font-weight: 600; cursor: pointer;">✅ Approuver</button>
                            </form>
                            <form action="/panel/admin/reset-reject" method="POST" style="display:inline;margin-left:12px">
                                <input type="hidden" name="requestId" value="${r.id}">
                                <button class="btn btn-sm btn-danger" style="background: linear-gradient(135deg, #ef4444, #dc2626); border: none; padding: 8px 16px; border-radius: 8px; color: white; font-weight: 600; cursor: pointer;">❌ Refuser</button>
                            </form>
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        `}
    </div>
    
    <div class="card" style="margin-top:32px">
        <div class="card-header"><h3>📜 Historique récent</h3></div>
        ${processed.length === 0 ? '<div style="padding:40px;text-align:center;color:#94a3b8">Aucun historique</div>' : `
        <div class="table-responsive">
            <table class="table">
                <thead>
                    <tr>
                        <th>Utilisateur</th>
                        <th>Statut</th>
                        <th>Approuvé par</th>
                        <th>MDP temporaire</th>
                    </tr>
                </thead>
                <tbody>
                    ${processed.map(r => `
                    <tr>
                        <td>${r.username}</td>
                        <td><span class="badge" style="background:${r.status === 'approved' ? 'linear-gradient(135deg, #10b981, #6366f1)' : 'linear-gradient(135deg, #ef4444, #dc2626)'};color:white;padding:6px 12px;border-radius:8px;font-weight:600">${r.status === 'approved' ? '✅ Approuvé' : '❌ Refusé'}</span></td>
                        <td>${r.approvedBy || '-'}</td>
                        <td>${r.tempPassword ? '<code style="background:#f1f5f9;padding:6px 12px;border-radius:6px;font-weight:700;color:#6366f1">' + r.tempPassword + '</code>' : '-'}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        `}
    </div>
    `;
    
    res.send(panelLayout(user, 'Reset MDP', content, 'administrateur'));
});

app.post('/panel/admin/reset-approve', isAuthenticated, hasRole('administrateur'), (req, res) => {
    const db = readDB();
    const { requestId } = req.body;
    const request = db.resetRequests.find(r => r.id === requestId);
    
    if (!request || request.status !== 'pending') {
        return res.redirect('/panel/admin/reset-requests?error=Demande introuvable');
    }
    
    const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
    const user = db.users.find(u => u.id === request.userId);
    
    if (user) {
        user.password = hashPassword(tempPassword);
        user.mustChangePassword = true;
    }
    
    request.status = 'approved';
    request.approvedBy = req.session.user.username;
    request.approvedAt = new Date().toISOString();
    request.tempPassword = tempPassword;
    
    writeDB(db);
    addLog('Reset approuvé', req.session.user.username, request.username, { tempPassword }, getClientIP(req));
    
    res.redirect('/panel/admin/reset-requests?success=' + encodeURIComponent(`✅ MDP temporaire généré : ${tempPassword}`));
});

app.post('/panel/admin/reset-reject', isAuthenticated, hasRole('administrateur'), (req, res) => {
    const db = readDB();
    const { requestId } = req.body;
    const request = db.resetRequests.find(r => r.id === requestId);
    
    if (!request || request.status !== 'pending') {
        return res.redirect('/panel/admin/reset-requests?error=Demande introuvable');
    }
    
    request.status = 'rejected';
    request.approvedBy = req.session.user.username;
    request.approvedAt = new Date().toISOString();
    
    writeDB(db);
    addLog('Reset refusé', req.session.user.username, request.username, {}, getClientIP(req));
    
    res.redirect('/panel/admin/reset-requests?success=' + encodeURIComponent('Demande refusée'));
});

// ========== GUIDE INTERACTIF OBLIGATOIRE ==========

function requireTutorial(req, res, next) {
    const user = req.session.user;
    if (!user) return res.redirect('/panel/login');
    if (!user.hasCompletedTutorial) return res.redirect('/panel/tutorial');
    next();
}

app.get('/panel/tutorial', isAuthenticated, (req, res) => {
    const user = req.session.user;
    if (user.hasCompletedTutorial) return res.redirect('/panel');
    
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Bienvenue - FTY Club</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 920px; margin: 0 auto; }
        .header { 
            text-align: center; 
            color: white; 
            margin-bottom: 48px; 
            animation: fadeIn 0.8s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .header h1 { 
            font-size: 52px; 
            margin-bottom: 12px;
            font-weight: 900;
            text-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .header p { font-size: 20px; opacity: 0.95; font-weight: 500; }
        .card {
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(20px);
            border-radius: 28px;
            padding: 60px;
            box-shadow: 0 30px 80px rgba(0,0,0,0.4);
            margin-bottom: 32px;
            display: none;
            animation: slideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateX(50px); }
            to { opacity: 1; transform: translateX(0); }
        }
        .card.active { display: block; }
        .steps { 
            display: flex; 
            justify-content: center; 
            gap: 20px; 
            margin-bottom: 48px;
        }
        .step { 
            width: 16px; 
            height: 16px; 
            border-radius: 50%; 
            background: rgba(255,255,255,0.3);
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: pointer;
        }
        .step.active { 
            background: white;
            transform: scale(1.6);
            box-shadow: 0 0 20px rgba(255,255,255,0.8);
        }
        .icon { 
            font-size: 96px; 
            text-align: center; 
            margin-bottom: 32px;
            animation: bounce 2s ease-in-out infinite;
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-15px); }
        }
        h2 { 
            background: linear-gradient(135deg, #6366f1, #d946ef);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 40px; 
            text-align: center; 
            margin-bottom: 24px;
            font-weight: 900;
        }
        .features { margin: 40px 0; }
        .feature {
            display: flex;
            align-items: start;
            gap: 24px;
            padding: 24px;
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-radius: 16px;
            margin-bottom: 16px;
            transition: all 0.3s;
        }
        .feature:hover {
            transform: translateX(8px);
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.2);
        }
        .feature-icon { 
            font-size: 40px; 
            flex-shrink: 0;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
        }
        .feature-content h3 { 
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 20px; 
            margin-bottom: 8px;
            font-weight: 700;
        }
        .feature-content p { color: #64748b; line-height: 1.7; }
        .btns { display: flex; gap: 20px; margin-top: 48px; }
        .btn {
            flex: 1;
            padding: 22px;
            border-radius: 16px;
            border: none;
            font-weight: 700;
            font-size: 18px;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn-primary { 
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
            color: white;
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.4);
        }
        .btn-primary:hover { 
            transform: translateY(-4px);
            box-shadow: 0 20px 50px rgba(99, 102, 241, 0.6);
        }
        .btn-secondary { 
            background: #e2e8f0;
            color: #475569;
        }
        .btn-secondary:hover { 
            background: #cbd5e1;
            transform: translateY(-2px);
        }
        .role-badge {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 24px;
            font-weight: 700;
            margin: 24px auto;
            display: block;
            text-align: center;
            max-width: 280px;
            font-size: 18px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚽ Bienvenue sur FTY Club !</h1>
            <p>Découvrez toutes les fonctionnalités de votre panel</p>
        </div>
        
        <div class="steps">
            <div class="step active"></div>
            <div class="step"></div>
            <div class="step"></div>
            <div class="step"></div>
        </div>
        
        <div class="card active" data-step="1">
            <div class="icon">👋</div>
            <h2>Bienvenue ${user.firstName || user.username} !</h2>
            <p style="text-align: center; color: #64748b; font-size: 19px; margin-bottom: 32px;">
                Vous êtes membre FTY en tant que :
            </p>
            <div class="role-badge" style="background: ${ROLE_COLORS[user.role]}; color: white;">
                ${ROLE_LABELS[user.role]}
            </div>
            <p style="text-align: center; color: #64748b; margin-top: 32px; font-size: 17px; line-height: 1.8;">
                Ce guide rapide présente les principales fonctionnalités de votre panel. Prenez 2 minutes pour le découvrir !
            </p>
            <div class="btns">
                <button class="btn btn-primary" onclick="next()">Commencer le guide →</button>
            </div>
        </div>
        
        <div class="card" data-step="2">
            <div class="icon">🧭</div>
            <h2>Navigation du Panel</h2>
            <div class="features">
                <div class="feature">
                    <div class="feature-icon">🏠</div>
                    <div class="feature-content">
                        <h3>Tableau de bord</h3>
                        <p>Vue d'ensemble de votre activité et accès rapide à toutes les sections</p>
                    </div>
                </div>
                <div class="feature">
                    <div class="feature-icon">📋</div>
                    <div class="feature-content">
                        <h3>Sections thématiques</h3>
                        <p>Chaque section est organisée par thème pour une navigation intuitive</p>
                    </div>
                </div>
                <div class="feature">
                    <div class="feature-icon">👤</div>
                    <div class="feature-content">
                        <h3>Profil utilisateur</h3>
                        <p>Personnalisez vos informations, votre thème et vos préférences</p>
                    </div>
                </div>
            </div>
            <div class="btns">
                <button class="btn btn-secondary" onclick="prev()">← Retour</button>
                <button class="btn btn-primary" onclick="next()">Suivant →</button>
            </div>
        </div>
        
        <div class="card" data-step="3">
            <div class="icon">⚙️</div>
            <h2>Vos Fonctionnalités</h2>
            <p style="text-align: center; color: #64748b; margin-bottom: 32px; font-size: 18px;">
                En tant que <strong style="color: #6366f1;">${ROLE_LABELS[user.role]}</strong>, vous avez accès à :
            </p>
            <div class="features">
                ${HIERARCHY[user.role] >= HIERARCHY['owner'] ? `
                <div class="feature">
                    <div class="feature-icon">👑</div>
                    <div class="feature-content">
                        <h3>Gestion complète</h3>
                        <p>Accès total à tous les paramètres et configurations du club</p>
                    </div>
                </div>
                ` : ''}
                ${HIERARCHY[user.role] >= HIERARCHY['administrateur'] ? `
                <div class="feature">
                    <div class="feature-icon">🛡️</div>
                    <div class="feature-content">
                        <h3>Administration</h3>
                        <p>Gestion des utilisateurs, sanctions, logs et demandes de reset</p>
                    </div>
                </div>
                ` : ''}
                <div class="feature">
                    <div class="feature-icon">👤</div>
                    <div class="feature-content">
                        <h3>Profil personnel</h3>
                        <p>Personnalisez votre expérience et gérez vos paramètres</p>
                    </div>
                </div>
            </div>
            <div class="btns">
                <button class="btn btn-secondary" onclick="prev()">← Retour</button>
                <button class="btn btn-primary" onclick="next()">Suivant →</button>
            </div>
        </div>
        
        <div class="card" data-step="4">
            <div class="icon">🚀</div>
            <h2>Vous êtes prêt !</h2>
            <p style="text-align: center; color: #64748b; font-size: 19px; margin-bottom: 36px;">
                Vous connaissez maintenant l'essentiel du panel FTY Club
            </p>
            <div class="features">
                <div class="feature">
                    <div class="feature-icon">💡</div>
                    <div class="feature-content">
                        <h3>Besoin d'aide ?</h3>
                        <p>Utilisez le système de tickets pour contacter le support</p>
                    </div>
                </div>
                <div class="feature">
                    <div class="feature-icon">🌓</div>
                    <div class="feature-content">
                        <h3>Thème sombre/clair</h3>
                        <p>Changez le thème dans votre profil pour un confort optimal</p>
                    </div>
                </div>
            </div>
            <form action="/panel/tutorial/complete" method="POST">
                <div class="btns">
                    <button type="button" class="btn btn-secondary" onclick="prev()">← Retour</button>
                    <button type="submit" class="btn btn-primary">✅ Terminer et accéder au panel</button>
                </div>
            </form>
        </div>
    </div>
    
    <script>
        let current = 1;
        
        function update() {
            document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
            document.querySelector('.card[data-step="' + current + '"]').classList.add('active');
            document.querySelectorAll('.step').forEach((s, i) => {
                s.classList.toggle('active', i < current);
            });
        }
        
        function next() {
            if (current < 4) {
                current++;
                update();
            }
        }
        
        function prev() {
            if (current > 1) {
                current--;
                update();
            }
        }
    </script>
</body>
</html>`);
});

app.post('/panel/tutorial/complete', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.session.user.id);
    
    if (user) {
        user.hasCompletedTutorial = true;
        req.session.user.hasCompletedTutorial = true;
        writeDB(db);
        addLog('Tutorial complété', user.username, 'Tutorial', {}, getClientIP(req));
    }
    
    res.redirect('/panel');
});

// Modifier route /panel pour utiliser requireTutorial
const panelRouteIndex = app._router.stack.findIndex(
    layer => layer.route && layer.route.path === '/panel' && 
    layer.route.methods.get && 
    layer.route.stack.length > 0
);

if (panelRouteIndex !== -1) {
    const originalHandlers = app._router.stack[panelRouteIndex].route.stack.map(s => s.handle);
    app._router.stack.splice(panelRouteIndex, 1);
    
    app.get('/panel', isAuthenticated, requireTutorial, ...originalHandlers);
}

// ========== PAGES PUBLIQUES ==========

app.get('/boutique', (req, res) => {
    res.send(publicLayout('Boutique', `
    <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); padding: 120px 20px; text-align: center; color: white;">
        <h1 style="font-size: 56px; margin-bottom: 24px; font-weight: 900; text-shadow: 0 4px 20px rgba(0,0,0,0.3);">🛍️ Boutique FTY Club</h1>
        <p style="font-size: 22px; opacity: 0.95; font-weight: 500;">Merchandising officiel - Bientôt disponible</p>
    </div>
    <div style="max-width: 1200px; margin: 80px auto; padding: 0 20px;">
        <div style="text-align: center; margin-bottom: 80px;">
            <h2 style="font-size: 44px; background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 24px; font-weight: 900;">Produits à venir</h2>
            <p style="color: #64748b; font-size: 20px; font-weight: 500;">La boutique officielle sera bientôt lancée</p>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 40px;">
            <div style="background: white; border-radius: 24px; padding: 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; transition: all 0.3s; cursor: pointer;" onmouseover="this.style.transform='translateY(-10px)'" onmouseout="this.style.transform='translateY(0)'">
                <div style="font-size: 80px; margin-bottom: 24px;">👕</div>
                <h3 style="background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 28px; margin-bottom: 16px; font-weight: 800;">Maillots officiels</h3>
                <p style="color: #64748b; line-height: 1.8; font-size: 16px;">Domicile, extérieur et third kit avec personnalisation</p>
            </div>
            <div style="background: white; border-radius: 24px; padding: 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; transition: all 0.3s; cursor: pointer;" onmouseover="this.style.transform='translateY(-10px)'" onmouseout="this.style.transform='translateY(0)'">
                <div style="font-size: 80px; margin-bottom: 24px;">🧢</div>
                <h3 style="background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 28px; margin-bottom: 16px; font-weight: 800;">Accessoires</h3>
                <p style="color: #64748b; line-height: 1.8; font-size: 16px;">Casquettes, écharpes et goodies exclusifs</p>
            </div>
            <div style="background: white; border-radius: 24px; padding: 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; transition: all 0.3s; cursor: pointer;" onmouseover="this.style.transform='translateY(-10px)'" onmouseout="this.style.transform='translateY(0)'">
                <div style="font-size: 80px; margin-bottom: 24px;">🎮</div>
                <h3 style="background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 28px; margin-bottom: 16px; font-weight: 800;">Gaming</h3>
                <p style="color: #64748b; line-height: 1.8; font-size: 16px;">Périphériques et équipements gaming FTY</p>
            </div>
        </div>
    </div>
    `));
});

app.get('/partenaires', (req, res) => {
    res.send(publicLayout('Partenaires', `
    <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); padding: 120px 20px; text-align: center; color: white;">
        <h1 style="font-size: 56px; margin-bottom: 24px; font-weight: 900; text-shadow: 0 4px 20px rgba(0,0,0,0.3);">🤝 Nos Partenaires</h1>
        <p style="font-size: 22px; opacity: 0.95; font-weight: 500;">Ils soutiennent FTY Club dans son développement</p>
    </div>
    <div style="max-width: 1200px; margin: 80px auto; padding: 0 20px;">
        <div style="text-align: center; margin-bottom: 80px;">
            <h2 style="font-size: 44px; background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 24px; font-weight: 900;">Partenaires officiels</h2>
            <p style="color: #64748b; font-size: 20px; font-weight: 500;">Ensemble, nous construisons l'avenir de l'e-sport</p>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 40px;">
            ${['🏢 Principal', '🎮 Gaming', '⚡ Énergie', '👕 Équipementier'].map(p => `
            <div style="background: white; border-radius: 24px; padding: 50px; box-shadow: 0 20px 60px rgba(0,0,0,0.1); text-align: center; transition: all 0.3s;" onmouseover="this.style.transform='translateY(-10px)'" onmouseout="this.style.transform='translateY(0)'">
                <div style="font-size: 64px; margin-bottom: 20px;">${p.split(' ')[0]}</div>
                <h3 style="background: linear-gradient(135deg, #6366f1, #d946ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 24px; font-weight: 800;">${p.split(' ').slice(1).join(' ')}</h3>
                <p style="color: #94a3b8; margin-top: 12px;">À venir</p>
            </div>
            `).join('')}
        </div>
    </div>
    `));
});

app.get('/contact', (req, res) => {
    res.send(publicLayout('Contact', `
    <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); padding: 120px 20px; text-align: center; color: white;">
        <h1 style="font-size: 56px; margin-bottom: 24px; font-weight: 900; text-shadow: 0 4px 20px rgba(0,0,0,0.3);">📧 Contactez-nous</h1>
        <p style="font-size: 22px; opacity: 0.95; font-weight: 500;">Une question ? Nous sommes à votre écoute</p>
    </div>
    <div style="max-width: 800px; margin: 80px auto; padding: 0 20px;">
        <div style="background: white; border-radius: 28px; padding: 60px; box-shadow: 0 30px 80px rgba(0,0,0,0.15);">
            <form action="/contact/submit" method="POST">
                <div style="margin-bottom: 28px;">
                    <label style="display: block; color: #1e293b; font-weight: 700; margin-bottom: 12px; font-size: 16px;">Nom complet</label>
                    <input type="text" name="name" required style="width: 100%; padding: 18px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px; transition: all 0.3s;" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="margin-bottom: 28px;">
                    <label style="display: block; color: #1e293b; font-weight: 700; margin-bottom: 12px; font-size: 16px;">Email</label>
                    <input type="email" name="email" required style="width: 100%; padding: 18px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px; transition: all 0.3s;" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="margin-bottom: 28px;">
                    <label style="display: block; color: #1e293b; font-weight: 700; margin-bottom: 12px; font-size: 16px;">Sujet</label>
                    <select name="subject" required style="width: 100%; padding: 18px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px;">
                        <option value="">Choisissez un sujet</option>
                        <option value="partenariat">Partenariat</option>
                        <option value="recrutement">Recrutement</option>
                        <option value="media">Média / Presse</option>
                        <option value="autre">Autre</option>
                    </select>
                </div>
                <div style="margin-bottom: 28px;">
                    <label style="display: block; color: #1e293b; font-weight: 700; margin-bottom: 12px; font-size: 16px;">Message</label>
                    <textarea name="message" required rows="6" style="width: 100%; padding: 18px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 16px; resize: vertical; transition: all 0.3s;" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'"></textarea>
                </div>
                <button type="submit" style="width: 100%; padding: 22px; background: linear-gradient(135deg, #6366f1, #d946ef); color: white; border: none; border-radius: 16px; font-weight: 700; font-size: 18px; cursor: pointer; transition: all 0.3s; box-shadow: 0 10px 30px rgba(99, 102, 241, 0.4);" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 20px 50px rgba(99, 102, 241, 0.6)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 10px 30px rgba(99, 102, 241, 0.4)'">
                    📨 Envoyer le message
                </button>
            </form>
        </div>
    </div>
    `));
});

app.post('/contact/submit', (req, res) => {
    const { name, email, subject, message } = req.body;
    const db = readDB();
    
    if (!db.contactMessages) db.contactMessages = [];
    db.contactMessages.push({
        id: `contact_${Date.now()}`,
        name, email, subject, message,
        submittedAt: new Date().toISOString(),
        status: 'nouveau'
    });
    
    writeDB(db);
    
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Message envoyé</title><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', sans-serif; background: linear-gradient(135deg, #6366f1, #d946ef); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.card { background: white; border-radius: 24px; padding: 60px; max-width: 520px; width: 100%; box-shadow: 0 30px 80px rgba(0,0,0,0.3); text-align: center; }
.icon { font-size: 96px; margin-bottom: 32px; }
h1 { background: linear-gradient(135deg, #10b981, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 36px; margin-bottom: 20px; font-weight: 900; }
p { color: #64748b; margin-bottom: 32px; line-height: 1.8; font-size: 17px; }
.btn { display: inline-block; padding: 18px 40px; background: linear-gradient(135deg, #6366f1, #d946ef); color: white; border-radius: 12px; text-decoration: none; font-weight: 700; box-shadow: 0 10px 30px rgba(99, 102, 241, 0.4); transition: all 0.3s; }
.btn:hover { transform: translateY(-3px); }
</style></head><body><div class="card">
<div class="icon">✅</div><h1>Message envoyé !</h1><p>Merci pour votre message. Nous vous répondrons dans les plus brefs délais.</p>
<a href="/" class="btn">Retour à l'accueil</a></div></body></html>`);
});

// ============================================================
// ===       API POLL NOTIFICATIONS (pour le push JS)       ===
// ============================================================
app.get('/api/notifications/poll', isAuthenticated, (req, res) => {
    const db = readDB();
    const u = req.session.user.username;
    const notifs = (db.notifications || []).filter(n => n.targetUsername === u && !n.read).length;
    const msgs = (db.messages || []).filter(m => m.to === u && !m.read).length;
    res.json({ notifs, msgs });
});

// ============================================================
// ===              PAGE NOTIFICATIONS                       ===
// ============================================================
app.get('/panel/notifications', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const allNotifs = (db.notifications || []).filter(n => n.targetUsername === user.username);
    // Marquer toutes comme lues
    allNotifs.forEach(n => { n.read = true; });
    writeDB(db);
    const content = `
    <div class="page-header">
        <div><div class="page-title">🔔 <span>Notifications</span></div><div class="page-breadcrumb">${allNotifs.length} notification(s)</div></div>
        ${allNotifs.length > 0 ? `<form method="POST" action="/panel/notifications/clear"><button class="btn btn-sm btn-danger">🗑️ Tout effacer</button></form>` : ''}
    </div>
    ${allNotifs.length === 0 ? `
        <div class="card" style="text-align:center;padding:3rem;">
            <div style="font-size:4rem;margin-bottom:1rem;">🔔</div>
            <p style="color:var(--text-muted);">Aucune notification pour le moment</p>
        </div>` :
    allNotifs.map(n => `
        <div class="card" style="margin-bottom:0.75rem;border-left:4px solid ${n.priority==='high'?'#ef4444':n.priority==='warning'?'#f59e0b':'var(--primary)'};">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:1rem;">
                <div style="flex:1;">
                    <div style="font-weight:700;margin-bottom:0.25rem;">${n.title}</div>
                    <div style="color:var(--text-secondary);font-size:0.9rem;line-height:1.5;">${n.message}</div>
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${new Date(n.createdAt).toLocaleString('fr-FR')}</div>
            </div>
        </div>`).join('')}`;
    res.send(panelLayout(user, 'Notifications', content, 'notifications'));
});

app.post('/panel/notifications/clear', isAuthenticated, (req, res) => {
    const db = readDB();
    db.notifications = (db.notifications || []).filter(n => n.targetUsername !== req.session.user.username);
    writeDB(db);
    res.redirect('/panel/notifications');
});

// ============================================================
// ===                   MESSAGERIE                          ===
// ============================================================
app.get('/panel/messages', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    // Marquer les messages reçus comme lus
    (db.messages || []).forEach(m => { if (m.to === user.username && !m.read) m.read = true; });
    writeDB(db);
    const myMsgs = (db.messages || []).filter(m => m.from === user.username || m.to === user.username);
    const users = db.users.filter(u => u.username !== user.username && !u.banned && !u.suspended);
    const selectedUser = req.query.to || '';
    const thread = selectedUser ? myMsgs.filter(m => (m.from === user.username && m.to === selectedUser) || (m.from === selectedUser && m.to === user.username)) : [];
    const conversations = {};
    myMsgs.forEach(m => {
        const other = m.from === user.username ? m.to : m.from;
        if (!conversations[other] || m.sentAt > conversations[other].sentAt) conversations[other] = m;
    });
    const convList = Object.entries(conversations).sort((a,b) => b[1].sentAt.localeCompare(a[1].sentAt));

    const content = `
    <div class="page-header"><div>
        <div class="page-title">✉️ <span>Messagerie</span></div>
        <div class="page-breadcrumb">${myMsgs.filter(m=>m.to===user.username&&!m.read).length} non lu(s)</div>
    </div></div>
    ${req.query.success ? `<div class="alert alert-success">✅ ${req.query.success}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    <div style="display:grid;grid-template-columns:280px 1fr;gap:1.5rem;min-height:500px;">
        <!-- Liste conversations -->
        <div class="card" style="padding:0;overflow:hidden;">
            <div style="padding:1rem;border-bottom:1px solid var(--border);font-weight:700;">💬 Conversations</div>
            ${convList.length === 0 ? '<div style="padding:2rem;text-align:center;color:var(--text-muted);">Aucune conversation</div>' :
            convList.map(([other, lastMsg]) => `
                <a href="/panel/messages?to=${other}" style="display:block;padding:0.75rem 1rem;border-bottom:1px solid var(--border);text-decoration:none;background:${selectedUser===other?'var(--bg-tertiary)':'transparent'};transition:background 0.2s;" onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.background='${selectedUser===other?'var(--bg-tertiary)':'transparent'}'">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-weight:600;color:var(--text-primary);">@${other}</span>
                        <span style="font-size:0.7rem;color:var(--text-muted);">${new Date(lastMsg.sentAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                    <div style="font-size:0.82rem;color:var(--text-muted);margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${lastMsg.subject}</div>
                </a>`).join('')}
            <div style="padding:0.75rem;border-top:1px solid var(--border);">
                <a href="/panel/messages?compose=1" class="btn btn-primary btn-full btn-sm">✏️ Nouveau message</a>
            </div>
        </div>
        <!-- Zone de lecture/compose -->
        <div class="card">
            ${(req.query.compose || !selectedUser) && !selectedUser ? `
                <h3 style="margin-bottom:1.25rem;">📨 Nouveau message</h3>
                <form method="POST" action="/panel/messages/send">
                    <div class="form-group">
                        <label class="form-label">Destinataire</label>
                        <select name="to" class="form-control" required>
                            <option value="">Choisir un membre...</option>
                            ${users.map(u => `<option value="${u.username}">${u.username} (${ROLE_LABELS[u.role]||u.role})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Objet</label>
                        <input type="text" name="subject" class="form-control" required maxlength="100" placeholder="Objet du message">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Message</label>
                        <textarea name="body" class="form-control" rows="7" required maxlength="3000" placeholder="Votre message..."></textarea>
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button type="submit" class="btn btn-primary">📤 Envoyer</button>
                        ${convList.length>0?`<a href="/panel/messages?to=${convList[0][0]}" class="btn btn-outline">Annuler</a>`:''}
                    </div>
                </form>
            ` : selectedUser ? `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--border);">
                    <h3>Conversation avec @${selectedUser}</h3>
                    <a href="/panel/messages?compose=1&to=${selectedUser}" class="btn btn-sm btn-primary">↩️ Répondre</a>
                </div>
                <div style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1rem;">
                    ${thread.length===0?'<p style="color:var(--text-muted);">Aucun échange</p>':thread.map(m => `
                        <div style="display:flex;flex-direction:column;align-items:${m.from===user.username?'flex-end':'flex-start'};">
                            <div style="max-width:75%;background:${m.from===user.username?'var(--primary)':'var(--bg-tertiary)'};color:${m.from===user.username?'#fff':'var(--text-primary)'};border-radius:12px;padding:0.75rem 1rem;">
                                <div style="font-size:0.8rem;opacity:0.8;margin-bottom:4px;">${m.subject}</div>
                                <div style="line-height:1.5;">${m.body}</div>
                            </div>
                            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;">${new Date(m.sentAt).toLocaleString('fr-FR')}</div>
                        </div>`).join('')}
                </div>
                ${req.query.compose ? `
                <form method="POST" action="/panel/messages/send">
                    <input type="hidden" name="to" value="${selectedUser}">
                    <div class="form-group">
                        <input type="text" name="subject" class="form-control" placeholder="Objet" maxlength="100" required>
                    </div>
                    <div class="form-group">
                        <textarea name="body" class="form-control" rows="4" maxlength="3000" required placeholder="Votre réponse..."></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary btn-sm">📤 Envoyer</button>
                </form>` : ''}
            ` : '<div style="text-align:center;padding:3rem;color:var(--text-muted);">Sélectionnez une conversation ou composez un nouveau message</div>'}
        </div>
    </div>`;
    res.send(panelLayout(user, 'Messagerie', content, 'messages'));
});

app.post('/panel/messages/send', isAuthenticated, (req, res) => {
    const { to, subject, body } = req.body;
    const db = readDB();
    const user = req.session.user;
    if (!to || !subject || !body) return res.redirect('/panel/messages?error=Tous les champs sont requis');
    const target = db.users.find(u => u.username === to);
    if (!target) return res.redirect('/panel/messages?error=Destinataire introuvable');
    if (!db.messages) db.messages = [];
    db.messages.unshift({ id: 'msg_'+Date.now(), from: user.username, to, subject: subject.substring(0,100), body: body.substring(0,3000), sentAt: new Date().toISOString(), read: false });
    if (db.messages.length > 20000) db.messages = db.messages.slice(0, 20000);
    addNotification(db, to, 'message', `✉️ Nouveau message de @${user.username}`, `Objet : ${subject.substring(0,60)}`, 'normal');
    writeDB(db);
    addLog('✉️ Message envoyé', user.username, to, { subject }, getClientIP(req), getClientInfo(req));
    res.redirect(`/panel/messages?to=${to}&success=Message envoyé`);
});

// ============================================================
// ===              NOTES / PENSE-BÊTE                       ===
// ============================================================
app.get('/panel/notes', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const myNotes = (db.notes || []).filter(n => n.owner === user.username).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
    const editId = req.query.edit || null;
    const editNote = editId ? myNotes.find(n => n.id === editId) : null;
    const COLORS = [
        { v:'#9333ea', l:'🟣 Violet' }, { v:'#3b82f6', l:'🔵 Bleu' }, { v:'#10b981', l:'🟢 Vert' },
        { v:'#f59e0b', l:'🟡 Jaune' }, { v:'#ef4444', l:'🔴 Rouge' }, { v:'#ec4899', l:'🩷 Rose' }, { v:'#64748b', l:'⚫ Gris' }
    ];
    const content = `
    <div class="page-header"><div>
        <div class="page-title">📌 <span>Mes Notes</span></div>
        <div class="page-breadcrumb">${myNotes.length} note(s)</div>
    </div></div>
    ${req.query.success ? `<div class="alert alert-success">✅ ${req.query.success}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    <div style="display:grid;grid-template-columns:380px 1fr;gap:1.5rem;align-items:start;">
        <!-- Formulaire -->
        <div class="card">
            <h3 style="margin-bottom:1.25rem;">${editNote ? '✏️ Modifier la note' : '➕ Nouvelle note'}</h3>
            <form method="POST" action="${editNote ? '/panel/notes/'+editNote.id+'/update' : '/panel/notes/create'}">
                <div class="form-group">
                    <label class="form-label">Titre *</label>
                    <input type="text" name="title" class="form-control" required maxlength="100" value="${editNote ? editNote.title.replace(/"/g,'&quot;') : ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Contenu</label>
                    <textarea name="content" class="form-control" rows="9" maxlength="5000">${editNote ? editNote.content : ''}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Couleur</label>
                    <select name="color" class="form-control">
                        ${COLORS.map(c => `<option value="${c.v}" ${editNote&&editNote.color===c.v?'selected':''}>${c.l}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex;gap:0.5rem;">
                    <button type="submit" class="btn btn-primary">${editNote ? '💾 Sauvegarder' : '📌 Créer'}</button>
                    ${editNote ? `<a href="/panel/notes" class="btn btn-outline">Annuler</a>` : ''}
                </div>
            </form>
        </div>
        <!-- Liste des notes -->
        <div>
            ${myNotes.length === 0 ? `<div class="card" style="text-align:center;padding:3rem;"><div style="font-size:3rem;margin-bottom:1rem;">📌</div><p style="color:var(--text-muted);">Aucune note pour l'instant</p></div>` :
            `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
            ${myNotes.map(n => `
                <div class="card" style="border-left:5px solid ${n.color||'#9333ea'};padding:1.25rem;position:relative;">
                    <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;margin-bottom:0.5rem;">
                        <div style="font-weight:700;font-size:1rem;flex:1;">${n.title}</div>
                        <div style="display:flex;gap:0.25rem;flex-shrink:0;">
                            <a href="/panel/notes?edit=${n.id}" class="btn btn-sm btn-secondary" style="padding:3px 8px;font-size:0.75rem;">✏️</a>
                            <a href="/panel/notes/${n.id}/delete" class="btn btn-sm btn-danger" style="padding:3px 8px;font-size:0.75rem;" onclick="return confirm('Supprimer cette note ?')">🗑️</a>
                        </div>
                    </div>
                    <div style="color:var(--text-secondary);font-size:0.875rem;line-height:1.6;white-space:pre-wrap;margin-bottom:0.75rem;">${n.content ? n.content.substring(0,250)+(n.content.length>250?'...':'') : '<em style="opacity:0.5">Vide</em>'}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">Modifié le ${new Date(n.updatedAt).toLocaleString('fr-FR')}</div>
                </div>`).join('')}
            </div>`}
        </div>
    </div>`;
    res.send(panelLayout(user, 'Mes Notes', content, 'notes'));
});

app.post('/panel/notes/create', isAuthenticated, (req, res) => {
    const { title, content, color } = req.body;
    if (!title) return res.redirect('/panel/notes?error=Titre requis');
    const db = readDB();
    if (!db.notes) db.notes = [];
    const now = new Date().toISOString();
    db.notes.push({ id: 'note_'+Date.now(), owner: req.session.user.username, title: title.substring(0,100), content: (content||'').substring(0,5000), color: color||'#9333ea', createdAt: now, updatedAt: now });
    writeDB(db);
    res.redirect('/panel/notes?success=Note créée');
});

app.post('/panel/notes/:id/update', isAuthenticated, (req, res) => {
    const { title, content, color } = req.body;
    if (!title) return res.redirect('/panel/notes?error=Titre requis');
    const db = readDB();
    const note = (db.notes||[]).find(n => n.id === req.params.id && n.owner === req.session.user.username);
    if (!note) return res.redirect('/panel/notes?error=Note introuvable');
    note.title = title.substring(0,100);
    note.content = (content||'').substring(0,5000);
    note.color = color || note.color;
    note.updatedAt = new Date().toISOString();
    writeDB(db);
    res.redirect('/panel/notes?success=Note mise à jour');
});

app.get('/panel/notes/:id/delete', isAuthenticated, (req, res) => {
    const db = readDB();
    db.notes = (db.notes||[]).filter(n => !(n.id === req.params.id && n.owner === req.session.user.username));
    writeDB(db);
    res.redirect('/panel/notes?success=Note supprimée');
});

// ============================================================
// ===    OWNERS : SUSPEND / RÉACTIVER (xywez uniquement)    ===
// ============================================================
app.get('/panel/system/owners/toggle-suspend/:username', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') return res.status(403).send(errorPage('Accès Refusé', 'Réservé à xywez.'));
    const db = readDB();
    const target = db.users.find(u => u.username === req.params.username && (u.role === 'owner' || u.accountType === 'owner'));
    if (!target) return res.redirect('/panel/system/owners?error=Owner introuvable');
    if (target.username === 'xywez') return res.redirect('/panel/system/owners?error=Impossible de suspendre xywez');
    target.suspended = !target.suspended;
    target.suspendReason = target.suspended ? `Suspendu manuellement par xywez le ${new Date().toLocaleDateString('fr-FR')}` : null;
    writeDB(db);
    addLog(target.suspended ? '⛔ Owner suspendu' : '✅ Owner réactivé', 'xywez', target.username, {}, getClientIP(req), getClientInfo(req));
    if (target.suspended) {
        const db2 = readDB();
        addNotification(db2, target.username, 'security', '⛔ Compte suspendu', 'Votre compte owner a été suspendu par xywez.', 'high');
        writeDB(db2);
    } else {
        const db2 = readDB();
        addNotification(db2, target.username, 'info', '✅ Compte réactivé', 'Votre compte owner a été réactivé par xywez.', 'normal');
        writeDB(db2);
    }
    res.redirect('/panel/system/owners?success=' + encodeURIComponent(`${target.username} ${target.suspended ? 'suspendu' : 'réactivé'} avec succès`));
});

// ============================================================
// ===     SYSTEM : GESTION IPS BLOQUÉES (Anti-VPN)         ===
// ============================================================
app.post('/panel/system/block-ip', isAuthenticated, hasRole('owner'), (req, res) => {
    if (req.session.user.username !== 'xywez') return res.status(403).send('Accès refusé');
    const { ip, reason } = req.body;
    if (!ip) return res.redirect('/panel/system?error=IP requise');
    const db = readDB();
    if (!db.blockedIPs) db.blockedIPs = [];
    if (db.blockedIPs.some(b => b.ip === ip)) return res.redirect('/panel/system?error=IP déjà bloquée');
    db.blockedIPs.push({ ip, reason: (reason||'Blocage manuel'), blockedAt: new Date().toISOString(), blockedBy: req.session.user.username });
    writeDB(db);
    addLog('🚫 IP bloquée', req.session.user.username, ip, { reason }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/system?success=IP ' + encodeURIComponent(ip) + ' bloquée avec succès');
});

app.get('/panel/system/unblock-ip/:ip', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    const ip = decodeURIComponent(req.params.ip);
    db.blockedIPs = (db.blockedIPs||[]).filter(b => b.ip !== ip);
    writeDB(db);
    addLog('✅ IP débloquée', req.session.user.username, ip, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/system?success=IP débloquée');
});

console.log("🔥 SYSTÈME COMPLET CHARGÉ - TOUTES LES FONCTIONNALITÉS ACTIVES !");



// ============================================================
// ===           ROUTE: RECHERCHE UTILISATEUR/PANEL         ===
// ============================================================
app.get('/panel/search', isAuthenticated, (req, res) => {
    const user = req.session.user;
    
    if (HIERARCHY[user.role] < HIERARCHY['manager'] && user.username !== 'xywez') {
        return res.status(403).send(errorPage('Accès Refusé', 'Cette page nécessite le rang Manager minimum.'));
    }
    
    let searchResults = null;
    const query = req.query.q;
    const type = req.query.type || 'user';
    
    if (query) {
        const db = readDB();
        
        if (type === 'user') {
            searchResults = db.users.filter(u => {
                const matchDiscordId = u.discordId && u.discordId.includes(query);
                const matchIp = u.ipAddress && u.ipAddress.includes(query);
                const matchUsername = u.username.toLowerCase().includes(query.toLowerCase());
                return matchDiscordId || matchIp || matchUsername;
            }).map(u => ({
                ...u,
                canView: user.username === 'xywez' || !u.role || HIERARCHY[user.role] > HIERARCHY[u.role || 'joueur']
            }));
        } else {
            searchResults = db.users.filter(u => 
                u.username.toLowerCase().includes(query.toLowerCase())
            ).map(u => ({
                ...u,
                canView: user.username === 'xywez' || !u.role || HIERARCHY[user.role] > HIERARCHY[u.role || 'joueur']
            }));
        }
    }
    
    const content = `
    <div class="page-header">
        <h1 class="page-title">🔍 Recherche</h1>
        <p class="page-subtitle">Rechercher des utilisateurs ou des comptes panel</p>
    </div>
    
    <div class="card">
        <h3>Rechercher</h3>
        <form method="GET" action="/panel/search">
            <div style="display: grid; grid-template-columns: 200px 1fr auto; gap: 1rem;">
                <div class="form-group" style="margin: 0;">
                    <select name="type" class="form-control">
                        <option value="user" ${type === 'user' ? 'selected' : ''}>👤 Utilisateur (ID/IP)</option>
                        <option value="panel" ${type === 'panel' ? 'selected' : ''}>🎛️ Compte Panel</option>
                    </select>
                </div>
                <div class="form-group" style="margin: 0;">
                    <input type="text" name="q" class="form-control" placeholder="ID Discord, IP ou Username" value="${query || ''}" required>
                </div>
                <button type="submit" class="btn btn-primary"><i class="fas fa-search"></i> Rechercher</button>
            </div>
        </form>
    </div>
    
    ${searchResults !== null ? `
    <div class="card">
        <h3>📋 Résultats (${searchResults.length})</h3>
        ${searchResults.length === 0 ? `
        <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
            <i class="fas fa-search" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
            <p>Aucun résultat trouvé</p>
        </div>
        ` : `
        <div style="margin-top: 1.5rem;">
            ${searchResults.map(u => `
            <div class="card" style="margin-bottom: 1rem;">
                <div style="display: flex; align-items: start; gap: 1rem;">
                    ${u.discordAvatar ? `
                    <img src="https://cdn.discordapp.com/avatars/${u.discordId}/${u.discordAvatar}.png" 
                         style="width: 50px; height: 50px; border-radius: 50%;">
                    ` : `
                    <div style="width: 50px; height: 50px; border-radius: 50%; background: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.5rem;">
                        ${u.username.charAt(0).toUpperCase()}
                    </div>
                    `}
                    <div style="flex: 1;">
                        <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem;">${u.username}</div>
                        ${u.role ? `<span style="background: ${ROLE_COLORS[u.role]}; color: white; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.875rem;">${ROLE_LABELS[u.role]}</span>` : ''}
                        
                        ${u.canView ? `
                        <div style="margin-top: 1rem; background: var(--bg-hover); padding: 1rem; border-radius: 8px;">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                                ${u.discordId ? `<div><div style="color: var(--text-muted); font-size: 0.875rem;">Discord ID</div><div style="font-family: monospace;">${u.discordId}</div></div>` : ''}
                                ${u.ipAddress ? `<div><div style="color: var(--text-muted); font-size: 0.875rem;">IP</div><div style="font-family: monospace;">${u.ipAddress}</div></div>` : ''}
                                <div><div style="color: var(--text-muted); font-size: 0.875rem;">Créé le</div><div>${new Date(u.createdAt).toLocaleDateString('fr-FR')}</div></div>
                                ${u.lastLogin ? `<div><div style="color: var(--text-muted); font-size: 0.875rem;">Dernière connexion</div><div>${new Date(u.lastLogin).toLocaleDateString('fr-FR')}</div></div>` : ''}
                                ${u.sanctions && u.sanctions.length > 0 ? `<div><div style="color: var(--text-muted); font-size: 0.875rem;">Sanctions</div><div style="color: var(--danger); font-weight: 600;">${u.sanctions.length}</div></div>` : ''}
                            </div>
                            ${u.sanctions && u.sanctions.length > 0 ? `
                            <div style="margin-top: 1rem;">
                                <div style="font-weight: 600; color: var(--danger); margin-bottom: 0.5rem;">⚠️ Sanctions</div>
                                ${u.sanctions.slice(0, 3).map(s => `
                                <div style="padding: 0.75rem; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger); border-radius: 6px; margin-bottom: 0.5rem;">
                                    <div><strong>${s.type.toUpperCase()}</strong> - ${s.reason}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Par ${s.moderator} le ${new Date(s.date).toLocaleDateString('fr-FR')}</div>
                                </div>
                                `).join('')}
                            </div>
                            ` : ''}
                        </div>
                        ` : `
                        <div style="padding: 1rem; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger); border-radius: 6px; margin-top: 1rem;">
                            🔒 Vous n'avez pas la permission de voir les détails (rang égal ou supérieur)
                        </div>
                        `}
                    </div>
                </div>
            </div>
            `).join('')}
        </div>
        `}
    </div>
    ` : ''}
    `;
    
    res.send(panelLayout(user, 'Recherche', content, 'search'));
});



// ============================================================
// ===           ROUTE: GESTION BOT DISCORD (XYWEZ)         ===
// ============================================================
app.get('/panel/bot', isAuthenticated, (req, res) => {
    const user = req.session.user;
    
    if (user.username !== 'xywez' && user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.status(403).send(errorPage('Accès Refusé', 'Cette page est réservée à Xywez uniquement.'));
    }
    
    const uptime = botStatus.isReady ? Date.now() - (botStatus.uptime || Date.now()) : 0;
    const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((uptime % (60 * 60 * 1000)) / (60 * 1000));
    
    const content = `
    <div class="page-header">
        <h1 class="page-title">🤖 Gestion du Bot Discord</h1>
        <p class="page-subtitle">Panel de contrôle complet - Réservé Xywez</p>
    </div>
    
    ${req.query.success ? `<div class="alert alert-success">✅ ${req.query.success}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${req.query.error}</div>` : ''}
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
        <div class="card">
            <h3>📊 Statistiques</h3>
            <div style="margin-top: 1rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="color: var(--text-secondary);">Statut:</span>
                    <span style="font-weight: 600; color: ${botStatus.isReady ? 'var(--success)' : 'var(--danger)'};">
                        ${botStatus.isReady ? '🟢 En ligne' : '🔴 Hors ligne'}
                    </span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="color: var(--text-secondary);">Serveurs:</span>
                    <span style="font-weight: 600;">${botStatus.guilds || 0}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="color: var(--text-secondary);">Membres:</span>
                    <span style="font-weight: 600;">${botStatus.members || 0}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
                    <span style="color: var(--text-secondary);">Uptime:</span>
                    <span style="font-weight: 600;">${days}j ${hours}h ${minutes}m</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: var(--text-secondary);">Commandes:</span>
                    <span style="font-weight: 600;">${(botStatus.commands || []).length}</span>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h3>🎮 Changer le Statut</h3>
            <form method="POST" action="/panel/bot/status" style="margin-top: 1rem;">
                <div class="form-group">
                    <label class="form-label">Statut</label>
                    <select name="status" class="form-control">
                        <option value="online" ${botStatus.status === 'online' ? 'selected' : ''}>🟢 En ligne</option>
                        <option value="idle" ${botStatus.status === 'idle' ? 'selected' : ''}>🟡 Inactif</option>
                        <option value="dnd" ${botStatus.status === 'dnd' ? 'selected' : ''}>🔴 Ne pas déranger</option>
                        <option value="invisible" ${botStatus.status === 'invisible' ? 'selected' : ''}>⚫ Invisible</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Activité</label>
                    <input type="text" name="activity" class="form-control" value="${botStatus.activity?.name || 'FTY Club Pro'}" placeholder="Ex: FTY Club Pro">
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <select name="activityType" class="form-control">
                        <option value="0" ${botStatus.activity?.type === 0 ? 'selected' : ''}>🎮 Joue à</option>
                        <option value="2" ${botStatus.activity?.type === 2 ? 'selected' : ''}>🎵 Écoute</option>
                        <option value="3" ${botStatus.activity?.type === 3 ? 'selected' : ''}>📺 Regarde</option>
                        <option value="5" ${botStatus.activity?.type === 5 ? 'selected' : ''}>🏆 En compétition</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-primary">💾 Mettre à Jour</button>
            </form>
        </div>
    </div>
    
    <div class="card">
        <h3>📋 Logs du Bot (${(botStatus.logs || []).length})</h3>
        <div style="max-height: 400px; overflow-y: auto; margin-top: 1rem;">
            ${(botStatus.logs || []).length === 0 ? '<p style="color: var(--text-muted);">Aucun log</p>' : botStatus.logs.map(log => `
            <div style="padding: 0.75rem; background: var(--bg-hover); border-radius: 8px; margin-bottom: 0.5rem; font-family: monospace; font-size: 0.875rem;">
                <div style="color: var(--text-muted); font-size: 0.75rem;">${new Date(log.timestamp).toLocaleString('fr-FR')}</div>
                <div>${log.message}</div>
            </div>
            `).join('')}
        </div>
    </div>
    
    <div class="card">
        <h3>⚙️ Commandes Disponibles</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;">
            ${(botStatus.commands || ['/setup', '/nuke', '/site', '/ban', '/kick', '/announce', '/ticket', '/status']).map(cmd => `
            <div style="padding: 1rem; background: var(--bg-hover); border-radius: 8px; border-left: 4px solid var(--primary);">
                <div style="font-weight: 600; color: var(--primary);">/${cmd.replace('/', '')}</div>
            </div>
            `).join('')}
        </div>
    </div>
    `;
    
    res.send(panelLayout(user, 'Bot Discord', content, 'bot'));
});

app.post('/panel/bot/status', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    
    if (user.username !== 'xywez' && user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.redirect('/panel/bot?error=Accès refusé');
    }
    
    const { status, activity, activityType } = req.body;
    
    const result = await callBotAPI('/api/update-status', 'POST', {
        apiKey: PANEL_API_KEY,
        status,
        activity,
        activityType: parseInt(activityType)
    });
    
    if (result && result.success) {
        botStatus = result.botStatus || botStatus;
        addLog('🤖 Statut bot modifié', user.username, `${status} - ${activity}`, {}, getClientIP(req), getClientInfo(req));
        res.redirect('/panel/bot?success=Statut mis à jour');
    } else {
        res.redirect('/panel/bot?error=Erreur lors de la mise à jour');
    }
});



// Reset mot de passe avec notification Discord
app.get('/panel/users/:username/reset-password', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    const targetUsername = req.params.username;
    
    const db = readDB();
    const targetUser = db.users.find(u => u.username === targetUsername);
    
    if (!targetUser) {
        return res.redirect('/panel/users?error=Utilisateur introuvable');
    }
    
    if (user.username !== 'xywez' && HIERARCHY[user.role] <= HIERARCHY[targetUser.role || 'joueur']) {
        return res.redirect('/panel/users?error=Vous ne pouvez pas réinitialiser le mot de passe d\'un compte de rang égal ou supérieur');
    }
    
    if (targetUsername === 'xywez' && user.username !== 'xywez') {
        return res.redirect('/panel/users?error=Impossible de réinitialiser le mot de passe de Xywez');
    }
    
    const newPassword = crypto.randomBytes(8).toString('hex');
    targetUser.password = hashPassword(newPassword);
    writeDB(db);
    
    if (targetUser.discordId) {
        await sendDiscordDM(
            targetUser.discordId,
            '🔑 Mot de Passe Réinitialisé',
            `Votre mot de passe a été réinitialisé par ${user.username}.\n\n**Nouveau mot de passe:** \`${newPassword}\`\n\n🔗 Connectez-vous: https://fty-club-pro-1.onrender.com/panel/login\n\n⚠️ Changez ce mot de passe dès votre prochaine connexion!`,
            '#f59e0b'
        );
    }
    
    addLog('🔑 MDP réinitialisé', user.username, targetUsername, {}, getClientIP(req), getClientInfo(req));
    res.redirect(`/panel/users?success=Mot de passe de ${targetUsername} réinitialisé${targetUser.discordId ? ' (envoyé en DM)' : ' (nouveau: ' + newPassword + ')'}`);
});

// Supprimer compte avec notification Discord
app.get('/panel/users/:username/delete', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    const targetUsername = req.params.username;
    
    if (targetUsername === 'xywez') {
        return res.redirect('/panel/users?error=Impossible de supprimer le compte Xywez');
    }
    
    const db = readDB();
    const targetUser = db.users.find(u => u.username === targetUsername);
    
    if (!targetUser) {
        return res.redirect('/panel/users?error=Utilisateur introuvable');
    }
    
    if (user.username !== 'xywez' && HIERARCHY[user.role] <= HIERARCHY[targetUser.role || 'joueur']) {
        return res.redirect('/panel/users?error=Vous ne pouvez pas supprimer un compte de rang égal ou supérieur');
    }
    
    if (targetUser.discordId) {
        await sendDiscordDM(
            targetUser.discordId,
            '❌ Compte Supprimé',
            `Votre compte panel FTY Club Pro a été supprimé par ${user.username}.\n\nVous n'avez plus accès au panel.\n\nSi vous pensez qu'il s'agit d'une erreur, contactez le staff.`,
            '#ef4444'
        );
    }
    
    db.users = db.users.filter(u => u.username !== targetUsername);
    writeDB(db);
    
    addLog('❌ Compte supprimé', user.username, targetUsername, {}, getClientIP(req), getClientInfo(req));
    res.redirect(`/panel/users?success=Compte ${targetUsername} supprimé${targetUser.discordId ? ' (notification envoyée en DM)' : ''}`);
});


// ════════════════════════════════════════════════════════════════════
// ===                PAGE TICKETS (support+)                       ===
// ════════════════════════════════════════════════════════════════════
app.get('/panel/tickets', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const tickets = (db.dmTickets||[]).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const open = tickets.filter(t=>t.status!=='closed').length;
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🎫 Gestion des <span>Tickets</span></div>
            <div class="page-breadcrumb">${open} ticket(s) ouvert(s) · ${tickets.length} total</div>
        </div>
    </div>
    ${req.query.success ? '<div class="alert alert-success">✅ '+decodeURIComponent(req.query.success)+'</div>' : ''}
    ${req.query.error ? '<div class="alert alert-danger">❌ '+decodeURIComponent(req.query.error)+'</div>' : ''}

    <div class="card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;color:var(--primary);">✉️ Envoyer un Message / Ticket en DM Discord</h3>
        <form method="POST" action="/panel/tickets/send">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group">
                    <label class="form-label">Discord ID du membre *</label>
                    <input type="text" name="discordId" class="form-control" required placeholder="Ex: 123456789012345678">
                    <small style="color:var(--text-muted);">Clic droit sur le membre → Copier ID</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Sujet *</label>
                    <input type="text" name="sujet" class="form-control" required placeholder="Ex: Avertissement, Convocation, Info...">
                </div>
                <div class="form-group" style="grid-column:1/-1;">
                    <label class="form-label">Message *</label>
                    <textarea name="message" class="form-control" rows="4" required placeholder="Contenu envoyé en DM Discord..."></textarea>
                </div>
                <div style="grid-column:1/-1;display:flex;gap:1rem;">
                    <button type="submit" class="btn btn-primary">📨 Envoyer le DM</button>
                    <span style="color:var(--text-muted);align-self:center;font-size:.85rem;">Le membre recevra un embed Discord dans ses DM</span>
                </div>
            </div>
        </form>
    </div>

    <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
            <h3>📋 Historique des Tickets</h3>
            <div style="display:flex;gap:.5rem;">
                <span style="padding:.25rem .75rem;background:#22c55e20;color:#22c55e;border-radius:8px;font-size:.8rem;font-weight:700;">${open} ouvert(s)</span>
                <span style="padding:.25rem .75rem;background:var(--bg-tertiary);color:var(--text-muted);border-radius:8px;font-size:.8rem;">${tickets.filter(t=>t.status==='closed').length} fermé(s)</span>
            </div>
        </div>
        ${tickets.length===0 ? '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun ticket pour le moment.</p>' : '<div style="display:flex;flex-direction:column;gap:.75rem;">' + tickets.map(t=>`
        <div style="padding:1rem;background:var(--bg-tertiary);border-radius:10px;border-left:4px solid ${t.status==='closed'?'var(--text-muted)':'var(--primary)'};">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.5rem;">
                <div>
                    <strong style="color:var(--text-primary);">${t.sujet||t.subject||'Sans sujet'}</strong>
                    <span style="margin-left:.75rem;padding:.125rem .5rem;background:${t.status==='closed'?'#ef444420':'#22c55e20'};color:${t.status==='closed'?'#ef4444':'#22c55e'};border-radius:6px;font-size:.75rem;font-weight:700;">${t.status==='closed'?'Fermé':'Ouvert'}</span>
                </div>
                <span style="font-size:.75rem;color:var(--text-muted);">${new Date(t.createdAt).toLocaleString('fr-FR')}</span>
            </div>
            <p style="color:var(--text-secondary);font-size:.875rem;margin:.5rem 0;">${(t.message||'').substring(0,200)}${(t.message||'').length>200?'...':''}</p>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.5rem;">
                <div style="font-size:.8rem;color:var(--text-muted);">
                    Discord: <code>${t.discordId||'N/A'}</code> · Envoyé par <strong>${t.sentBy||'Bot'}</strong>
                </div>
                <div style="display:flex;gap:.5rem;">
                    ${t.status!=='closed' ? '<a href="/panel/tickets/'+t.id+'/close" class="btn btn-sm" style="background:#ef444420;color:#ef4444;">🔒 Fermer</a>' : ''}
                    ${t.discordId ? '<a href="/panel/tickets/reply/'+t.id+'" class="btn btn-sm btn-outline">💬 Répondre</a>' : ''}
                </div>
            </div>
        </div>`).join('')+'</div>'}
    </div>`;
    res.send(panelLayout(user,'Tickets',content,'tickets'));
});

app.post('/panel/tickets/send', isAuthenticated, hasRole('support'), async (req, res) => {
    const { discordId, sujet, message } = req.body;
    const user = req.session.user;
    if (!discordId||!sujet||!message) return res.redirect('/panel/tickets?error='+encodeURIComponent('Tous les champs sont requis'));
    const db = readDB();
    const ticket = { id:'t_'+Date.now(), discordId, sujet, message, sentBy:user.username, status:'open', createdAt:new Date().toISOString() };
    if (!Array.isArray(db.dmTickets)) db.dmTickets=[];
    db.dmTickets.unshift(ticket);
    writeDB(db);
    const botOk = await callBotAPI('/api/ticket','POST',{ apiKey:PANEL_API_KEY, discordId, sujet, staffMessage:message });
    addLog('🎫 Ticket DM envoyé', user.username, discordId, { sujet }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/tickets?success='+encodeURIComponent('Ticket envoyé'+(botOk?'':' (bot hors ligne - enregistré uniquement)')));
});

app.get('/panel/tickets/:id/close', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (t) { t.status='closed'; t.closedAt=new Date().toISOString(); t.closedBy=req.session.user.username; writeDB(db); }
    res.redirect('/panel/tickets?success='+encodeURIComponent('Ticket fermé'));
});

app.get('/panel/tickets/reply/:id', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    const user = req.session.user;
    if (!t) return res.redirect('/panel/tickets?error='+encodeURIComponent('Ticket introuvable'));
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">💬 Répondre au <span>Ticket</span></div>
            <div class="page-breadcrumb">Sujet: ${t.sujet}</div>
        </div>
        <a href="/panel/tickets" class="btn btn-outline">← Retour</a>
    </div>
    <div class="card">
        <div style="padding:1rem;background:var(--bg-tertiary);border-radius:8px;margin-bottom:1.5rem;">
            <strong>Ticket original:</strong><br>
            <span style="color:var(--text-secondary);">${t.message||''}</span><br>
            <small style="color:var(--text-muted);">Discord ID: ${t.discordId} · ${new Date(t.createdAt).toLocaleString('fr-FR')}</small>
        </div>
        <form method="POST" action="/panel/tickets/reply-send/${t.id}">
            <div class="form-group">
                <label class="form-label">Votre réponse *</label>
                <textarea name="message" class="form-control" rows="5" required placeholder="Votre réponse..."></textarea>
            </div>
            <button type="submit" class="btn btn-primary">📨 Envoyer la réponse en DM</button>
        </form>
    </div>`;
    res.send(panelLayout(user,'Répondre au Ticket',content,'tickets'));
});

app.post('/panel/tickets/reply-send/:id', isAuthenticated, hasRole('support'), async (req, res) => {
    const db = readDB();
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (!t) return res.redirect('/panel/tickets?error='+encodeURIComponent('Ticket introuvable'));
    const { message } = req.body;
    await callBotAPI('/api/ticket','POST',{ apiKey:PANEL_API_KEY, discordId:t.discordId, sujet:'Réponse: '+t.sujet, staffMessage:message });
    addLog('💬 Réponse ticket', req.session.user.username, t.discordId, { sujet:t.sujet }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/tickets?success='+encodeURIComponent('Réponse envoyée'));
});

// ════════════════════════════════════════════════════════════════════
// ===                PAGE ANNONCES (modérateur+)                   ===
// ════════════════════════════════════════════════════════════════════
app.get('/panel/annonces', isAuthenticated, hasRole('moderateur'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const annonces = (db.announcements||[]).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">📢 Gestion des <span>Annonces</span></div>
            <div class="page-breadcrumb">Publication sur Discord + historique</div>
        </div>
    </div>
    ${req.query.success ? '<div class="alert alert-success">✅ '+decodeURIComponent(req.query.success)+'</div>' : ''}
    ${req.query.error ? '<div class="alert alert-danger">❌ '+decodeURIComponent(req.query.error)+'</div>' : ''}

    <div class="card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;color:var(--primary);">📣 Publier une Annonce sur Discord</h3>
        <form method="POST" action="/panel/annonces/publish">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group">
                    <label class="form-label">Type d'annonce *</label>
                    <select name="type" class="form-control" required>
                        <option value="global">📢 Annonce Globale</option>
                        <option value="match">⚽ Annonce Match</option>
                        <option value="conference">🎤 Conférence</option>
                        <option value="recrutement">🎯 Recrutement</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Titre (affiché dans l'embed)</label>
                    <input type="text" name="titre" class="form-control" placeholder="Ex: Match ce soir 20h00">
                </div>
                <div class="form-group" style="grid-column:1/-1;">
                    <label class="form-label">Message *</label>
                    <textarea name="message" class="form-control" rows="5" required placeholder="Contenu de l'annonce (sera publié avec @everyone sur Discord)..."></textarea>
                </div>
                <div style="grid-column:1/-1;display:flex;gap:1rem;align-items:center;">
                    <button type="submit" class="btn btn-primary">📢 Publier sur Discord</button>
                    <span style="color:var(--text-muted);font-size:.85rem;">⚠️ Requiert que le bot soit en ligne et /setup complété</span>
                </div>
            </div>
        </form>
    </div>

    <div class="card">
        <h3 style="margin-bottom:1rem;">📋 Historique des Annonces (${annonces.length})</h3>
        ${annonces.length===0 ? '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucune annonce publiée.</p>' : '<div style="display:flex;flex-direction:column;gap:.75rem;">' + annonces.slice(0,30).map(a=>{
            const typeColors={global:'#3b82f6',match:'#22c55e',conference:'#a855f7',recrutement:'#f59e0b'};
            const typeEmojis={global:'📢',match:'⚽',conference:'🎤',recrutement:'🎯'};
            return '<div style="padding:1rem;background:var(--bg-tertiary);border-radius:10px;border-left:4px solid '+(typeColors[a.type]||'var(--primary)')+';">'+
                '<div style="display:flex;justify-content:space-between;margin-bottom:.5rem;">'+
                '<strong>'+(typeEmojis[a.type]||'📢')+' '+(a.titre||a.type)+'</strong>'+
                '<span style="font-size:.75rem;color:var(--text-muted);">'+new Date(a.createdAt).toLocaleString('fr-FR')+'</span>'+
                '</div>'+
                '<p style="color:var(--text-secondary);font-size:.875rem;margin:.25rem 0;">'+(a.message||'').substring(0,250)+((a.message||'').length>250?'...':'')+'</p>'+
                '<small style="color:var(--text-muted);">Par '+a.author+' · Type: '+a.type+'</small>'+
                '</div>';
        }).join('')+'</div>'}
    </div>`;
    res.send(panelLayout(user,'Annonces',content,'annonces'));
});

app.post('/panel/annonces/publish', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const { type, titre, message } = req.body;
    const user = req.session.user;
    if (!message) return res.redirect('/panel/annonces?error='+encodeURIComponent('Le message est requis'));
    const db = readDB();
    const a = { id:'a_'+Date.now(), type, titre:titre||type, message, author:user.username, createdAt:new Date().toISOString() };
    if (!Array.isArray(db.announcements)) db.announcements=[];
    db.announcements.unshift(a);
    writeDB(db);
    const botOk = await callBotAPI('/api/announce','POST',{ apiKey:PANEL_API_KEY, type, message });
    addLog('📢 Annonce publiée', user.username, type, { titre, msg:message.substring(0,50) }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/annonces?success='+encodeURIComponent('Annonce publiée'+(botOk?.success?' sur Discord':' (bot hors ligne - enregistrée seulement)')));
});

// ════════════════════════════════════════════════════════════════════
// ===                PAGE MODÉRATION (modérateur+)                 ===
// ════════════════════════════════════════════════════════════════════
app.get('/panel/moderation', isAuthenticated, hasRole('moderateur'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const myRank = HIERARCHY[user.role]||0;
    const members = db.users.filter(u=>u.username!=='xywez'&&(HIERARCHY[u.role||u.accountType]||0)<myRank);
    const totalSanctions = db.users.reduce((acc,u)=>acc+(u.sanctions||[]).length,0);
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🔨 <span>Modération</span></div>
            <div class="page-breadcrumb">${members.length} membre(s) gérable(s) · ${totalSanctions} sanction(s) totales</div>
        </div>
    </div>
    ${req.query.success ? '<div class="alert alert-success">✅ '+decodeURIComponent(req.query.success)+'</div>' : ''}
    ${req.query.error ? '<div class="alert alert-danger">❌ '+decodeURIComponent(req.query.error)+'</div>' : ''}

    <!-- Action rapide par Discord ID -->
    <div class="card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;color:var(--primary);">⚡ Action Rapide sur Discord (par ID)</h3>
        <p style="color:var(--text-muted);font-size:.875rem;margin-bottom:1rem;">Pour agir sur un membre Discord qui n'est pas dans le panel</p>
        <form method="POST" action="/panel/moderation/action-discord">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:1rem;align-items:end;">
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Discord ID *</label>
                    <input type="text" name="discordId" class="form-control" required placeholder="123456789012345678">
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Action *</label>
                    <select name="action" class="form-control" required>
                        <option value="warn">⚠️ Avertir (DM)</option>
                        <option value="kick">👢 Kick Discord</option>
                        ${myRank>=(HIERARCHY['administrateur']||5)?'<option value="ban">🔨 Ban Discord</option>':''}
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Raison *</label>
                    <input type="text" name="reason" class="form-control" required placeholder="Raison...">
                </div>
                <button type="submit" class="btn btn-primary" style="height:42px;">Exécuter</button>
            </div>
        </form>
    </div>

    <!-- Membres gérables -->
    <div class="card">
        <h3 style="margin-bottom:1rem;">👥 Membres Panel Gérables</h3>
        ${members.length===0?'<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun membre gérable avec votre rang.</p>':'<div style="overflow-x:auto;"><table class="table"><thead><tr><th>Membre</th><th>Rôle</th><th>Discord</th><th>Statut</th><th>Sanctions</th><th>Actions</th></tr></thead><tbody>'+members.map(m=>{
            const mRank=HIERARCHY[m.role||m.accountType]||0;
            const sc=ROLE_COLORS[m.role||m.accountType]||'#888';
            const sl=ROLE_LABELS[m.role||m.accountType]||m.role;
            const stColor=m.banned?'#ef4444':m.suspended?'#f59e0b':'#22c55e';
            const stLabel=m.banned?'🔨 Banni':m.suspended?'⏸️ Suspendu':'✅ Actif';
            return '<tr style="'+(m.banned?'opacity:.65':'')+'">' +
                '<td><strong>'+m.username+'</strong></td>'+
                '<td><span class="badge" style="background:'+sc+'20;color:'+sc+'">'+sl+'</span></td>'+
                '<td><code style="font-size:.75rem;">'+(m.discordId||'Non lié')+'</code></td>'+
                '<td><span style="color:'+stColor+';font-weight:600;">'+stLabel+'</span></td>'+
                '<td style="color:var(--text-muted);">'+(m.sanctions||[]).length+' sanction(s) <a href="/panel/moderation/sanctions/'+m.username+'" style="color:var(--primary);font-size:.75rem;">voir</a></td>'+
                '<td><div style="display:flex;gap:.25rem;flex-wrap:wrap;">'+
                    (!m.suspended&&!m.banned?'<form method="POST" action="/panel/moderation/warn/'+m.username+'" style="display:inline"><input type="hidden" name="reason" value="Avertissement staff"><button class="btn btn-sm" style="background:#f59e0b20;color:#f59e0b;" title="Avertir (DM)">⚠️</button></form>':'')+
                    (!m.suspended&&!m.banned?'<a href="/panel/moderation/suspend/'+m.username+'" class="btn btn-sm" style="background:#f59e0b20;color:#f59e0b;" title="Suspendre">⏸️</a>':'')+
                    (m.suspended?'<a href="/panel/moderation/unsuspend/'+m.username+'" class="btn btn-sm" style="background:#22c55e20;color:#22c55e;" title="Réactiver">▶️</a>':'')+
                    (myRank>=(HIERARCHY['administrateur']||5)&&!m.banned?'<a href="/panel/moderation/ban/'+m.username+'" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" title="Bannir panel" onclick="return confirm(\'Bannir ce membre ?\')">🔨</a>':'')+
                    (m.banned?'<a href="/panel/moderation/unban/'+m.username+'" class="btn btn-sm" style="background:#22c55e20;color:#22c55e;" title="Débannir">✅</a>':'')+
                    (m.discordId&&!m.banned?'<a href="/panel/moderation/discord-kick/'+m.username+'" class="btn btn-sm" style="background:#f59e0b20;color:#f59e0b;" title="Kick Discord" onclick="return confirm(\'Kick Discord ce membre ?\')">👢</a>':'')+
                    (m.discordId&&myRank>=(HIERARCHY['administrateur']||5)&&!m.banned?'<a href="/panel/moderation/discord-ban/'+m.username+'" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" title="Ban Discord" onclick="return confirm(\'Ban Discord ce membre ?\')">🔨</a>':'')+
                '</div></td></tr>';
        }).join('')+'</tbody></table></div>'}
    </div>`;
    res.send(panelLayout(user,'Modération',content,'moderation'));
});

// Action rapide Discord
app.post('/panel/moderation/action-discord', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const { discordId, action, reason } = req.body;
    const user = req.session.user;
    if (!discordId||!action||!reason) return res.redirect('/panel/moderation?error='+encodeURIComponent('Champs manquants'));
    if (action==='ban'&&HIERARCHY[user.role]<HIERARCHY['administrateur']) return res.redirect('/panel/moderation?error='+encodeURIComponent('Seuls les administrateurs+ peuvent bannir'));
    const result = await callBotAPI('/api/moderate','POST',{ apiKey:PANEL_API_KEY, action, discordId, reason, moderator:user.username });
    addLog('🔨 Discord '+action, user.username, discordId, { reason }, getClientIP(req), getClientInfo(req));
    if (result?.success) res.redirect('/panel/moderation?success='+encodeURIComponent(action+' exécuté sur '+discordId));
    else res.redirect('/panel/moderation?error='+encodeURIComponent((result?.error)||'Bot hors ligne ou membre introuvable'));
});

// Warn
app.post('/panel/moderation/warn/:username', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const { reason } = req.body;
    const db = readDB();
    const target = db.users.find(u=>u.username===req.params.username);
    if (!target) return res.redirect('/panel/moderation?error='+encodeURIComponent('Membre introuvable'));
    if (!Array.isArray(target.sanctions)) target.sanctions=[];
    target.sanctions.push({ type:'warn', reason:reason||'Avertissement', by:req.session.user.username, date:new Date().toISOString() });
    writeDB(db);
    if (target.discordId) await callBotAPI('/api/moderate','POST',{ apiKey:PANEL_API_KEY, action:'warn', discordId:target.discordId, reason, moderator:req.session.user.username });
    addLog('⚠️ Warn', req.session.user.username, target.username, { reason }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/moderation?success='+encodeURIComponent('Avertissement envoyé à '+target.username));
});

// Suspend / Unsuspend
app.get('/panel/moderation/suspend/:username', isAuthenticated, hasRole('moderateur'), (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    if (t) { t.suspended=true; if(!Array.isArray(t.sanctions))t.sanctions=[]; t.sanctions.push({type:'suspend',by:req.session.user.username,date:new Date().toISOString()}); writeDB(db); }
    addLog('⏸️ Suspension', req.session.user.username, req.params.username, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/moderation?success='+encodeURIComponent(req.params.username+' suspendu'));
});
app.get('/panel/moderation/unsuspend/:username', isAuthenticated, hasRole('moderateur'), (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    if (t) { t.suspended=false; writeDB(db); }
    addLog('▶️ Réactivation', req.session.user.username, req.params.username, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/moderation?success='+encodeURIComponent(req.params.username+' réactivé'));
});

// Ban / Unban panel
app.get('/panel/moderation/ban/:username', isAuthenticated, hasRole('administrateur'), async (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    if (!t) return res.redirect('/panel/moderation?error='+encodeURIComponent('Membre introuvable'));
    if (HIERARCHY[req.session.user.role]<=(HIERARCHY[t.role||t.accountType]||0)) return res.redirect('/panel/moderation?error='+encodeURIComponent('Rang insuffisant'));
    t.banned=true; t.suspended=false;
    if (!Array.isArray(t.sanctions)) t.sanctions=[];
    t.sanctions.push({ type:'ban', by:req.session.user.username, date:new Date().toISOString() });
    writeDB(db);
    if (t.discordId) await callBotAPI('/api/moderate','POST',{ apiKey:PANEL_API_KEY, action:'ban', discordId:t.discordId, reason:'Banni via panel', moderator:req.session.user.username });
    addLog('🔨 Ban', req.session.user.username, t.username, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/moderation?success='+encodeURIComponent(t.username+' banni (panel'+(t.discordId?' + Discord':'')+')'));
});
app.get('/panel/moderation/unban/:username', isAuthenticated, hasRole('administrateur'), (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    if (t) { t.banned=false; writeDB(db); }
    addLog('✅ Unban', req.session.user.username, req.params.username, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/moderation?success='+encodeURIComponent(req.params.username+' débanni'));
});

// Kick / Ban Discord depuis panel
app.get('/panel/moderation/discord-kick/:username', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    if (!t?.discordId) return res.redirect('/panel/moderation?error='+encodeURIComponent('Pas de Discord ID pour ce membre'));
    const result = await callBotAPI('/api/moderate','POST',{ apiKey:PANEL_API_KEY, action:'kick', discordId:t.discordId, reason:'Kick via panel', moderator:req.session.user.username });
    addLog('👢 Discord Kick', req.session.user.username, t.username, {}, getClientIP(req), getClientInfo(req));
    if (result?.success) res.redirect('/panel/moderation?success='+encodeURIComponent(t.username+' expulsé de Discord'));
    else res.redirect('/panel/moderation?error='+encodeURIComponent(result?.error||'Impossible (bot hors ligne ?)'));
});
app.get('/panel/moderation/discord-ban/:username', isAuthenticated, hasRole('administrateur'), async (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    if (!t?.discordId) return res.redirect('/panel/moderation?error='+encodeURIComponent('Pas de Discord ID'));
    const result = await callBotAPI('/api/moderate','POST',{ apiKey:PANEL_API_KEY, action:'ban', discordId:t.discordId, reason:'Ban via panel', moderator:req.session.user.username });
    t.banned=true; if(!Array.isArray(t.sanctions))t.sanctions=[]; t.sanctions.push({type:'ban',by:req.session.user.username,date:new Date().toISOString()}); writeDB(db);
    addLog('🔨 Discord Ban', req.session.user.username, t.username, {}, getClientIP(req), getClientInfo(req));
    if (result?.success) res.redirect('/panel/moderation?success='+encodeURIComponent(t.username+' banni de Discord'));
    else res.redirect('/panel/moderation?error='+encodeURIComponent(result?.error||'Impossible (bot hors ligne ?)'));
});

// Voir les sanctions d'un membre
app.get('/panel/moderation/sanctions/:username', isAuthenticated, hasRole('moderateur'), (req, res) => {
    const db = readDB();
    const t = db.users.find(u=>u.username===req.params.username);
    const user = req.session.user;
    if (!t) return res.redirect('/panel/moderation?error='+encodeURIComponent('Membre introuvable'));
    const sanctions = (t.sanctions||[]).reverse();
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">⚠️ Sanctions de <span>${t.username}</span></div>
            <div class="page-breadcrumb">${sanctions.length} sanction(s) au total</div>
        </div>
        <a href="/panel/moderation" class="btn btn-outline">← Retour</a>
    </div>
    <div class="card">
        ${sanctions.length===0?'<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucune sanction pour ce membre.</p>':
        '<div style="display:flex;flex-direction:column;gap:.75rem;">'+sanctions.map(s=>{
            const sc={warn:'#f59e0b',kick:'#f59e0b',ban:'#ef4444',suspend:'#f59e0b'}[s.type]||'#888';
            const sl={warn:'⚠️ Avertissement',kick:'👢 Expulsion',ban:'🔨 Bannissement',suspend:'⏸️ Suspension'}[s.type]||s.type;
            return '<div style="padding:1rem;background:var(--bg-tertiary);border-radius:8px;border-left:4px solid '+sc+';">'+
                '<div style="display:flex;justify-content:space-between;"><strong style="color:'+sc+';">'+sl+'</strong><span style="font-size:.75rem;color:var(--text-muted);">'+new Date(s.date).toLocaleString('fr-FR')+'</span></div>'+
                '<p style="color:var(--text-secondary);margin:.5rem 0 0;">'+( s.reason||'Aucune raison')+'</p>'+
                '<small style="color:var(--text-muted);">Par '+s.by+'</small></div>';
        }).join('')+'</div>'}
    </div>`;
    res.send(panelLayout(user,'Sanctions - '+t.username,content,'moderation'));
});


// ============================================================
// ===           MODULES V3 — PANEL OWNER PAGES           ===
// ============================================================

function getPublicSettings(db) {
    return Object.assign({}, DEFAULT_PUBLIC_SETTINGS, db.publicSettings || {});
}

// ── Maintenance Panel ──────────────────────────────────────
app.get('/panel/owner/maintenance', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    const ps = getPublicSettings(db);
    const content = `
    <div class="page-header">
        <div><div class="page-title">🔧 Mode <span>Maintenance</span></div>
        <div class="page-breadcrumb">Contrôle d'accès au site public</div></div>
    </div>
    <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;">
            <div>
                <h3 style="margin-bottom:.5rem;">État actuel</h3>
                <span style="font-size:1.5rem;font-weight:900;color:${ps.maintenanceMode?'#f59e0b':'#10b981'}">
                    ${ps.maintenanceMode?'🔧 MAINTENANCE ACTIVE':'✅ SITE EN LIGNE'}
                </span>
            </div>
            <form action="/panel/owner/maintenance/toggle" method="POST">
                <button type="submit" class="btn ${ps.maintenanceMode?'btn-success':'btn-warning'}" style="font-size:1.1rem;padding:1rem 2rem;">
                    ${ps.maintenanceMode?'✅ Remettre en ligne':'🔧 Activer la maintenance'}
                </button>
            </form>
        </div>
        <form action="/panel/owner/maintenance/message" method="POST">
            <div class="form-group">
                <label class="form-label">Message de maintenance</label>
                <textarea name="message" class="form-control" rows="3" placeholder="Ex: Mise à jour en cours...">${ps.maintenanceMessage||''}</textarea>
            </div>
            <button type="submit" class="btn btn-primary">💾 Sauvegarder le message</button>
        </form>
    </div>`;
    res.send(panelLayout(req.session.user, 'Maintenance', content, 'maintenance'));
});

app.post('/panel/owner/maintenance/toggle', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    db.publicSettings.maintenanceMode = !db.publicSettings.maintenanceMode;
    writeDB(db);
    addLog('MAINTENANCE_TOGGLE', req.session.user.username, 'system', { mode: db.publicSettings.maintenanceMode }, getClientIP(req));
    res.redirect('/panel/owner/maintenance');
});

app.post('/panel/owner/maintenance/message', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    db.publicSettings.maintenanceMessage = req.body.message || '';
    writeDB(db);
    res.redirect('/panel/owner/maintenance?success=1');
});

// ── IP Manager ────────────────────────────────────────────
app.get('/panel/owner/ip-manager', isAuthenticated, hasRole('owner'), async (req, res) => {
    const db = readDB();
    const blocked = db.blockedIPs || [];
    const whitelisted = db.whitelistedIPs || [];
    const isXywez = req.session.user.discordId === SUPER_ADMIN_DISCORD_ID || req.session.user.username === 'xywez';

    // Enrich avec geo
    const enriched = await Promise.all(blocked.slice(0,50).map(async b => {
        if (!b.geo && b.ip) { try { b.geo = await getGeoIP(b.ip); } catch(e){} }
        return b;
    }));

    const content = `
    <div class="page-header">
        <div><div class="page-title">🛡️ Gestionnaire <span>IP</span></div>
        <div class="page-breadcrumb">${blocked.length} IP bloquée(s) · ${whitelisted.length} en whitelist</div></div>
    </div>
    <div class="grid-2" style="gap:1.5rem;margin-bottom:1.5rem;">
        <div class="card">
            <h3 style="margin-bottom:1rem;">🚫 Bloquer une IP</h3>
            <form action="/panel/owner/ip-manager/block" method="POST">
                <div class="form-group">
                    <label class="form-label">Adresse IP</label>
                    <input type="text" name="ip" class="form-control" placeholder="1.2.3.4" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Raison</label>
                    <input type="text" name="reason" class="form-control" placeholder="Raison du blocage">
                </div>
                <button type="submit" class="btn btn-danger btn-full">🚫 Bloquer</button>
            </form>
        </div>
        ${isXywez ? `<div class="card">
            <h3 style="margin-bottom:1rem;">✅ Whitelister une IP</h3>
            <form action="/panel/owner/ip-manager/whitelist" method="POST">
                <div class="form-group">
                    <label class="form-label">Adresse IP</label>
                    <input type="text" name="ip" class="form-control" placeholder="1.2.3.4" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Note</label>
                    <input type="text" name="note" class="form-control" placeholder="Ex: IP de confiance">
                </div>
                <button type="submit" class="btn btn-success btn-full">✅ Whitelister</button>
            </form>
        </div>` : '<div class="card"><p style="color:var(--text-muted);text-align:center;padding:2rem;">🔒 Whitelist réservée à Xywez</p></div>'}
    </div>
    <div class="card">
        <h3 style="margin-bottom:1rem;">🚫 IPs Bloquées (${blocked.length})</h3>
        ${blocked.length === 0 ? '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucune IP bloquée.</p>' :
        '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:2px solid var(--border);"><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">IP</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">GÉO</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">RAISON</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">PAR</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">ACTION</th></tr></thead>' +
        '<tbody>' + enriched.map(b => {
            const g = b.geo || {};
            const vpnBadge = g.vpn ? '<span style="background:#ef444430;color:#ef4444;border:1px solid #ef4444;border-radius:4px;padding:1px 6px;font-size:.7rem;margin-left:4px;">VPN</span>' : '';
            return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:.75rem;font-family:monospace;font-size:.85rem;">${b.ip}</td>
                <td style="padding:.75rem;">${g.emoji||'🌍'} ${g.city||'?'}, ${g.country||'?'}${vpnBadge}</td>
                <td style="padding:.75rem;color:var(--text-muted);font-size:.85rem;">${b.reason||'-'}</td>
                <td style="padding:.75rem;font-size:.85rem;">${b.blockedBy||'-'}</td>
                <td style="padding:.75rem;"><a href="/panel/owner/ip-manager/unblock/${encodeURIComponent(b.ip)}" class="btn btn-sm btn-outline" onclick="return confirm('Débloquer?')">✅ Débloquer</a></td>
            </tr>`;
        }).join('') + '</tbody></table></div>'}
    </div>
    ${isXywez && whitelisted.length > 0 ? `<div class="card">
        <h3 style="margin-bottom:1rem;">✅ IPs Whitelistées (${whitelisted.length})</h3>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid var(--border);"><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">IP</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">NOTE</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">PAR</th><th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.8rem;">ACTION</th></tr></thead>
            <tbody>${whitelisted.map(w => `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:.75rem;font-family:monospace;font-size:.85rem;">${w.ip}</td>
                <td style="padding:.75rem;color:var(--text-muted);font-size:.85rem;">${w.note||'-'}</td>
                <td style="padding:.75rem;font-size:.85rem;">${w.addedBy||'-'}</td>
                <td style="padding:.75rem;"><a href="/panel/owner/ip-manager/remove-whitelist/${encodeURIComponent(w.ip)}" class="btn btn-sm btn-danger" onclick="return confirm('Retirer?')">🗑️</a></td>
            </tr>`).join('')}</tbody>
        </table></div>
    </div>` : ''}`;
    res.send(panelLayout(req.session.user, 'Gestionnaire IP', content, 'ip-manager'));
});

app.post('/panel/owner/ip-manager/block', isAuthenticated, hasRole('owner'), (req, res) => {
    const { ip, reason } = req.body;
    if (!ip) return res.redirect('/panel/owner/ip-manager?error=IP+manquante');
    const db = readDB();
    if (!db.blockedIPs) db.blockedIPs = [];
    if (!db.blockedIPs.find(b => b.ip === ip)) {
        db.blockedIPs.push({ ip, reason: reason||'', blockedBy: req.session.user.username, date: new Date().toISOString(), geo: null });
        addLog('BLOCK_IP', req.session.user.username, ip, { reason }, getClientIP(req));
    }
    writeDB(db);
    res.redirect('/panel/owner/ip-manager?success=1');
});

app.post('/panel/owner/ip-manager/whitelist', isAuthenticated, hasRole('owner'), (req, res) => {
    const isXywez = req.session.user.discordId === SUPER_ADMIN_DISCORD_ID || req.session.user.username === 'xywez';
    if (!isXywez) return res.status(403).send('Réservé à Xywez');
    const { ip, note } = req.body;
    const db = readDB();
    if (!db.whitelistedIPs) db.whitelistedIPs = [];
    if (!db.whitelistedIPs.find(w => w.ip === ip)) {
        db.whitelistedIPs.push({ ip, note: note||'', addedBy: req.session.user.username, date: new Date().toISOString() });
        addLog('WHITELIST_IP', req.session.user.username, ip, { note }, getClientIP(req));
    }
    writeDB(db);
    res.redirect('/panel/owner/ip-manager?success=1');
});

app.get('/panel/owner/ip-manager/unblock/:ip', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    db.blockedIPs = (db.blockedIPs||[]).filter(b => b.ip !== decodeURIComponent(req.params.ip));
    writeDB(db);
    res.redirect('/panel/owner/ip-manager');
});

app.get('/panel/owner/ip-manager/remove-whitelist/:ip', isAuthenticated, hasRole('owner'), (req, res) => {
    const isXywez = req.session.user.discordId === SUPER_ADMIN_DISCORD_ID || req.session.user.username === 'xywez';
    if (!isXywez) return res.status(403).send('Réservé à Xywez');
    const db = readDB();
    db.whitelistedIPs = (db.whitelistedIPs||[]).filter(w => w.ip !== decodeURIComponent(req.params.ip));
    writeDB(db);
    res.redirect('/panel/owner/ip-manager');
});

// ── Logs Géo-IP ──────────────────────────────────────────
app.get('/panel/logs-geo', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const db = readDB();
    const logs = (db.logs || []).slice(0, 200);
    const content = `
    <div class="page-header">
        <div><div class="page-title">🌍 Logs <span>Géo-IP</span></div>
        <div class="page-breadcrumb">${logs.length} entrées — IP + localisation + appareil</div></div>
    </div>
    <div class="card" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:700px;">
            <thead><tr style="border-bottom:2px solid var(--border);">
                <th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;white-space:nowrap;">DATE</th>
                <th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;">ACTION</th>
                <th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;">UTILISATEUR</th>
                <th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;">IP</th>
                <th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;">GÉO</th>
                <th style="padding:.75rem;text-align:left;color:var(--text-muted);font-size:.75rem;">APPAREIL</th>
            </tr></thead>
            <tbody>
                ${logs.map(l => {
                    const g = l.geo || {};
                    const vpnBadge = g.vpn ? '<span style="background:#ef444430;color:#ef4444;border-radius:4px;padding:1px 5px;font-size:.65rem;margin-left:4px;">VPN</span>' : '';
                    const geoStr = g.country ? `${g.emoji||'🌍'} ${g.city||'?'}, ${g.country}${vpnBadge}` : '<span style="color:var(--text-muted);font-size:.8rem;">En attente...</span>';
                    return `<tr style="border-bottom:1px solid var(--border);">
                        <td style="padding:.65rem;font-size:.75rem;color:var(--text-muted);white-space:nowrap;">${new Date(l.timestamp).toLocaleString('fr-FR')}</td>
                        <td style="padding:.65rem;font-size:.8rem;"><span style="background:rgba(147,51,234,.2);color:#c084fc;border-radius:4px;padding:2px 8px;">${l.action||'?'}</span></td>
                        <td style="padding:.65rem;font-size:.85rem;font-weight:600;">${l.executor||'?'}</td>
                        <td style="padding:.65rem;font-family:monospace;font-size:.8rem;">${l.ip||'-'}</td>
                        <td style="padding:.65rem;font-size:.85rem;">${geoStr}</td>
                        <td style="padding:.65rem;font-size:.75rem;color:var(--text-muted);">${l.device||''} ${l.browser||''} ${l.os||''}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    </div>`;
    res.send(panelLayout(req.session.user, 'Logs Géo-IP', content, 'logs-geo'));
});

// ── Public Settings ───────────────────────────────────────
app.get('/panel/owner/public-settings', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    const ps = getPublicSettings(db);
    const content = `
    <div class="page-header">
        <div><div class="page-title">🎨 Personnalisation <span>Site Public</span></div>
        <div class="page-breadcrumb">Apparence et contenu des pages publiques</div></div>
    </div>
    <form action="/panel/owner/public-settings" method="POST">
        <div class="grid-2" style="gap:1.5rem;">
            <div class="card">
                <h3 style="margin-bottom:1.5rem;">🏠 Page d'accueil</h3>
                <div class="form-group">
                    <label class="form-label">Titre principal</label>
                    <input type="text" name="heroTitle" value="${ps.heroTitle||'FTY CLUB PRO'}" class="form-control">
                </div>
                <div class="form-group">
                    <label class="form-label">Sous-titre</label>
                    <input type="text" name="heroSubtitle" value="${ps.heroSubtitle||''}" class="form-control">
                </div>
                <div class="form-group">
                    <label class="form-label">Lien Discord</label>
                    <input type="text" name="discordInvite" value="${ps.discordInvite||''}" class="form-control">
                </div>
                <div class="form-group">
                    <label class="form-label">Footer personnalisé</label>
                    <input type="text" name="customFooter" value="${ps.customFooter||''}" class="form-control">
                </div>
            </div>
            <div class="card">
                <h3 style="margin-bottom:1.5rem;">🎨 Couleurs</h3>
                <div class="form-group">
                    <label class="form-label">Couleur principale</label>
                    <div style="display:flex;gap:.75rem;align-items:center;">
                        <input type="color" name="primaryColor" value="${ps.primaryColor||'#9333ea'}" style="width:48px;height:48px;border:none;background:none;cursor:pointer;">
                        <input type="text" name="primaryColorText" value="${ps.primaryColor||'#9333ea'}" class="form-control" style="font-family:monospace;" readonly>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Couleur accent</label>
                    <div style="display:flex;gap:.75rem;align-items:center;">
                        <input type="color" name="accentColor" value="${ps.accentColor||'#ec4899'}" style="width:48px;height:48px;border:none;background:none;cursor:pointer;">
                        <input type="text" name="accentColorText" value="${ps.accentColor||'#ec4899'}" class="form-control" style="font-family:monospace;" readonly>
                    </div>
                </div>
                <h3 style="margin:1.5rem 0 1rem;">📌 Sections visibles</h3>
                <div style="display:flex;flex-direction:column;gap:.75rem;">
                    ${[['showStats','📊 Statistiques'],['showMatchs','⚽ Matchs'],['showTactique','🎯 Tactique'],['showEquipe','👥 Équipe'],['chatbotEnabled','🤖 Chatbot'],['guideEnabled','📖 Guide']].map(([k,l]) =>
                        `<label style="display:flex;align-items:center;gap:.75rem;cursor:pointer;"><input type="checkbox" name="${k}" ${ps[k]?'checked':''} style="width:18px;height:18px;accent-color:var(--primary);"> ${l}</label>`
                    ).join('')}
                </div>
            </div>
        </div>
        <div class="card" style="margin-top:1.5rem;">
            <h3 style="margin-bottom:1rem;">📢 Bannière d'annonce</h3>
            <div class="form-group">
                <label class="form-label">Texte de la bannière</label>
                <input type="text" name="announcementBanner" value="${ps.announcementBanner||''}" class="form-control" placeholder="Ex: Match ce soir à 20h !">
            </div>
            <label style="display:flex;align-items:center;gap:.75rem;cursor:pointer;">
                <input type="checkbox" name="announcementActive" ${ps.announcementActive?'checked':''} style="width:18px;height:18px;accent-color:var(--primary);">
                <span>Activer la bannière</span>
            </label>
        </div>
        <div style="margin-top:1.5rem;">
            <button type="submit" class="btn btn-primary btn-full" style="font-size:1.1rem;padding:1.25rem;">💾 Sauvegarder toutes les modifications</button>
        </div>
    </form>`;
    res.send(panelLayout(req.session.user, 'Personnalisation', content, 'public-settings'));
});

app.post('/panel/owner/public-settings', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    const b = req.body;
    db.publicSettings.heroTitle = b.heroTitle || 'FTY CLUB PRO';
    db.publicSettings.heroSubtitle = b.heroSubtitle || '';
    db.publicSettings.discordInvite = b.discordInvite || '';
    db.publicSettings.customFooter = b.customFooter || '';
    db.publicSettings.primaryColor = b.primaryColor || '#9333ea';
    db.publicSettings.accentColor = b.accentColor || '#ec4899';
    db.publicSettings.showStats = !!b.showStats;
    db.publicSettings.showMatchs = !!b.showMatchs;
    db.publicSettings.showTactique = !!b.showTactique;
    db.publicSettings.showEquipe = !!b.showEquipe;
    db.publicSettings.chatbotEnabled = !!b.chatbotEnabled;
    db.publicSettings.guideEnabled = !!b.guideEnabled;
    db.publicSettings.announcementBanner = b.announcementBanner || '';
    db.publicSettings.announcementActive = !!b.announcementActive;
    writeDB(db);
    res.redirect('/panel/owner/public-settings?success=1');
});

// ── Chatbot API ───────────────────────────────────────────
const CHATBOT_RESPONSES = [
    { keys: ['rejoindre','join','comment','intégrer','entrer'], reply: '🎯 Pour rejoindre FTY Club Pro, remplis le formulaire de candidature sur <a href="/candidature" style="color:#c084fc;">cette page</a> !' },
    { keys: ['discord','serveur','lien'], reply: '💬 Rejoins notre serveur Discord ! Lien disponible en haut de la page d\'accueil.' },
    { keys: ['tactique','formation','compo'], reply: '⚽ Tu peux voir notre tactique en direct sur la page <a href="/tactique" style="color:#c084fc;">/tactique</a> !' },
    { keys: ['match','prochain','calendrier'], reply: '📅 Retrouve tous nos matchs sur la page <a href="/#matchs" style="color:#c084fc;">Matchs</a> de l\'accueil.' },
    { keys: ['recrutement','recrute','poste','joueur'], reply: '🎯 Nous recrutons ! Voir les postes ouverts sur <a href="/recrutement" style="color:#c084fc;">/recrutement</a>.' },
    { keys: ['guide','règles','règlement'], reply: '📖 Consulte notre guide complet sur <a href="/guide" style="color:#c084fc;">/guide</a>.' },
    { keys: ['palmares','victoire','résultat','titre'], reply: '🏆 Retrouve tous nos résultats sur <a href="/palmares" style="color:#c084fc;">/palmares</a>.' },
    { keys: ['contact','mail','email'], reply: '📧 Contacte-nous via Discord ou le formulaire de candidature.' },
    { keys: ['bonjour','salut','hello','yo'], reply: '👋 Salut ! Comment puis-je t\'aider ? Rejoindre l\'équipe, infos sur les matchs, recrutement ?' },
    { keys: ['merci','thanks'], reply: '😊 De rien ! N\'hésite pas si tu as d\'autres questions.' },
];

app.post('/api/chatbot', async (req, res) => {
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
    const msg = (req.body.message || '').toLowerCase().trim();
    if (!msg) return res.json({ reply: '❓ Tu n\'as rien écrit !' });
    for (const r of CHATBOT_RESPONSES) {
        if (r.keys.some(k => msg.includes(k))) return res.json({ reply: r.reply });
    }
    res.json({ reply: '🤖 Je n\'ai pas compris. Tu peux me demander : comment rejoindre, les matchs, la tactique, le recrutement, ou le guide !' });
});

// ── New Public Pages ──────────────────────────────────────
app.get('/guide', (req, res) => {
    const db = readDB();
    const ps = getPublicSettings(db);
    const content = `
    <section style="padding:6rem 0 4rem;">
        <div class="container">
            <h1 class="display-1" style="text-align:center;font-size:clamp(2rem,6vw,4rem);margin-bottom:1rem;">📖 GUIDE FTY</h1>
            <p style="text-align:center;color:var(--text-muted);font-size:1.1rem;margin-bottom:3rem;">Tout ce que tu dois savoir pour rejoindre et évoluer</p>
            <div class="grid-2" style="gap:2rem;">
                <div class="card"><h3 style="color:var(--primary);margin-bottom:1rem;">🎯 Comment rejoindre</h3>
                    <ol style="padding-left:1.5rem;color:var(--text-secondary);line-height:2.2;">
                        <li>Remplis le formulaire de candidature</li>
                        <li>Attends la validation du staff</li>
                        <li>Rejoint le serveur Discord</li>
                        <li>Présente-toi dans #général</li>
                        <li>Participe à ton premier match !</li>
                    </ol>
                </div>
                <div class="card"><h3 style="color:var(--secondary);margin-bottom:1rem;">📋 Règlement</h3>
                    <ul style="padding-left:1.5rem;color:var(--text-secondary);line-height:2.2;">
                        <li>Respect envers tous les membres</li>
                        <li>Présence obligatoire aux matchs prévus</li>
                        <li>Communication via Discord</li>
                        <li>Fair-play en compétition</li>
                        <li>Signaler toute absence au staff</li>
                    </ul>
                </div>
                <div class="card"><h3 style="color:var(--accent);margin-bottom:1rem;">🎮 Jeux & Plateformes</h3>
                    <p style="color:var(--text-secondary);">FTY Club Pro est actif sur :</p>
                    <div style="display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1rem;">
                        ${['⚽ EA FC', '🎮 FIFA', '🏆 eLiga', '🌐 PC', '🎮 Console'].map(g => `<span style="background:rgba(147,51,234,.2);color:#c084fc;border:1px solid rgba(147,51,234,.4);border-radius:20px;padding:.4rem 1rem;font-size:.9rem;">${g}</span>`).join('')}
                    </div>
                </div>
                <div class="card"><h3 style="color:#10b981;margin-bottom:1rem;">✨ Avantages membre</h3>
                    <ul style="padding-left:1.5rem;color:var(--text-secondary);line-height:2.2;">
                        <li>Accès au panel membre</li>
                        <li>Coaching et stratégie</li>
                        <li>Tournois internes</li>
                        <li>Communauté active</li>
                        <li>Évolution de rang possible</li>
                    </ul>
                </div>
            </div>
            <div style="text-align:center;margin-top:3rem;">
                <a href="/candidature" class="btn btn-primary" style="font-size:1.1rem;padding:1rem 3rem;">🚀 Postuler maintenant</a>
            </div>
        </div>
    </section>`;
    res.send(publicLayoutV3(ps, 'Guide', content));
});

app.get('/palmares', (req, res) => {
    const db = readDB();
    const ps = getPublicSettings(db);
    const stats = db.stats || DEFAULT_STATS;
    const matches = (db.matches || []).filter(m => m.status === 'finished').slice(0, 10);
    const content = `
    <section style="padding:6rem 0 4rem;">
        <div class="container">
            <h1 class="display-1" style="text-align:center;font-size:clamp(2rem,6vw,4rem);margin-bottom:1rem;">🏆 PALMARÈS</h1>
            <p style="text-align:center;color:var(--text-muted);font-size:1.1rem;margin-bottom:3rem;">Nos résultats et statistiques</p>
            <div class="grid-4" style="margin-bottom:3rem;">
                ${[['⚽',stats.wins||0,'Victoires','#10b981'],['🤝',stats.draws||0,'Nuls','#f59e0b'],['😤',stats.losses||0,'Défaites','#ef4444'],['🎯',stats.goals||0,'Buts','#9333ea']].map(([ico,val,lab,col]) => `
                <div class="card" style="text-align:center;border-color:${col}40;">
                    <div style="font-size:2.5rem;margin-bottom:.5rem;">${ico}</div>
                    <div style="font-size:3rem;font-weight:900;color:${col};font-family:var(--font-display);">${val}</div>
                    <div style="color:var(--text-muted);">${lab}</div>
                </div>`).join('')}
            </div>
            <div class="card">
                <h3 style="margin-bottom:1.5rem;">📅 Derniers Résultats</h3>
                ${matches.length === 0 ? '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun résultat enregistré.</p>' :
                '<div style="display:flex;flex-direction:column;gap:.75rem;">' + matches.map(m => {
                    const scores = (m.score||'?-?').split('-');
                    const ftyScore = parseInt(scores[0]||0);
                    const advScore = parseInt(scores[1]||0);
                    const won = ftyScore > advScore;
                    const col = won ? '#10b981' : ftyScore < advScore ? '#ef4444' : '#f59e0b';
                    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:1rem;background:var(--bg-tertiary);border-radius:10px;border-left:4px solid ${col};">
                        <div><strong>FTY</strong> vs <strong>${m.adversaire||'?'}</strong><div style="font-size:.8rem;color:var(--text-muted);margin-top:.25rem;">${m.competition||''} · ${m.date||''}</div></div>
                        <div style="font-size:1.5rem;font-weight:900;font-family:var(--font-display);color:${col};">${m.score||'?'}</div>
                    </div>`;
                }).join('') + '</div>'}
            </div>
        </div>
    </section>`;
    res.send(publicLayoutV3(ps, 'Palmarès', content));
});

app.get('/recrutement', (req, res) => {
    const db = readDB();
    const ps = getPublicSettings(db);
    const content = `
    <section style="padding:6rem 0 4rem;">
        <div class="container">
            <h1 class="display-1" style="text-align:center;font-size:clamp(2rem,6vw,4rem);margin-bottom:1rem;">🎯 RECRUTEMENT</h1>
            <p style="text-align:center;color:var(--text-muted);font-size:1.1rem;margin-bottom:3rem;">Rejoins l'équipe FTY Club Pro</p>
            <div class="grid-3" style="gap:2rem;margin-bottom:3rem;">
                ${[
                    { icon:'⚽', title:'Joueurs', desc:'Cherchons des joueurs passionnés, réguliers et fair-play. Tous niveaux bienvenus.', color:'#9333ea' },
                    { icon:'🛡️', title:'Modérateurs', desc:'Tu veux gérer la communauté Discord ? Postule pour rejoindre le staff de modération.', color:'#ec4899' },
                    { icon:'🎧', title:'Support', desc:'Aide les membres, réponds aux questions, gère les candidatures.', color:'#f59e0b' }
                ].map(p => `
                <div class="card" style="text-align:center;border-color:${p.color}40;">
                    <div style="font-size:3rem;margin-bottom:1rem;">${p.icon}</div>
                    <h3 style="color:${p.color};margin-bottom:.75rem;">${p.title}</h3>
                    <p style="color:var(--text-secondary);margin-bottom:1.5rem;">${p.desc}</p>
                    <span style="background:rgba(16,185,129,.2);color:#10b981;border:1px solid #10b98140;border-radius:20px;padding:.3rem 1rem;font-size:.85rem;">🟢 Ouvert</span>
                </div>`).join('')}
            </div>
            <div style="text-align:center;">
                <h2 style="margin-bottom:1rem;">Prêt(e) à nous rejoindre ?</h2>
                <a href="/candidature" class="btn btn-primary" style="font-size:1.1rem;padding:1rem 3rem;">📋 Postuler maintenant</a>
            </div>
        </div>
    </section>`;
    res.send(publicLayoutV3(ps, 'Recrutement', content));
});

app.get('/tactique', (req, res) => {
    const db = readDB();
    const ps = getPublicSettings(db);
    const tactic = (db.serverConfig && db.serverConfig.tactic) || { formation: '4-3-3', style: 'Équilibré', mentality: 'Normal' };
    const content = `
    <section style="padding:6rem 0 4rem;">
        <div class="container">
            <h1 class="display-1" style="text-align:center;font-size:clamp(2rem,6vw,4rem);margin-bottom:1rem;">⚽ TACTIQUE</h1>
            <p style="text-align:center;color:var(--text-muted);font-size:1.1rem;margin-bottom:2rem;">Formation officielle mise à jour en temps réel</p>
            <div class="grid-2" style="gap:2rem;">
                <div class="card" style="text-align:center;">
                    <div style="font-size:4rem;font-weight:900;color:var(--primary);font-family:var(--font-display);margin-bottom:.5rem;">${tactic.formation||'N/A'}</div>
                    <div style="color:var(--text-muted);margin-bottom:1.5rem;">Formation</div>
                    <div style="display:flex;flex-wrap:wrap;gap:.75rem;justify-content:center;">
                        ${[['🎯',tactic.style||'N/A','Style'],['🧠',tactic.mentality||'N/A','Mentalité']].map(([i,v,l]) =>
                            `<div style="background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.3);border-radius:12px;padding:.75rem 1.25rem;text-align:center;"><div style="font-size:1.5rem;">${i}</div><div style="font-weight:700;color:var(--primary);">${v}</div><div style="font-size:.75rem;color:var(--text-muted);">${l}</div></div>`
                        ).join('')}
                    </div>
                    ${tactic.updatedAt ? `<p style="color:var(--text-muted);font-size:.8rem;margin-top:1rem;">Mis à jour le ${new Date(tactic.updatedAt).toLocaleString('fr-FR')}</p>` : ''}
                </div>
                <div class="card">
                    <h3 style="margin-bottom:1rem;">📋 Instructions</h3>
                    ${(tactic.instructions||['Pressing haut','Transitions rapides','Construction courte']).map(i =>
                        `<div style="padding:.75rem;background:var(--bg-tertiary);border-radius:8px;margin-bottom:.5rem;color:var(--text-secondary);">✓ ${i}</div>`
                    ).join('')}
                </div>
            </div>
        </div>
    </section>`;
    res.send(publicLayoutV3(ps, 'Tactique', content));
});

// ── publicLayoutV3 — layout public avec chatbot intégré ──
function publicLayoutV3(ps, title, content) {
    const primary = ps.primaryColor || '#9333ea';
    const accent = ps.accentColor || '#ec4899';
    const theme = ps.theme || 'dark';
    
    return `<!DOCTYPE html>
<html lang="fr" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${ps.teamName || 'FTY Club'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@700;900&family=Titillium+Web:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
    /* Couleurs principales */
    --primary:#00FFA3;
    --secondary:#00D4FF;
    --accent:#FF006B;
    --purple:#9333EA;
    
    /* Fond et surfaces */
    --bg:#000000;
    --bg-secondary:#0A0A0F;
    --bg-tertiary:#141420;
    --bg-card:rgba(20,20,32,0.6);
    --bg-card-hover:rgba(20,20,32,0.9);
    
    /* Texte */
    --text:#FFFFFF;
    --text-secondary:rgba(255,255,255,0.8);
    --text-muted:rgba(255,255,255,0.5);
    
    /* Bordures et ombres */
    --border:rgba(0,255,163,0.2);
    --glow-primary:0 0 20px rgba(0,255,163,0.5);
    --glow-secondary:0 0 20px rgba(0,212,255,0.5);
    --glow-accent:0 0 20px rgba(255,0,107,0.5);
    
    /* Fonts */
    --font-display:'Exo 2','Orbitron',sans-serif;
    --font-body:'Inter','Roboto',sans-serif;
    
    /* Transitions */
    --transition:all 0.3s cubic-bezier(0.4,0,0.2,1);
}

[data-theme=dark]{--primary:body{font-family:var(--font-body);background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;line-height:1.6}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(147,51,234,.15),transparent 60%),radial-gradient(ellipse at 80% 30%,rgba(236,72,153,.1),transparent 60%);pointer-events:none;z-index:0}
.container{max-width:1200px;margin:0 auto;padding:0 1.5rem}
@media(max-width:768px){.container{padding:0 1rem}}
nav{position:sticky;top:0;z-index:100;background:rgba(0,0,0,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);}
.nav-inner{display:flex;align-items:center;justify-content:space-between;padding:.875rem 1.5rem;max-width:1200px;margin:0 auto;}
.nav-logo{font-family:var(--font-display);font-size:1.35rem;font-weight:900;background:linear-gradient(135deg,var(--primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none;}
.nav-links{display:flex;gap:1.5rem;list-style:none;align-items:center;}
.nav-links a{color:rgba(255,255,255,.7);text-decoration:none;font-size:.9rem;font-weight:600;transition:color .2s;white-space:nowrap;}
.nav-links a:hover{color:#fff}
.nav-toggle{display:none;background:none;border:1px solid var(--border);border-radius:8px;width:40px;height:40px;cursor:pointer;font-size:1.25rem;color:#fff;align-items:center;justify-content:center;}
@media(max-width:768px){
.nav-toggle{display:flex}
.nav-links{display:none;position:fixed;top:60px;left:0;right:0;background:rgba(0,0,0,.97);border-bottom:1px solid var(--border);flex-direction:column;padding:1rem;gap:0;z-index:99;}
.nav-links.open{display:flex}
.nav-links a{padding:.875rem 1rem;border-radius:8px;font-size:1rem;display:block;}
.nav-links a:hover{background:rgba(147,51,234,.15)}
}
.grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:2rem}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:2rem}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:2rem}
@media(max-width:1024px){.grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr;gap:1rem}}
.card{background:rgba(147,51,234,.08);border:1px solid var(--border);border-radius:16px;padding:1.75rem;transition:transform .2s,box-shadow .2s;position:relative;overflow:hidden;}
.card:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(147,51,234,.25);}
@media(max-width:640px){.card{padding:1.25rem;border-radius:12px}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.875rem 2rem;font-family:var(--font-display);font-weight:700;border:none;border-radius:10px;cursor:pointer;text-decoration:none;transition:all .2s;font-size:.95rem;}
.btn-primary{background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;box-shadow:0 4px 20px rgba(147,51,234,.4);}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(147,51,234,.6);}
@media(max-width:640px){.btn{padding:.75rem 1.25rem;font-size:.875rem}}
.display-1{font-family:var(--font-display);font-weight:900;background:linear-gradient(135deg,var(--primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.form-group{margin-bottom:1.25rem}
.form-label{display:block;margin-bottom:.5rem;font-weight:600;font-size:.9rem;color:rgba(255,255,255,.8)}
.form-control{width:100%;background:rgba(147,51,234,.1);border:1px solid rgba(147,51,234,.4);border-radius:8px;padding:.75rem 1rem;color:#fff;font-size:.95rem;font-family:inherit;outline:none;transition:border-color .2s}
.form-control:focus{border-color:var(--primary)}
.ann-banner{background:linear-gradient(135deg,var(--primary),var(--accent));padding:.75rem 1rem;text-align:center;font-weight:700;font-size:.9rem;position:relative;z-index:101;}
footer{background:rgba(0,0,0,.8);border-top:1px solid var(--border);padding:3rem 1.5rem;text-align:center;margin-top:6rem;color:rgba(255,255,255,.5);font-size:.875rem;}
#fty-chat-btn{position:fixed;bottom:24px;right:24px;z-index:10000;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--accent));border:none;cursor:pointer;font-size:1.5rem;box-shadow:0 6px 24px rgba(147,51,234,.6);transition:transform .2s;display:flex;align-items:center;justify-content:center;}
#fty-chat-btn:hover{transform:scale(1.1)}
#fty-chat-win{position:fixed;bottom:94px;right:24px;z-index:10000;width:320px;height:420px;background:#0a0014;border:2px solid var(--primary);border-radius:16px;overflow:hidden;display:none;flex-direction:column;box-shadow:0 20px 60px rgba(147,51,234,.5);}
#fty-chat-win.open{display:flex;animation:chatIn .2s ease}
@keyframes chatIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:400px){
#fty-chat-win{width:calc(100vw - 16px);height:calc(100vh - 100px);right:8px;bottom:80px}
#fty-chat-btn{bottom:16px;right:16px;width:52px;height:52px}
}
#fty-msgs{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.6rem;scrollbar-width:thin;scrollbar-color:var(--primary) #0a0014}
.msg-bot{background:rgba(147,51,234,.2);border-radius:8px 8px 8px 0;padding:.65rem .875rem;color:#fff;font-size:.875rem;max-width:88%;border:1px solid rgba(147,51,234,.3);}
.msg-user{background:linear-gradient(135deg,rgba(147,51,234,.5),rgba(236,72,153,.4));border-radius:8px 8px 0 8px;padding:.65rem .875rem;color:#fff;font-size:.875rem;max-width:88%;align-self:flex-end;}
@media(max-width:768px){
table{font-size:.8rem;display:block;overflow-x:auto}
td,th{padding:.5rem!important}
}


/* ========== PATCH: CSS RESPONSIVE MOBILE ========== */
@media (max-width: 768px) {
    .container { 
        padding: 0 1rem !important; 
    }
    
    .page-header { 
        flex-direction: column !important; 
        gap: 1rem !important; 
    }
    
    .page-title { 
        font-size: 1.75rem !important; 
    }
    
    .grid-2, .grid-3, .grid-4 { 
        grid-template-columns: 1fr !important; 
        gap: 1rem !important;
    }
    
    .card { 
        padding: 1.25rem !important; 
        border-radius: 12px !important;
    }
    
    .btn { 
        padding: 0.75rem 1.25rem !important;
        font-size: 0.875rem !important;
        width: 100%;
        justify-content: center;
    }
    
    .form-control, .form-select, input, textarea, select {
        font-size: 16px !important; /* Évite le zoom automatique sur iOS */
    }
    
    table {
        display: block;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        font-size: 0.85rem;
    }
    
    td, th {
        padding: 0.5rem !important;
        white-space: nowrap;
    }
    
    .mobile-hidden { 
        display: none !important; 
    }
    
    /* Navigation mobile */
    .navbar-menu, .nav-links {
        position: fixed;
        top: 80px;
        left: 0;
        right: 0;
        background: rgba(0,0,0,0.98);
        flex-direction: column;
        padding: 1rem;
        transform: translateX(-100%);
        transition: transform 0.3s ease;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        max-height: calc(100vh - 80px);
        overflow-y: auto;
        z-index: 9999;
    }
    
    .navbar-menu.active, .nav-links.open {
        transform: translateX(0);
    }
    
    .navbar-toggle, .nav-toggle {
        display: flex !important;
    }
    
    /* Tactique terrain responsive */
    .tactique-grid {
        grid-template-columns: 1fr !important;
    }
    
    .tactique-terrain {
        min-height: 500px !important;
    }
}

@media (max-width: 480px) {
    .page-title { 
        font-size: 1.5rem !important; 
    }
    
    .section-title { 
        font-size: 1.75rem !important; 
    }
    
    .card { 
        padding: 1rem !important; 
    }
    
    .display-1, .display-2 {
        font-size: 2rem !important;
    }
}

</style>
</head>
<body>
${ps.announcementActive && ps.announcementBanner ? `<div class="ann-banner">📢 ${ps.announcementBanner}</div>` : ''}
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo">⚽ FTY CLUB</a>
    <button class="nav-toggle" onclick="document.getElementById('navlinks').classList.toggle('open')">☰</button>
    <ul class="nav-links" id="navlinks">
      <li><a href="/">🏠 Accueil</a></li>
      <li><a href="/tactique">⚽ Tactique</a></li>
      <li><a href="/palmares">🏆 Palmarès</a></li>
      <li><a href="/recrutement">🎯 Recrutement</a></li>
      <li><a href="/guide">📖 Guide</a></li>
      <li><a href="/candidature">📋 Candidature</a></li>
      <li><a href="/panel/login" style="background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff!important;padding:.45rem 1rem;border-radius:8px;">🔑 Panel</a></li>
    </ul>
  </div>
</nav>
<div style="position:relative;z-index:1;">
${content}
</div>
<footer>
  <p style="margin-bottom:.5rem;font-family:'Exo 2',sans-serif;font-size:1rem;font-weight:700;background:linear-gradient(135deg,var(--primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">⚽ FTY CLUB PRO</p>
  <p>${ps.customFooter || '© 2026 FTY Club Pro'}</p>
</footer>
${ps.chatbotEnabled !== false ? `
<button id="fty-chat-btn" onclick="ftyToggle()" title="FTY Bot">🤖</button>
<div id="fty-chat-win">
  <div style="background:linear-gradient(135deg,var(--primary),var(--accent));padding:.875rem 1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
    <div style="display:flex;align-items:center;gap:.5rem;color:#fff;font-weight:700;font-size:.9rem;"><span>🤖</span><span>FTY Bot</span><span style="width:7px;height:7px;background:#22c55e;border-radius:50%;"></span></div>
    <button onclick="ftyToggle()" style="background:rgba(0,0,0,.25);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;">×</button>
  </div>
  <div id="fty-msgs"><div class="msg-bot">👋 Salut ! Je suis le bot FTY. Demande-moi : rejoindre, tactique, matchs, recrutement...</div></div>
  <div style="padding:.75rem;border-top:1px solid rgba(147,51,234,.4);display:flex;gap:.5rem;flex-shrink:0;background:#0f0318;">
    <input id="fty-inp" type="text" placeholder="Écris ton message..." autocomplete="off"
      style="flex:1;background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.4);border-radius:8px;padding:.5rem .75rem;color:#fff;font-size:.875rem;outline:none;"
      onkeydown="if(event.key==='Enter'){event.preventDefault();ftySend();}">
    <button onclick="ftySend()" style="background:linear-gradient(135deg,var(--primary),var(--accent));border:none;border-radius:8px;padding:.5rem .875rem;color:#fff;cursor:pointer;font-size:1rem;">➤</button>
  </div>
</div>
<script>
function ftyToggle(){var w=document.getElementById('fty-chat-win');w.classList.toggle('open');if(w.classList.contains('open'))setTimeout(function(){document.getElementById('fty-inp').focus()},50);}
function ftyAddMsg(txt,type){var m=document.getElementById('fty-msgs');var d=document.createElement('div');d.className=type==='user'?'msg-user':'msg-bot';d.innerHTML=txt;m.appendChild(d);m.scrollTop=m.scrollHeight;return d;}
async function ftySend(){var inp=document.getElementById('fty-inp');var msg=inp.value.trim();if(!msg)return;inp.value='';ftyAddMsg(msg,'user');var t=ftyAddMsg('✏️ En train d\\'écrire...','bot');t.style.opacity='.5';try{var r=await fetch('/api/chatbot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});var d=await r.json();t.remove();ftyAddMsg(d.reply||'🤖','bot');}catch(e){t.remove();ftyAddMsg('❌ Erreur connexion','bot');}}
</scr${''}ipt>` : ''}
</body></html>`;
}



// ── API pour les routes V3 ────────────────────────────────
app.get('/api/geo/:ip', async (req, res) => {
    try {
        const geo = await getGeoIP(req.params.ip);
        res.json(geo);
    } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/maintenance', (req, res) => {
    const key = req.headers['x-api-key'];
    if (key !== PANEL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    db.publicSettings.maintenanceMode = !!req.body.enabled;
    if (req.body.message) db.publicSettings.maintenanceMessage = req.body.message;
    writeDB(db);
    res.json({ success: true, maintenanceMode: db.publicSettings.maintenanceMode });
});

app.listen(PORT, () => {
    console.log('[FTY CLUB PRO V3] Serveur demarre sur port ' + PORT);
    console.log('  Panel: /panel/login | Maintenance: /panel/owner/maintenance');
});
