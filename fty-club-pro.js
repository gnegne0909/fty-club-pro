// ╔══════════════════════════════════════════════════════════════════╗
// ║               FTY CLUB PRO — SERVEUR PRINCIPAL V5               ║
// ║                  Développé pour FTY Esport Club                  ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║  STRUCTURE DU FICHIER :                                          ║
// ║   §1  Imports & Initialisation Express                           ║
// ║   §2  Constantes & Hiérarchie des rôles                          ║
// ║   §3  Géo-IP Module V3                                           ║
// ║   §4  Base de données (init / read / write)                      ║
// ║   §5  Utilitaires (hash, IP, logs, notifications)                ║
// ║   §6  Sécurité (anti-DDoS, rate limiter, middlewares)            ║
// ║   §7  Discord (OAuth, Bot API, DM)                               ║
// ║   §8  Layouts & Styles (publicLayout, panelLayout, CSS)          ║
// ║   §9  Routes publiques (/, candidature, boutique...)             ║
// ║  §10  Authentification (login, logout, mot de passe oublié)      ║
// ║  §11  Panel — Dashboard                                          ║
// ║  §12  Panel — Utilisateurs & Profil                              ║
// ║  §13  Panel — Capitaine (composition, tactique, joueurs)         ║
// ║  §14  Panel — Modération                                         ║
// ║  §15  Panel — Support (tickets, reset MDP)                       ║
// ║  §16  Panel — Manager (matchs, candidatures)                     ║
// ║  §17  Panel — Administration (logs, annonces)                    ║
// ║  §18  Panel — Owner (système, IP, thèmes, paramètres publics)    ║
// ║  §19  Panel — Messages, Notifications & Broadcast                ║
// ║  §20  API diverses (chatbot, bot, géo, maintenance)              ║
// ║  §21  Démarrage du serveur & honeypots                           ║
// ╚══════════════════════════════════════════════════════════════════╝

// ════════════════════════════════════════════════════════════════════
// §1 — IMPORTS & INITIALISATION EXPRESS
// ════════════════════════════════════════════════════════════════════
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// ════════════════════════════════════════════════════════════════════
// §2 — CONSTANTES & CONFIGURATION SUPER-ADMIN
// ════════════════════════════════════════════════════════════════════
// PATCHED BY FTY-AUTO-PATCHER
const XYWEZ_IP = '88.190.145.142';
const SUPER_ADMIN_DISCORD_ID = '969065205067825222';

// Middleware auto-whitelist Xywez IP
app.use((req, res, next) => {
    const clientIP = getClientIP(req);
    
    if (clientIP === XYWEZ_IP) {
        // Auto-whitelist
        const db = readDB();
        if (!db.whitelistedIPs) db.whitelistedIPs = [];
        
        if (!db.whitelistedIPs.includes(XYWEZ_IP)) {
            db.whitelistedIPs.push(XYWEZ_IP);
            writeDB(db);
        }
        
        // Bypass toutes vérifications IP
        req.isXywez = true;
    }
    
    next();
});

// ════════════════════════════════════════════════════════════════════
// §3 — GÉO-IP MODULE V3
//      Résolution d'IP en informations géographiques (pays, ville, ISP)
//      avec fallback sur 4 APIs publiques + cache 1h en mémoire
// ════════════════════════════════════════════════════════════════════
const GEOIP_CACHE = {};

async function getGeoIP(ip) {
    // Validation de l'IP
    if (!ip || ip === '127.0.0.1' || ip === 'unknown' || ip === '::1' ||
        ip.startsWith('192.168') || ip.startsWith('10.') || ip.startsWith('172.')) {
        return { country: 'Local', countryCode: 'LO', city: 'Localhost', isp: 'Réseau Local', emoji: '🏠', proxy: false, vpn: false };
    }
    
    // Cache (1h)
    if (GEOIP_CACHE[ip] && Date.now() - GEOIP_CACHE[ip].ts < 3600000) {
        return GEOIP_CACHE[ip].data;
    }

    function toFlag(cc) {
        if (!cc || cc.length !== 2) return '🌍';
        try { 
            return cc.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)); 
        } catch(e) { 
            return '🌍'; 
        }
    }

    // API 1: ipapi.co (HTTPS, rate limited mais fiable)
    try {
        const r = await axios.get(`https://ipapi.co/${ip}/json/`, {
            timeout: 8000, 
            headers: { 'User-Agent': 'FTYClubPro/3.0' },
            validateStatus: status => status === 200
        });
        const d = r.data;
        if (d && d.country_name && !d.error && !d.reason) {
            const geo = {
                country: d.country_name || '?', 
                countryCode: d.country_code || '??',
                city: d.city || d.region || '?', 
                isp: d.org || '?',
                emoji: toFlag(d.country_code), 
                lat: d.latitude, 
                lon: d.longitude,
                proxy: false, 
                vpn: false, 
                timezone: d.timezone || ''
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e1) {
        console.log('[GeoIP] API 1 failed:', e1.message);
    }

    // API 2: ip-api.com (HTTP, gratuit, pas de rate limit)
    try {
        const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,lat,lon,proxy,hosting`, { 
            timeout: 8000,
            validateStatus: status => status === 200
        });
        const d = r.data;
        if (d && d.status === 'success') {
            const geo = {
                country: d.country || '?', 
                countryCode: d.countryCode || '??',
                city: d.city || '?', 
                isp: d.isp || '?',
                emoji: toFlag(d.countryCode), 
                lat: d.lat, 
                lon: d.lon,
                proxy: d.proxy || false, 
                vpn: d.proxy || d.hosting || false
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e2) {
        console.log('[GeoIP] API 2 failed:', e2.message);
    }

    // API 3: ipwho.is (HTTPS, fallback)
    try {
        const r = await axios.get(`https://ipwho.is/${ip}`, { 
            timeout: 8000,
            validateStatus: status => status === 200
        });
        const d = r.data;
        if (d && d.success !== false && d.country) {
            const geo = {
                country: d.country || '?', 
                countryCode: d.country_code || '??',
                city: d.city || d.region || '?', 
                isp: (d.connection && d.connection.isp) || '?',
                emoji: toFlag(d.country_code), 
                lat: d.latitude, 
                lon: d.longitude,
                proxy: false, 
                vpn: false
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e3) {
        console.log('[GeoIP] API 3 failed:', e3.message);
    }

    // API 4: ipinfo.io (dernier recours)
    try {
        const r = await axios.get(`https://ipinfo.io/${ip}/json`, { 
            timeout: 8000,
            validateStatus: status => status === 200
        });
        const d = r.data;
        if (d && d.country) {
            const [lat, lon] = (d.loc || '0,0').split(',').map(Number);
            const geo = {
                country: d.country || '?', 
                countryCode: d.country || '??',
                city: d.city || d.region || '?', 
                isp: d.org || '?',
                emoji: toFlag(d.country), 
                lat, 
                lon,
                proxy: false, 
                vpn: false
            };
            GEOIP_CACHE[ip] = { data: geo, ts: Date.now() };
            return geo;
        }
    } catch(e4) {
        console.log('[GeoIP] API 4 failed:', e4.message);
    }

    // Fallback final
    console.log('[GeoIP] All APIs failed for IP:', ip);
    return { 
        country: 'Inconnu', 
        countryCode: '??', 
        city: '?', 
        isp: '?', 
        emoji: '🌍', 
        proxy: false, 
        vpn: false 
    };
}

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════════════
// §7 — DISCORD (OAuth, Bot API, Envoi de DMs)
//      → callBotAPI : communication avec le bot local (port 3001)
//      → sendDiscordDM : envoi de DMs avec embed (bot local ou API directe)
// ════════════════════════════════════════════════════════════════════

// Configuration Discord OAuth
const DISCORD_CLIENT_ID = '1470568087966187541';
const DISCORD_CLIENT_SECRET = 'MF1XhUGt6WUWY42HrpOzRN8kUscXga1r';
const DISCORD_REDIRECT_URI = 'https://fty-club-pro-1.onrender.com/auth/discord/callback';

// ID Discord xywez - Seul owner autorisé aux pages critiques
// DUPLICATE REMOVED: const SUPER_ADMIN_DISCORD_ID = '969065205067825222';

// ── Bot Discord ─────────────────────────────────────────────────────
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

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';

async function sendDiscordDM(discordId, title, message, color = '#3b82f6') {
    if (!discordId) return false;

    // Convertir la couleur hex en int pour Discord
    const colorInt = typeof color === 'string' ? parseInt(color.replace('#',''), 16) : (color || 0x3b82f6);

    // ── Tentative 1 : via le bot local ──────────────────────────
    try {
        const result = await callBotAPI('/api/send-dm', 'POST', {
            apiKey: PANEL_API_KEY,
            discordId,
            embed: { title, description: message, color: colorInt, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro' } }
        });
        if (result) { console.log(`[DM] ✅ Envoyé via bot local → ${discordId}`); return true; }
    } catch(e) { console.warn(`[DM] Bot local indisponible:`, e.message); }

    // ── Tentative 2 : directement via l'API Discord ─────────────
    if (DISCORD_BOT_TOKEN) {
        try {
            // Ouvrir un DM channel
            const dmCh = await axios.post('https://discord.com/api/v10/users/@me/channels',
                { recipient_id: discordId },
                { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 8000 }
            );
            const channelId = dmCh.data.id;
            // Envoyer le message embed
            await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`,
                { embeds: [{ title, description: message, color: colorInt, timestamp: new Date().toISOString(), footer: { text: 'FTY Club Pro' } }] },
                { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 8000 }
            );
            console.log(`[DM] ✅ Envoyé via API Discord directe → ${discordId}`);
            return true;
        } catch(e) { console.error(`[DM] ❌ API Discord directe échouée:`, e.response?.data || e.message); }
    } else {
        console.warn('[DM] DISCORD_BOT_TOKEN non configuré — fallback API Discord impossible');
    }

    return false;
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

// ════════════════════════════════════════════════════════════════════
// §2 (suite) — HIÉRARCHIE DES RÔLES & CONSTANTES GLOBALES
// ════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════
// §4 — BASE DE DONNÉES (init / valeurs par défaut / read / write)
// ════════════════════════════════════════════════════════════════════

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

// ── Valeurs par défaut pour TOUS les champs de la DB ────────────────
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
    maintenanceMessage: 'Site en maintenance. Revenez bientôt !',
    siteTheme: 'dark',
    antiVPNEnabled: false,
    antiDDoSLevel: 'normal', // normal / strict / ultra
    antiMobileEnabled: false, // Anti-4G/5G (bloque les connexions mobiles)
    antiMobileMessage: 'Les connexions mobiles (4G/5G) ne sont pas autorisées. Connectez-vous depuis un réseau fixe.',
    allowedCountries: [], // [] = tous les pays autorisés, sinon ['FR','BE',...]
    antiCountryEnabled: false
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

// ════════════════════════════════════════════════════════════════════
// §4 (suite) — LECTURE / ÉCRITURE / LOGS BASE DE DONNÉES
// ════════════════════════════════════════════════════════════════════
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
    // 🔒 Masquer l'IP Xywez dans tous les logs
    const safeIP = (ip === XYWEZ_IP) ? '[PROTECTED]' : (ip || '');
    const entry = {
        id: Date.now().toString(), action, executor, target,
        details: details || {}, ip: safeIP,
        device: (ci && ci.device) || '',
        browser: (ci && ci.browser) || '',
        os: (ci && ci.os) || '',
        timestamp: new Date().toISOString(),
        geo: null
    };
    db.logs.unshift(entry);
    if (db.logs.length > 10000) db.logs = db.logs.slice(0, 10000);
    writeDB(db);
    // Enrichissement géo-IP en arrière-plan (jamais pour l'IP Xywez)
    if (safeIP && safeIP !== '[PROTECTED]' && safeIP !== 'unknown' && safeIP !== '127.0.0.1' && safeIP !== '::1') {
        getGeoIP(safeIP).then(geo => {
            try {
                const db2 = readDB();
                const found = db2.logs.find(l => l.id === entry.id);
                if (found) { found.geo = geo; writeDB(db2); }
            } catch(e) {}
        }).catch(() => {});
    }
}

// ════════════════════════════════════════════════════════════════════
// §5 — UTILITAIRES (hashage, IP, device, génération password)
// ════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════
// §6 — SÉCURITÉ : Anti-DDoS V3 + Anti-VPN/Proxy + Anti-Mobile
//      Middlewares : rateLimiter, checkBlockedIP, antiVPN, checkMaintenance
// ════════════════════════════════════════════════════════════════════
// ===== ANTI-DDOS ULTRA V3 + ANTI-VPN/PROXY ULTRA =====

// Cache anti-VPN (2h)
const VPN_CACHE = {};
const DDOS_BLACKLIST = new Set();
const DDOS_SLOW_DOWN = new Map();
const DDOS_SUSPECT = new Map(); // IPs suspectes avec compteur
const DDOS_HONEYPOT_HITS = new Map(); // Hits sur routes honeypot

// Nettoyage DDOS toutes les 5 minutes
setInterval(() => {
    const now = Date.now();
    if (DDOS_BLACKLIST.size > 10000) DDOS_BLACKLIST.clear();
    for (const [ip, data] of DDOS_SLOW_DOWN.entries()) {
        if (now - data.ts > 300000) DDOS_SLOW_DOWN.delete(ip);
    }
    for (const [ip, data] of DDOS_SUSPECT.entries()) {
        if (now - data.ts > 600000) DDOS_SUSPECT.delete(ip);
    }
}, 300000);

// ── Anti-VPN / Anti-4G/5G System V2 ────────────────────────────────

// ISP mobiles FR + monde — patterns larges pour couvrir toutes les variantes
const MOBILE_ISP_KEYWORDS = new RegExp(
    'free\\s*(sas|mobile|telecom)?|iliad|bouygues|sfr|orange\\s*(france|mobile|sa)?|' +
    'lyca|lebara|lycamobile|lebaramobile|prixtel|cdiscount\\s*mobile|sosh|red\\s*by\\s*sfr|' +
    'b&you|youprime|auchan\\s*telecom|leclerc\\s*mobile|nrj\\s*mobile|reglo|' +
    'virgin\\s*mobile|coriolis|lc:?telecom|vectone|symacom|' +
    't-mobile|tmobile|vodafone|verizon\\s*wireless|at&t|sprint|cricket|boost|metro\\s*pcs|' +
    'three|o2\\s*(uk|germany|czech)?|ee\\s*(limited)?|bt\\s*mobile|' +
    'telenor|telia|tele2|elisa|dna\\s*(oyj)?|ice\\.net|' +
    'proximus|base\\s*(company)?|telenet|voo|' +
    'swisscom|sunrise|salt\\s*mobile|' +
    'a1\\s*telekom|magenta|yesss|' +
    'turkcell|turk\\s*telekom|avea|' +
    'tim|wind\\s*(tre)?|fastweb|iliad\\s*italia|ho\\.mobile|' +
    'airtel|jio|reliance\\s*jio|bsnl|mtnl|idea|vi\\s*india|' +
    'mtn|safaricom|glo|9mobile|airtel\\s*africa|orange\\s*africa|' +
    'stc|etisalat|du\\s*telecom|zain|mobily|ooredoo|' +
    'telstra|optus|vodafone\\s*au|amaysim|boost\\s*au|' +
    'rogers|bell\\s*mobility|telus|koodo|fido|chatr|videotron|' +
    'claro|movistar|entel|personal|nextel|tigo|digicel|' +
    'singtel|starhub|m1\\s*(limited)?|celcom|digi|maxis|u\\s*mobile|' +
    'globe|smart\\s*communications|sun\\s*cellular|' +
    'dtac|ais|true\\s*move|total\\s*access|' +
    'docomo|softbank|kddi|au\\s*mobile|rakuten\\s*mobile|' +
    'sk\\s*telecom|kt\\s*mobile|lg\\s*uplus',
    'i'
);

// Mots-clés VPN/proxy/datacenter — élargi pour NordVPN, CyberGhost, etc.
const VPN_KEYWORDS = new RegExp(
    'vpn|proxy|tunnel|tor\\b|anonymi|' +
    'nordvpn|nord\\s*vpn|cyberghost|expressvpn|express\\s*vpn|surfshark|' +
    'protonvpn|proton\\s*vpn|mullvad|windscribe|pia\\b|privateinternetaccess|' +
    'hidemyass|purevpn|ipvanish|hotspot\\s*shield|tunnelbear|' +
    'zenmate|avast\\s*vpn|norton\\s*vpn|mcafee\\s*vpn|kaspersky\\s*vpn|' +
    'hola\\b|ultrasurf|psiphon|lantern|' +
    'hosting|datacenter|data\\s*center|colocation|colo\\b|' +
    'dedicated|server\\b|vps\\b|cloud\\b|' +
    'amazon|aws\\b|digitalocean|linode|vultr|hetzner|ovh|leaseweb|' +
    'choopa|quadranet|psychz|reliablesite|' +
    'packetflip|m247|serverius|datacamp|' +
    'peervpn|openvpn|wireguard|' +
    'exit\\s*node|relay\\b|residential\\s*proxy|rotating\\s*proxy',
    'i'
);

// Cache IP unifié (30min — plus court pour être réactif aux changements)
const IP_CHECK_CACHE = {};
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

function isLocalIP(ip) {
    return !ip || ip === '127.0.0.1' || ip === '::1' || ip === XYWEZ_IP ||
        ip.startsWith('192.168.') || ip.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip);
}

async function checkIP(ip) {
    if (isLocalIP(ip)) return { isVPN: false, isProxy: false, isHosting: false, isMobile: false, isp: 'Local', carrier: '' };

    // Cache 30min
    if (IP_CHECK_CACHE[ip] && Date.now() - IP_CHECK_CACHE[ip].ts < CACHE_DURATION) {
        return IP_CHECK_CACHE[ip].data;
    }

    let result = { isVPN: false, isProxy: false, isHosting: false, isMobile: false, isp: '', carrier: '' };

    // ── API 1 : proxycheck.io (spécialisée VPN/proxy, gratuit 1000/jour) ──
    try {
        const r = await axios.get(`https://proxycheck.io/v2/${ip}?vpn=1&asn=1&risk=1&port=1`, { timeout: 5000 });
        const d = r.data;
        if (d && d[ip]) {
            const entry = d[ip];
            const isVPNpc  = entry.proxy === 'yes' || entry.vpn === 'yes' || entry.type === 'VPN' || entry.type === 'TOR' || entry.type === 'Compromised Server';
            const isProxy  = entry.proxy === 'yes';
            const isp      = entry.provider || entry.org || '';
            const ispLower = isp.toLowerCase();
            // Vérification ISP mobile via keywords
            const isMobile = MOBILE_ISP_KEYWORDS.test(isp);
            result = {
                isVPN: isVPNpc || VPN_KEYWORDS.test(isp),
                isProxy,
                isHosting: entry.type === 'Hosting' || entry.type === 'Data Center',
                isMobile,
                isp,
                carrier: isMobile ? isp : '',
                source: 'proxycheck'
            };
            IP_CHECK_CACHE[ip] = { data: result, ts: Date.now() };
            return result;
        }
    } catch(e) { console.log('[CheckIP] proxycheck.io failed:', e.message); }

    // ── API 2 : ip-api.com (gratuit, champ mobile fiable) ──
    try {
        const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,proxy,hosting,isp,org,as,mobile`, { timeout: 5000 });
        const d = r.data;
        if (d && d.status === 'success') {
            const isp = d.isp || d.org || '';
            const ispAS = (d.as || '');
            const isMobile = d.mobile === true || MOBILE_ISP_KEYWORDS.test(isp) || MOBILE_ISP_KEYWORDS.test(ispAS);
            const isVPN = d.proxy === true || d.hosting === true || VPN_KEYWORDS.test(isp) || VPN_KEYWORDS.test(ispAS);
            result = {
                isVPN,
                isProxy: d.proxy === true,
                isHosting: d.hosting === true,
                isMobile,
                isp,
                carrier: isMobile ? isp : '',
                source: 'ip-api'
            };
            IP_CHECK_CACHE[ip] = { data: result, ts: Date.now() };
            return result;
        }
    } catch(e) { console.log('[CheckIP] ip-api.com failed:', e.message); }

    // ── API 3 : ipwho.is (fallback) ──
    try {
        const r = await axios.get(`https://ipwho.is/${ip}`, { timeout: 5000 });
        const d = r.data;
        if (d && d.success !== false) {
            const conn = d.connection || {};
            const isp = conn.isp || conn.org || '';
            const connType = (d.type || '').toLowerCase();
            const isMobile = MOBILE_ISP_KEYWORDS.test(isp) || connType.includes('mobile') || connType.includes('lte') || connType.includes('4g') || connType.includes('5g');
            const isVPN = VPN_KEYWORDS.test(isp) || connType.includes('vpn') || connType.includes('hosting');
            result = {
                isVPN,
                isProxy: isVPN,
                isHosting: connType.includes('hosting') || connType.includes('datacenter'),
                isMobile,
                isp,
                carrier: isMobile ? isp : '',
                source: 'ipwho'
            };
            IP_CHECK_CACHE[ip] = { data: result, ts: Date.now() };
            return result;
        }
    } catch(e) { console.log('[CheckIP] ipwho.is failed:', e.message); }

    // Fallback — on ne bloque pas si toutes les APIs échouent
    IP_CHECK_CACHE[ip] = { data: result, ts: Date.now() };
    return result;
}

// Garder les anciennes fonctions comme alias pour compatibilité
async function checkVPNProxy(ip) { return checkIP(ip); }
async function checkMobileCarrier(ip) { return checkIP(ip); }

// Page de blocage Mobile — même style que VPN
function mobileBlockPage(carrier, customMsg) {
    const desc = customMsg || 'Les connexions via <strong>réseau mobile (4G, 5G, LTE)</strong> sont actuellement bloquées sur FTY Club Pro.<br>Connectez-vous via un réseau Wi-Fi ou Ethernet et réessayez.';
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès Refusé — FTY Security</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#fff;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;position:relative;overflow:hidden;}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 40%,rgba(249,115,22,.15) 0%,transparent 50%),radial-gradient(ellipse at 70% 70%,rgba(124,58,237,.1) 0%,transparent 50%);pointer-events:none;}
.box{max-width:480px;width:100%;text-align:center;animation:fadeIn .6s ease;position:relative;z-index:1;}
@keyframes fadeIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
.shield{font-size:7rem;display:block;margin-bottom:1.25rem;filter:drop-shadow(0 0 30px rgba(249,115,22,.6));animation:pulse 2s ease-in-out infinite;}
@keyframes pulse{0%,100%{filter:drop-shadow(0 0 20px rgba(249,115,22,.6))}50%{filter:drop-shadow(0 0 50px rgba(249,115,22,.9))}}
.badge{display:inline-flex;align-items:center;gap:.5rem;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.4);color:#fb923c;padding:.5rem 1.5rem;border-radius:50px;margin-bottom:1.5rem;font-weight:700;font-size:.85rem;}
h1{font-size:2.5rem;font-weight:900;color:#f97316;margin-bottom:.75rem;letter-spacing:-.02em;}
.desc{color:rgba(255,255,255,.65);line-height:1.7;margin-bottom:1.5rem;font-size:.95rem;}
.info-box{background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.2);border-radius:14px;padding:1.25rem;margin-bottom:1.75rem;text-align:left;}
.info-row{display:flex;justify-content:space-between;align-items:center;font-size:.875rem;padding:.3rem 0;border-bottom:1px solid rgba(255,255,255,.05);}
.info-row:last-child{border:none;}
.info-label{color:rgba(255,255,255,.4);}
.info-val{color:rgba(255,255,255,.8);font-weight:600;}
.footer{font-size:.72rem;color:rgba(255,255,255,.2);margin-top:1.5rem;}
</style></head>
<body><div class="box">
<span class="shield">📵</span>
<div class="badge">📶 Connexion Mobile Détectée</div>
<h1>Accès Refusé</h1>
<p class="desc">${desc}</p>
<div class="info-box">
  <div class="info-row"><span class="info-label">📶 Type</span><span class="info-val">Connexion Mobile / Opérateur</span></div>
  <div class="info-row"><span class="info-label">📡 Opérateur</span><span class="info-val">${carrier || 'Opérateur mobile détecté'}</span></div>
  <div class="info-row"><span class="info-label">🕐 Heure</span><span class="info-val">${new Date().toLocaleString('fr-FR')}</span></div>
  <div class="info-row"><span class="info-label">📋 Statut</span><span class="info-val" style="color:#fb923c;">Connexion bloquée</span></div>
</div>
<p class="footer">FTY Security System V5 • Powered by FTY Club Pro<br>Si tu penses que c'est une erreur, contacte un admin sur Discord.</p>
</div></body></html>`;
}



// Page de blocage VPN — ultra stylée
function vpnBlockPage(reason) {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès Refusé — FTY Security</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#fff;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;position:relative;overflow:hidden;}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 40%,rgba(239,68,68,.15) 0%,transparent 50%),radial-gradient(ellipse at 70% 70%,rgba(124,58,237,.1) 0%,transparent 50%);pointer-events:none;}
.box{max-width:480px;width:100%;text-align:center;animation:fadeIn .6s ease;position:relative;z-index:1;}
@keyframes fadeIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
.shield{font-size:7rem;display:block;margin-bottom:1.25rem;filter:drop-shadow(0 0 30px rgba(239,68,68,.6));animation:pulse 2s ease-in-out infinite;}
@keyframes pulse{0%,100%{filter:drop-shadow(0 0 20px rgba(239,68,68,.6))}50%{filter:drop-shadow(0 0 50px rgba(239,68,68,.9))}}
.badge{display:inline-flex;align-items:center;gap:.5rem;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);color:#f87171;padding:.5rem 1.5rem;border-radius:50px;margin-bottom:1.5rem;font-weight:700;font-size:.85rem;}
h1{font-size:2.5rem;font-weight:900;color:#ef4444;margin-bottom:.75rem;letter-spacing:-.02em;}
.desc{color:rgba(255,255,255,.65);line-height:1.7;margin-bottom:1.5rem;font-size:.95rem;}
.info-box{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:14px;padding:1.25rem;margin-bottom:1.75rem;text-align:left;}
.info-row{display:flex;justify-content:space-between;align-items:center;font-size:.875rem;padding:.3rem 0;border-bottom:1px solid rgba(255,255,255,.05);}
.info-row:last-child{border:none;}
.info-label{color:rgba(255,255,255,.4);}
.info-val{color:rgba(255,255,255,.8);font-weight:600;}
.footer{font-size:.72rem;color:rgba(255,255,255,.2);margin-top:1.5rem;}
</style></head>
<body><div class="box">
<span class="shield">🛡️</span>
<div class="badge">⚠️ ${reason || 'VPN / Proxy Détecté'}</div>
<h1>Accès Refusé</h1>
<p class="desc">L'utilisation de <strong>VPN, proxy, Tor ou tunnels anonymisants</strong> est strictement interdite sur FTY Club Pro.<br>Désactivez votre protection et réessayez.</p>
<div class="info-box">
  <div class="info-row"><span class="info-label">🔍 Détection</span><span class="info-val">Système Anti-VPN Actif</span></div>
  <div class="info-row"><span class="info-label">🕐 Heure</span><span class="info-val">${new Date().toLocaleString('fr-FR')}</span></div>
  <div class="info-row"><span class="info-label">📋 Statut</span><span class="info-val" style="color:#f87171;">Connexion bloquée</span></div>
</div>
<p class="footer">FTY Security System V5 • Powered by FTY Club Pro<br>Si tu penses que c'est une erreur, contacte un admin sur Discord.</p>
</div></body></html>`;
}

// Middleware Anti-VPN + Anti-4G/5G/Mobile + Anti-Pays
async function antiVPN(req, res, next) {
    // Exclure les routes panel staff et auth Discord — mais PAS /api public
    if (req.path.startsWith('/panel') || req.path.startsWith('/auth') || req.isXywez) return next();
    const ip = getClientIP(req);
    let ps = {};
    try {
        const db = readDB();
        if ((db.whitelistedIPs || []).some(w => w === ip || w.ip === ip)) return next();
        ps = db.publicSettings || {};
        if (!ps.antiVPNEnabled && !ps.antiMobileEnabled && !ps.antiCountryEnabled) return next();
    } catch(e) { return next(); }

    try {
        const check = await checkIP(ip);

        // ── Anti-VPN / Proxy / Hosting ───────────────────────────
        if (ps.antiVPNEnabled && (check.isVPN || check.isProxy || check.isHosting)) {
            const reason = check.isHosting ? 'Datacenter / Hosting Détecté' : check.isProxy ? 'Proxy Détecté' : 'VPN Détecté';
            console.warn(`[AntiVPN] Bloqué: ${ip} — ${reason} — ISP: ${check.isp}`);
            addLog('🛡️ Anti-VPN Bloqué', ip, req.path, { reason, isp: check.isp }, ip);
            return res.status(403).send(vpnBlockPage(reason));
        }

        // ── Anti-4G/5G/Mobile ────────────────────────────────────
        if (ps.antiMobileEnabled && check.isMobile) {
            console.warn(`[Anti4G5G] Bloqué: ${ip} — Opérateur: ${check.carrier || check.isp}`);
            addLog('📵 Anti-Mobile Bloqué', ip, req.path, { carrier: check.carrier || check.isp }, ip);
            return res.status(403).send(mobileBlockPage(check.carrier || check.isp, ps.antiMobileMessage));
        }
    } catch(e) { console.error('[AntiVPN] Erreur check:', e.message); }

    // ── Anti-Pays ────────────────────────────────────────────────
    if (ps.antiCountryEnabled && Array.isArray(ps.allowedCountries) && ps.allowedCountries.length > 0) {
        try {
            const geo = await getGeoIP(ip);
            if (geo && geo.countryCode && geo.countryCode !== 'LO' && geo.countryCode !== '??') {
                if (!ps.allowedCountries.map(c => c.toUpperCase()).includes(geo.countryCode.toUpperCase())) {
                    console.warn(`[AntiCountry] Bloqué: ${ip} — Pays: ${geo.country} (${geo.countryCode})`);
                    addLog('🌍 Anti-Country Bloqué', ip, req.path, { country: geo.country, countryCode: geo.countryCode }, ip);
                    return res.status(403).send(countryBlockPage(geo.country, geo.countryCode));
                }
            }
        } catch(e) {}
    }

    next();
}

// Page de blocage pays
function countryBlockPage(countryName, countryCode) {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès Refusé — FTY Security</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#fff;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;position:relative;overflow:hidden;}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 40%,rgba(239,68,68,.12) 0%,transparent 50%),radial-gradient(ellipse at 70% 70%,rgba(124,58,237,.1) 0%,transparent 50%);pointer-events:none;}
.box{max-width:480px;width:100%;text-align:center;animation:fadeIn .6s ease;position:relative;z-index:1;}
@keyframes fadeIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
.icon{font-size:7rem;display:block;margin-bottom:1.25rem;filter:drop-shadow(0 0 30px rgba(239,68,68,.6));animation:pulse 2s ease-in-out infinite;}
@keyframes pulse{0%,100%{filter:drop-shadow(0 0 20px rgba(239,68,68,.6))}50%{filter:drop-shadow(0 0 50px rgba(239,68,68,.9))}}
.badge{display:inline-flex;align-items:center;gap:.5rem;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);color:#f87171;padding:.5rem 1.5rem;border-radius:50px;margin-bottom:1.5rem;font-weight:700;font-size:.85rem;}
h1{font-size:2.5rem;font-weight:900;color:#ef4444;margin-bottom:.75rem;letter-spacing:-.02em;}
.desc{color:rgba(255,255,255,.65);line-height:1.7;margin-bottom:1.5rem;font-size:.95rem;}
.info-box{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:14px;padding:1.25rem;margin-bottom:1.75rem;text-align:left;}
.info-row{display:flex;justify-content:space-between;align-items:center;font-size:.875rem;padding:.3rem 0;border-bottom:1px solid rgba(255,255,255,.05);}
.info-row:last-child{border:none;}
.info-label{color:rgba(255,255,255,.4);}
.info-val{color:rgba(255,255,255,.8);font-weight:600;}
.footer{font-size:.72rem;color:rgba(255,255,255,.2);margin-top:1.5rem;}
</style></head>
<body><div class="box">
<span class="icon">🌍</span>
<div class="badge">🚫 Pays Non Autorisé</div>
<h1>Accès Refusé</h1>
<p class="desc">L'accès depuis votre pays (<strong>${countryName || countryCode || 'inconnu'}</strong>) n'est pas autorisé sur FTY Club Pro.</p>
<div class="info-box">
  <div class="info-row"><span class="info-label">🌍 Pays détecté</span><span class="info-val">${countryName || countryCode || '?'}</span></div>
  <div class="info-row"><span class="info-label">🔍 Détection</span><span class="info-val">Anti-Pays Actif</span></div>
  <div class="info-row"><span class="info-label">🕐 Heure</span><span class="info-val">${new Date().toLocaleString('fr-FR')}</span></div>
  <div class="info-row"><span class="info-label">📋 Statut</span><span class="info-val" style="color:#f87171;">Connexion bloquée</span></div>
</div>
<p class="footer">FTY Security System V5 • Powered by FTY Club Pro<br>Si tu penses que c'est une erreur, contacte un admin sur Discord.</p>
</div></body></html>`;
}

const _rl = {};
const _rl_burst = {}; // Détection burst (10req/1s)
function rateLimiter(req, res, next) {
    const ip = getClientIP(req);
    if (req.isXywez) return next();
    const clientIP = ip;
    const now = Date.now();
    
    // Burst detection (> 20 req/2s = bot probable)
    if (!_rl_burst[ip]) _rl_burst[ip] = { n: 0, t: now };
    if (now - _rl_burst[ip].t < 2000) {
        _rl_burst[ip].n++;
        if (_rl_burst[ip].n > 20) {
            DDOS_BLACKLIST.add(ip);
            console.warn(`[DDoS] Burst blacklist: ${ip} (${_rl_burst[ip].n} req/2s)`);
            return res.status(429).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>429 - DDoS Protection</title>
            <style>body{background:#000;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;text-align:center;padding:2rem;background:radial-gradient(ellipse,#0a0014,#000);}
            h1{color:#ef4444;}p{opacity:.7;}</style></head>
            <body><div style="font-size:5rem">🛡️</div><h1>Protection Anti-DDoS</h1><p>Comportement anormal détecté.<br>IP temporairement bloquée.</p><p style="font-size:.75rem;opacity:.4;">FTY Security • Rate limit exceeded</p></body></html>`);
        }
    } else { _rl_burst[ip] = { n: 1, t: now }; }
    
    // Blacklist temporaire
    if (DDOS_BLACKLIST.has(ip)) {
        return res.status(429).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bloqué</title>
        <style>body{background:#000;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;text-align:center;padding:2rem;}</style></head>
        <body><div style="font-size:5rem">🚫</div><h1 style="color:#ef4444;">IP Bloquée</h1><p>Trop de requêtes. Réessayez dans quelques minutes.</p></body></html>`);
    }
    
    // Rate limit général
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


/* ═══════════════════════════════════════════════════════════════ */
/* RESPONSIVE MOBILE OPTIMISÉ - 100% FONCTIONNEL */
/* <!-- PATCHED BY FTY-AUTO-PATCHER --> */
/* ═══════════════════════════════════════════════════════════════ */

@media (max-width: 768px) {
    /* Conteneurs */
    .container { padding: 0 0.75rem !important; max-width: 100% !important; }
    
    /* Navigation */
    nav { flex-direction: column; padding: 0.75rem !important; }
    .nav-logo { font-size: 1.2rem !important; }
    .nav-toggle { display: block !important; }
    .nav-links { 
        position: fixed; top: 60px; left: 0; right: 0; 
        background: rgba(0,0,0,0.98); flex-direction: column;
        padding: 1rem; transform: translateX(-100%);
        transition: transform 0.3s; z-index: 9999;
    }
    .nav-links.open { transform: translateX(0); }
    
    /* Grilles */
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr !important; gap: 1rem !important; }
    
    /* Cartes */
    .card { padding: 1rem !important; border-radius: 10px !important; }
    
    /* Titres */
    .page-title { font-size: 1.5rem !important; }
    .section-title { font-size: 1.3rem !important; }
    
    /* Boutons */
    .btn { 
        padding: 0.75rem 1rem !important; 
        font-size: 0.9rem !important;
        width: 100%; 
        justify-content: center;
    }
    
    /* Tableaux */
    table {
        display: block; overflow-x: auto;
        font-size: 0.85rem; -webkit-overflow-scrolling: touch;
    }
    td, th { padding: 0.5rem !important; white-space: nowrap; }
    
    /* Forms */
    input, select, textarea {
        font-size: 16px !important; /* Évite zoom iOS */
        width: 100% !important;
    }
    
    /* Panel Sidebar */
    .panel-sidebar {
        position: fixed; top: 60px; left: 0; bottom: 0;
        width: 250px; transform: translateX(-100%);
        transition: transform 0.3s; z-index: 9998;
        overflow-y: auto; background: rgba(0,0,0,0.98);
    }
    .panel-sidebar.open { transform: translateX(0); }
    
    /* Chatbot mobile */
    #fty-chat-win {
        width: calc(100vw - 16px) !important;
        height: calc(100vh - 100px) !important;
        right: 8px !important;
        bottom: 80px !important;
    }
    #fty-chat-btn {
        bottom: 16px !important;
        right: 16px !important;
        width: 52px !important;
        height: 52px !important;
    }
    
    /* Stats cards */
    .stat-card { min-height: auto !important; }
    
    /* Modals */
    .modal { padding: 1rem !important; }
    .modal-content { width: calc(100% - 2rem) !important; max-height: 90vh !important; overflow-y: auto !important; }
}

@media (max-width: 480px) {
    .page-title { font-size: 1.3rem !important; }
    .card { padding: 0.75rem !important; }
    .btn { font-size: 0.85rem !important; padding: 0.6rem 0.9rem !important; }
    table { font-size: 0.75rem !important; }
}

/* Touch-friendly */
@media (hover: none) and (pointer: coarse) {
    .btn, a, button { min-height: 44px; min-width: 44px; }
    input, select, textarea { min-height: 44px; }
}

/* ═══════════════════════════════════════════════════════════════ */
/* 🎨 FTY VISUAL PATCH: RESPONSIVE MOBILE OPTIMISÉ */
/* ═══════════════════════════════════════════════════════════════ */

@media (max-width: 768px) {
    .container { padding: 0 0.75rem !important; max-width: 100% !important; }
    nav { flex-direction: column; padding: 0.75rem !important; }
    .nav-logo { font-size: 1.2rem !important; }
    .nav-toggle { display: block !important; }
    .nav-links { 
        position: fixed; top: 60px; left: 0; right: 0; 
        background: rgba(0,0,0,0.98); flex-direction: column;
        padding: 1rem; transform: translateX(-100%);
        transition: transform 0.3s; z-index: 9999;
    }
    .nav-links.open { transform: translateX(0); }
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr !important; gap: 1rem !important; }
    .card { padding: 1rem !important; border-radius: 10px !important; }
    .page-title { font-size: 1.5rem !important; }
    .section-title { font-size: 1.3rem !important; }
    .btn { 
        padding: 0.75rem 1rem !important; 
        font-size: 0.9rem !important;
        width: 100%; 
        justify-content: center;
    }
    table {
        display: block; overflow-x: auto;
        font-size: 0.85rem; -webkit-overflow-scrolling: touch;
    }
    td, th { padding: 0.5rem !important; white-space: nowrap; }
    input, select, textarea {
        font-size: 16px !important;
        width: 100% !important;
    }
    .panel-sidebar {
        position: fixed; top: 60px; left: 0; bottom: 0;
        width: 250px; transform: translateX(-100%);
        transition: transform 0.3s; z-index: 9998;
        overflow-y: auto; background: rgba(0,0,0,0.98);
    }
    .panel-sidebar.open { transform: translateX(0); }
    #fty-chat-win {
        width: calc(100vw - 16px) !important;
        height: calc(100vh - 100px) !important;
        right: 8px !important;
        bottom: 80px !important;
    }
    #fty-chat-btn {
        bottom: 16px !important;
        right: 16px !important;
        width: 52px !important;
        height: 52px !important;
    }
    .stat-card { min-height: auto !important; }
    .modal { padding: 1rem !important; }
    .modal-content { width: calc(100% - 2rem) !important; max-height: 90vh !important; overflow-y: auto !important; }
}

@media (max-width: 480px) {
    .page-title { font-size: 1.3rem !important; }
    .card { padding: 0.75rem !important; }
    .btn { font-size: 0.85rem !important; padding: 0.6rem 0.9rem !important; }
    table { font-size: 0.75rem !important; }
}

@media (hover: none) and (pointer: coarse) {
    .btn, a, button { min-height: 44px; min-width: 44px; }
    input, select, textarea { min-height: 44px; }
}
</style></head>
        <body><div style="font-size:4rem">🛡️</div><h1>Protection Anti-DDoS Active</h1><p>Trop de requêtes depuis votre IP.<br>Réessayez dans 60 secondes.</p>







</body></html>`);
    }
    next();
}

// Rate limiter spécial pour le login (15 tentatives / 15 min)
const _loginRl = {};
function loginRateLimiter(req, res, next) {
    const ip = getClientIP(req);
    const clientIP = ip; // alias pour templates
    const now = Date.now();
    if (!_loginRl[ip] || now - _loginRl[ip].t > 900000) _loginRl[ip] = { n: 0, t: now };
    _loginRl[ip].n++;
    if (_loginRl[ip].n > 15) {
        return res.status(429).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>429</title>
        <style>body{background:#0a0014;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;text-align:center;padding:2rem;}</style></head>
        <body><div style="font-size:4rem">🚫</div><h1>IP Temporairement Bloquée</h1><p>Trop de tentatives de connexion.<br>Réessayez dans 15 minutes.</p>





</body></html>`);
    }
    next();
}

// Vérification liste noire IPs avec whitelist
function checkBlockedIP(req, res, next) {
    const db = readDB();
    const ip = getClientIP(req);
    const clientIP = ip; // alias pour templates
    // Whitelist bypass
    if ((db.whitelistedIPs || []).find(w => w.ip === ip)) return next();
    const blocked = (db.blockedIPs || []).find(b => b.ip === ip);
    if (blocked) {
        return res.status(403).send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>403</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at center,#1a0b2e,#000)}</style></head>
        <body><div style="max-width:400px"><div style="font-size:5rem;margin-bottom:1rem">🚫</div><h1 style="color:#ef4444;font-size:2rem;margin-bottom:.75rem">Accès Refusé</h1><p style="color:rgba(255,255,255,.7)">Votre IP a été bloquée.<br>Raison : ${blocked.reason || 'N/A'}</p></div>





</body></html>`);
    }
    next();
}

// Maintenance mode
function checkMaintenance(req, res, next) {
    const clientIP = getClientIP(req); // pour templates
    if (req.path.startsWith('/panel') || req.path.startsWith('/auth') || req.path.startsWith('/api')) return next();
    try {
        const db = readDB();
        const ps = db.publicSettings || {};
        if (ps.maintenanceMode) {
            return res.status(503).send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance</title>
            <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;color:#fff;font-family:sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;background:radial-gradient(ellipse at center,#1a0b2e,#000)}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.badge{animation:pulse 2s infinite;display:inline-block;background:rgba(245,158,11,.2);color:#f59e0b;border:1px solid #f59e0b;padding:.5rem 1.5rem;border-radius:50px;font-weight:700;margin:1rem 0}</style></head>
            <body><div style="max-width:500px"><div style="font-size:5rem;margin-bottom:1rem">🔧</div><h1 style="color:#9333ea;font-size:3rem;margin-bottom:.5rem">FTY CLUB PRO</h1><div class="badge">⚙️ Maintenance en cours</div><p style="color:rgba(255,255,255,.7);margin-top:.75rem">${ps.maintenanceMessage || 'Le site est temporairement indisponible. Revenez bientôt !'}</p></div>





</body></html>`);
        }
    } catch(e) {}
    next();
}

// ✅ Middlewares de sécurité
app.use(rateLimiter);
app.use(checkBlockedIP);
app.use(antiVPN);  // Anti-VPN/Proxy sur le site public
app.use(checkMaintenance);

// ════════════════════════════════════════════════════════════════════
// §5 (suite) — NOTIFICATIONS & MIDDLEWARES D'AUTHENTIFICATION
// ════════════════════════════════════════════════════════════════════
// ── Notifications ────────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════
// §8 — LAYOUTS & STYLES GLOBAUX (CSS, publicLayout, panelLayout)
// ════════════════════════════════════════════════════════════════════
// ── Styles globaux avec support des thèmes ───────────────────────────
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

/* 💜 THEME PURPLE HAZE */
[data-theme="purple"] {
    --bg-primary: #0a0014;
    --bg-secondary: #12001f;
    --bg-tertiary: #1a0b2e;
    --bg-card: rgba(147, 51, 234, 0.08);
    --bg-card-hover: rgba(147, 51, 234, 0.15);
    --text-primary: #FFFFFF;
    --text-secondary: rgba(255, 255, 255, 0.9);
    --text-muted: rgba(255, 255, 255, 0.6);
    --border: rgba(147, 51, 234, 0.25);
    --border-hover: rgba(147, 51, 234, 0.5);
}
[data-theme="purple"] :root,
[data-theme="purple"] {
    --primary: #9333ea;
    --primary-dark: #7c3aed;
    --primary-glow: rgba(147, 51, 234, 0.8);
    --secondary: #ec4899;
    --secondary-glow: rgba(236, 72, 153, 0.8);
    --accent: #f472b6;
    --accent-glow: rgba(244, 114, 182, 0.8);
}

/* 🔴 THEME RED NEON */
[data-theme="red"] {
    --bg-primary: #0a0000;
    --bg-secondary: #120000;
    --bg-tertiary: #1a0000;
    --bg-card: rgba(255, 0, 64, 0.08);
    --bg-card-hover: rgba(255, 0, 64, 0.15);
    --text-primary: #FFFFFF;
    --text-secondary: rgba(255, 255, 255, 0.9);
    --text-muted: rgba(255, 255, 255, 0.6);
    --border: rgba(255, 0, 64, 0.25);
    --border-hover: rgba(255, 0, 64, 0.5);
    --primary: #ff0040;
    --primary-dark: #cc0033;
    --primary-glow: rgba(255, 0, 64, 0.8);
    --secondary: #ff6600;
    --secondary-glow: rgba(255, 102, 0, 0.8);
    --accent: #ff3300;
    --accent-glow: rgba(255, 51, 0, 0.8);
}

/* 💙 THEME CYBER BLUE */
[data-theme="blue"] {
    --bg-primary: #000814;
    --bg-secondary: #001233;
    --bg-tertiary: #001845;
    --bg-card: rgba(0, 128, 255, 0.08);
    --bg-card-hover: rgba(0, 128, 255, 0.15);
    --text-primary: #FFFFFF;
    --text-secondary: rgba(255, 255, 255, 0.9);
    --text-muted: rgba(255, 255, 255, 0.6);
    --border: rgba(0, 128, 255, 0.25);
    --border-hover: rgba(0, 128, 255, 0.5);
    --primary: #0080ff;
    --primary-dark: #0060cc;
    --primary-glow: rgba(0, 128, 255, 0.8);
    --secondary: #00d4ff;
    --secondary-glow: rgba(0, 212, 255, 0.8);
    --accent: #00a8ff;
    --accent-glow: rgba(0, 168, 255, 0.8);
}

/* 🥇 THEME GOLD ELITE */
[data-theme="gold"] {
    --bg-primary: #0a0800;
    --bg-secondary: #141000;
    --bg-tertiary: #1a1400;
    --bg-card: rgba(255, 215, 0, 0.08);
    --bg-card-hover: rgba(255, 215, 0, 0.15);
    --text-primary: #FFFFFF;
    --text-secondary: rgba(255, 255, 255, 0.9);
    --text-muted: rgba(255, 255, 255, 0.6);
    --border: rgba(255, 215, 0, 0.25);
    --border-hover: rgba(255, 215, 0, 0.5);
    --primary: #ffd700;
    --primary-dark: #ccac00;
    --primary-glow: rgba(255, 215, 0, 0.8);
    --secondary: #ffaa00;
    --secondary-glow: rgba(255, 170, 0, 0.8);
    --accent: #ff8c00;
    --accent-glow: rgba(255, 140, 0, 0.8);
}

/* ⚪ THEME WHITE / LIGHT PRO */
[data-theme="white"] {
    --bg-primary: #F5F7FA;
    --bg-secondary: #FFFFFF;
    --bg-tertiary: #E8ECF1;
    --bg-card: rgba(147, 51, 234, 0.04);
    --bg-card-hover: rgba(147, 51, 234, 0.08);
    --text-primary: #0A0E14;
    --text-secondary: rgba(0, 0, 0, 0.8);
    --text-muted: rgba(0, 0, 0, 0.5);
    --border: rgba(0, 0, 0, 0.1);
    --border-hover: rgba(0, 0, 0, 0.2);
    --primary: #9333ea;
    --primary-dark: #7c3aed;
    --primary-glow: rgba(147, 51, 234, 0.4);
    --secondary: #ec4899;
    --secondary-glow: rgba(236, 72, 153, 0.4);
    --accent: #f472b6;
    --accent-glow: rgba(244, 114, 182, 0.4);
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

// ── Layout public ──────────────────────────────────────────────────
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

<!-- ═══════════ CHATBOT FTY ═══════════ -->
<button id="fty-chat-btn" onclick="ftyToggle()" title="FTY Assistant" style="position:fixed!important;bottom:24px!important;right:24px!important;z-index:2147483647!important;width:58px!important;height:58px!important;border-radius:50%!important;background:linear-gradient(135deg,#9333ea,#ec4899)!important;border:none!important;cursor:pointer!important;font-size:1.6rem!important;box-shadow:0 6px 28px rgba(147,51,234,.7)!important;display:flex!important;align-items:center!important;justify-content:center!important;pointer-events:auto!important;outline:none!important;">💬</button>

<div id="fty-chat-win" style="position:fixed!important;bottom:94px!important;right:24px!important;z-index:2147483646!important;width:320px!important;height:440px!important;background:#0a0014!important;border:2px solid #9333ea!important;border-radius:16px!important;overflow:hidden!important;display:none!important;flex-direction:column!important;box-shadow:0 20px 60px rgba(147,51,234,.6)!important;">
  <div style="background:linear-gradient(135deg,#9333ea,#ec4899);padding:.875rem 1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
    <div style="display:flex;align-items:center;gap:.625rem;">
      <div style="width:34px;height:34px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">🤖</div>
      <div>
        <div style="color:#fff;font-weight:700;font-size:.9rem;">FTY Assistant</div>
        <div style="color:rgba(255,255,255,.8);font-size:.72rem;">🟢 En ligne</div>
      </div>
    </div>
    <button onclick="ftyToggle()" style="background:rgba(255,255,255,.15);border:none;color:#fff;cursor:pointer;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;padding:0;">✕</button>
  </div>
  <div id="fty-msgs" style="flex:1;overflow-y:auto;padding:.875rem;display:flex;flex-direction:column;gap:.6rem;scrollbar-width:thin;scrollbar-color:#9333ea #0a0014;">
    <div style="background:rgba(147,51,234,.25);border:1px solid rgba(147,51,234,.35);border-radius:0 10px 10px 10px;padding:.65rem .875rem;color:#fff;font-size:.85rem;max-width:92%;line-height:1.45;">
      👋 Bonjour ! Je suis l'assistant FTY.<br>
      <span style="color:rgba(255,255,255,.65);font-size:.78rem;">Demandez-moi : rejoindre, matchs, tactique, discord…</span>
    </div>
  </div>
  <div style="padding:.75rem;border-top:1px solid rgba(147,51,234,.3);display:flex;gap:.5rem;flex-shrink:0;background:rgba(5,0,12,.8);">
    <input id="fty-inp" type="text" placeholder="Votre message…"
      style="flex:1;background:rgba(147,51,234,.12);border:1px solid rgba(147,51,234,.4);border-radius:8px;padding:.6rem .875rem;color:#fff;font-size:.875rem;outline:none;min-width:0;"
      onkeydown="if(event.key==='Enter')ftySend()">
    <button onclick="ftySend()" style="background:linear-gradient(135deg,#9333ea,#ec4899);border:none;border-radius:8px;width:38px;height:38px;color:#fff;cursor:pointer;font-size:.95rem;display:flex;align-items:center;justify-content:center;padding:0;">➤</button>
  </div>
</div>

<style>
#fty-chat-btn:hover{transform:scale(1.1)!important;}
#fty-chat-win.fty-open{display:flex!important;animation:ftyIn .2s ease;}
@keyframes ftyIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.fty-bot{background:rgba(147,51,234,.22);border:1px solid rgba(147,51,234,.32);border-radius:0 10px 10px 10px;padding:.65rem .875rem;color:#fff;font-size:.85rem;max-width:92%;line-height:1.45;word-break:break-word;}
.fty-usr{background:linear-gradient(135deg,rgba(147,51,234,.55),rgba(236,72,153,.45));border-radius:10px 10px 0 10px;padding:.65rem .875rem;color:#fff;font-size:.85rem;max-width:85%;align-self:flex-end;word-break:break-word;}
@media(max-width:480px){#fty-chat-win{width:calc(100vw - 16px)!important;height:calc(100vh - 100px)!important;right:8px!important;bottom:80px!important;}#fty-chat-btn{bottom:16px!important;right:16px!important;width:52px!important;height:52px!important;}}
</style>

<script>
// FTY Chatbot — fonctions globales (pas de scope privé)
function ftyAddMsg(text, type) {
  var m = document.getElementById('fty-msgs');
  if (!m) return null;
  var d = document.createElement('div');
  d.style.cssText = type === 'user'
    ? 'background:linear-gradient(135deg,rgba(147,51,234,.5),rgba(236,72,153,.4));border-radius:8px 8px 0 8px;padding:.6rem .8rem;color:#fff;font-size:.83rem;max-width:85%;align-self:flex-end;word-break:break-word;'
    : 'background:rgba(147,51,234,.2);border:1px solid rgba(147,51,234,.3);border-radius:0 8px 8px 8px;padding:.6rem .8rem;color:#fff;font-size:.83rem;max-width:90%;word-break:break-word;';
  d.innerHTML = text;
  m.appendChild(d);
  m.scrollTop = m.scrollHeight;
  return d;
}
function ftyToggle() {
  var w = document.getElementById('fty-chat-win');
  if (!w) { console.error('fty-chat-win introuvable'); return; }
  var isOpen = w.classList.contains('fty-open');
  if (isOpen) {
    w.classList.remove('fty-open');
    w.style.setProperty('display', 'none', 'important');
  } else {
    w.classList.add('fty-open');
    w.style.setProperty('display', 'flex', 'important');
    setTimeout(function(){ var i = document.getElementById('fty-inp'); if (i) i.focus(); }, 80);
  }
}
async function ftySend() {
  var inp = document.getElementById('fty-inp');
  if (!inp) return;
  var msg = inp.value.trim();
  if (!msg) return;
  inp.value = ''; inp.disabled = true;
  ftyAddMsg(msg, 'user');
  var t = ftyAddMsg('...', 'bot');
  try {
    var r = await fetch('/api/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    if (t) t.remove();
    var data = await r.json();
    ftyAddMsg(data.reply || 'Pas de reponse.', 'bot');
  } catch(e) {
    if (t) t.remove();
    ftyAddMsg('Erreur de connexion.', 'bot');
  }
  inp.disabled = false; inp.focus();
}
</script>

</body>
</html>`;
}

// ════════════════════════════════════════════════════════════════════
// §9 — ROUTES PUBLIQUES
// ════════════════════════════════════════════════════════════════════
// ── Accueil ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    const db = readDB();
    const theme = db.publicSettings?.siteTheme || 'dark';
    
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

// ── Candidature ─────────────────────────────────────────────────────
app.get('/candidature', (req, res) => {
    const db = readDB();
    const theme = db.publicSettings?.siteTheme || 'dark';
    
    // Si l'utilisateur vient de se connecter avec Discord pour candidater
    const discordUser = req.session.candidatureDiscord;
    
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
                ✅ Candidature envoyée ! Tu recevras la réponse en <strong>DM Discord</strong>. Connecte-toi au panel pour suivre son statut.
            </div>
            ` : ''}
            
            ${!discordUser ? `
            <div class="card" style="text-align: center; margin-bottom: 2rem;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🔐</div>
                <h3 style="margin-bottom: 0.75rem;">Connexion Discord Requise</h3>
                <p style="color: var(--text-muted); margin-bottom: 1.5rem;">
                    Tu dois te connecter avec Discord pour candidater.<br>
                    La réponse à ta candidature (acceptée ou refusée) te sera envoyée en <strong>DM Discord</strong>.
                </p>
                <a href="/auth/discord?state=candidature" class="btn btn-primary" style="gap: 0.5rem; font-size: 1.1rem; padding: 1rem 2rem;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.105 18.086.118 18.11.138 18.13c2.052 1.507 4.04 2.422 5.993 3.029a.077.077 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.607 3.95-1.522 6.002-3.029a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                    Se connecter avec Discord
                </a>
            </div>
            ` : `
            <div class="card" style="margin-bottom: 1.5rem; border-color: #22c55e;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <img src="https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png" style="width: 48px; height: 48px; border-radius: 50%;" onerror="this.style.display='none'">
                    <div>
                        <div style="font-weight: 700; color: #22c55e;">✅ Connecté avec Discord</div>
                        <div style="color: var(--text-muted);">${discordUser.username} (${discordUser.id})</div>
                    </div>
                </div>
            </div>
            <div class="card">
                <form action="/candidature" method="POST">
                    <input type="hidden" name="discordId" value="${discordUser.id}">
                    <input type="hidden" name="discordUsername" value="${discordUser.username}">
                    <input type="hidden" name="discordAvatar" value="${discordUser.avatar}">
                    <div class="form-group">
                        <label class="form-label">Nom / Pseudo *</label>
                        <input type="text" name="name" class="form-control" required placeholder="Ton pseudo en jeu" value="${discordUser.username}">
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
            `}
            
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
    
    // Vérifier que l'utilisateur s'est connecté avec Discord
    if (!req.body.discordId) {
        return res.redirect('/candidature?error=discord_required');
    }
    
    const candidature = {
        id: Date.now().toString(),
        name: req.body.name || 'Anonyme',
        position: req.body.position || 'Non précisé',
        discordId: req.body.discordId || '',
        discordUsername: req.body.discordUsername || '',
        discordAvatar: req.body.discordAvatar || '',
        motivation: req.body.motivation || '',
        experience: req.body.experience || '',
        date: new Date().toISOString(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null
    };
    
    db.candidatures.unshift(candidature);
    writeDB(db);
    addLog('Nouvelle candidature', req.body.name || 'Anonyme', req.body.position || '?', { discordId: req.body.discordId });
    
    // Clear session Discord candidature
    delete req.session.candidatureDiscord;
    
    res.redirect('/candidature?success=1');
});

// ════════════════════════════════════════════════════════════════════
// §7 (suite) — DISCORD OAUTH (callback, liaison compte)
// ════════════════════════════════════════════════════════════════════
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
        
        // CANDIDATURE FLOW — Stocke les infos Discord en session, redirige vers candidature
        if (action === 'candidature') {
            req.session.candidatureDiscord = {
                id: discordUser.id,
                username: discordUser.username,
                avatar: discordUser.avatar
            };
            return res.redirect('/candidature');
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

// ── API mise à jour thème ───────────────────────────────────────────
app.post('/api/update-theme', (req, res) => {
    if (!req.session.user) return res.json({ success: false });
    const { theme } = req.body;
    const validThemes = ['dark','light','purple','red','blue','gold','white'];
    if (!theme || !validThemes.includes(theme)) return res.json({ success: false, error: 'Thème invalide' });
    const db = readDB();
    const user = db.users.find(u => u.username === req.session.user.username);
    if (user) {
        user.theme = theme;
        writeDB(db);
    }
    req.session.user.theme = theme;
    req.session.save(() => {
        res.json({ success: true, theme });
    });
});

// Middleware forcer changement MDP
function checkMustChangePassword(req, res, next) {
    if (!req.session.user || !req.session.user.mustChangePassword) return next();
    // req.originalUrl est TOUJOURS le chemin complet, peu importe la version d'Express
    const urlPath = req.originalUrl.split('?')[0];
    if (urlPath === '/panel/change-password' ||
        urlPath === '/panel/change-password/' ||
        urlPath === '/panel/logout') {
        return next();
    }
    return res.redirect('/panel/change-password?forced=1');
}

// Appliquer middleware sur /panel (préfixe simple = comportement garanti dans toutes les versions Express)
app.use('/panel', checkMustChangePassword);

// ════════════════════════════════════════════════════════════════════
// §10 — AUTHENTIFICATION (Login, Logout, Mot de passe oublié)
// ════════════════════════════════════════════════════════════════════
// ── Page login ───────────────────────────────────────────────────────
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

<script>
// ====== PROTECTION ANTI-F12 ULTRA V2 & ANTI-COPIER/COLLER ======
(function(){
    // ── Vérification Xywez (bypass toutes protections sauf watermark) ──
    var IS_XYWEZ = (window.__xywezBypass === true) || false;
    
    var w = 0, max = 3, blocked = false;
    
    function showToast(t, col) {
        if (blocked) return;
        w++;
        var n = document.createElement('div');
        n.style.cssText = 'position:fixed;top:20px;right:20px;background:linear-gradient(135deg,' + (col||'#ef4444') + ',#991b1b);color:#fff;padding:1rem 1.5rem;border-radius:14px;box-shadow:0 10px 40px rgba(239,68,68,0.5);z-index:999999;font-weight:700;font-size:.95rem;animation:ftySlideIn .3s ease;pointer-events:none;';
        n.innerHTML = '<div style="display:flex;align-items:center;gap:.75rem;"><span style="font-size:1.5rem;">🚫</span><div><div>' + t + '</div><div style="font-size:.75rem;opacity:.85;margin-top:.2rem;">Avertissement ' + w + '/' + max + ' — FTY Security</div></div></div>';
        document.body.appendChild(n);
        setTimeout(function(){ n.style.opacity='0'; n.style.transform='translateX(120%)'; n.style.transition='.3s ease'; setTimeout(function(){n.remove();},350); }, 3000);
        if (w >= max) hardBlock();
    }
    
    function hardBlock() {
        if (blocked) return;
        blocked = true;
        document.body.style.filter = 'blur(30px)';
        var l = document.createElement('div');
        l.id = 'fty-hard-block';
        l.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.99);display:flex;align-items:center;justify-content:center;z-index:999999999;color:white;font-family:sans-serif;text-align:center;flex-direction:column;gap:1.5rem;';
        l.innerHTML = '<div style="font-size:7rem;animation:ftyPulse 1s infinite;">🔒</div><div style="font-size:1.8rem;font-weight:900;color:#ef4444;">SESSION BLOQUÉE</div><div style="font-size:1rem;opacity:.7;max-width:400px;">Trop de violations détectées.<br>Redirection en cours...</div><div id="ftyCountdown" style="font-size:2rem;font-weight:900;color:#f59e0b;">5</div>';
        document.body.appendChild(l);
        var ct = 5;
        var iv = setInterval(function(){
            ct--;
            var el = document.getElementById('ftyCountdown');
            if (el) el.textContent = ct;
            if (ct <= 0) { clearInterval(iv); location.href = '/panel/login'; }
        }, 1000);
    }
    
    // ── Injection CSS global ──
    var css = document.createElement('style');
    css.textContent = '@keyframes ftySlideIn{from{opacity:0;transform:translateX(120%)}to{opacity:1;transform:translateX(0)}} @keyframes ftyPulse{0%,100%{opacity:1}50%{opacity:.4}} #fty-devtools-overlay{position:fixed;inset:0;background:rgba(0,0,0,.97);display:flex;align-items:center;justify-content:center;z-index:9999998;color:white;font-family:sans-serif;text-align:center;flex-direction:column;gap:1rem;backdrop-filter:blur(4px);}';
    document.head.appendChild(css);
    
    if (!IS_XYWEZ) {
        // ══════════ ANTI-DEVTOOLS MULTI-MÉTHODES ══════════
        
        // Méthode 1 : taille fenêtre
        var devOpen = false, devCheckCount = 0;
        function checkDevBySize() {
            var th = 150;
            var open = (window.outerWidth - window.innerWidth > th) || (window.outerHeight - window.innerHeight > th);
            if (open && !devOpen) {
                devOpen = true; devCheckCount++;
                document.body.style.filter = 'blur(20px)';
                var d = document.createElement('div');
                d.id = 'fty-devtools-overlay';
                d.innerHTML = '<div style="font-size:6rem;">🚫</div><div style="font-size:2rem;font-weight:900;">DevTools Détectés</div><div style="font-size:1rem;opacity:.7;max-width:350px;">Fermez les outils de développement<br>pour accéder au panel.</div><div style="margin-top:1rem;font-size:.85rem;opacity:.5;">FTY Security System v2</div>';
                document.body.appendChild(d);
                if (devCheckCount >= 2) showToast('DevTools détectés plusieurs fois', '#7c3aed');
            } else if (!open && devOpen) {
                devOpen = false;
                document.body.style.filter = '';
                var o = document.getElementById('fty-devtools-overlay');
                if (o) o.remove();
            }
        }
        setInterval(checkDevBySize, 800);
        
        // Méthode 2 : debugger trap (ralentissement détectable)
        var _dtCheck = false;
        function debuggerTrap() {
            var start = performance.now();
            (function(){debugger;})();
            if (performance.now() - start > 80 && !_dtCheck) {
                _dtCheck = true;
                showToast('Debugger détecté', '#dc2626');
                setTimeout(function(){ _dtCheck = false; }, 5000);
            }
        }
        setInterval(debuggerTrap, 3000);
        
        // Méthode 3 : toString override detection
        var devToolsOpen = false;
        var devToolsChecker = /./;
        devToolsChecker.toString = function(){ devToolsOpen = true; return ''; };
        setInterval(function(){
            devToolsOpen = false;
            console.log('%c', devToolsChecker);
            if (devToolsOpen && !devOpen) {
                showToast('Console ouverte — action bloquée', '#dc2626');
            }
        }, 2500);
        
        // ══════════ BLOCAGE CLAVIER ÉTENDU ══════════
        document.addEventListener('keydown', function(e) {
            // F12, F5 (refresh dév), F11 (plein écran inspect trick)
            if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); showToast('F12 bloqué'); return false; }
            // Ctrl/Cmd + Shift + I/J/C/K (DevTools, Console, Sources)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I','i','J','j','C','c','K','k','E','e','M','m'].includes(e.key)) { e.preventDefault(); showToast('Raccourci développeur bloqué'); return false; }
            // Ctrl+U (source), Ctrl+S (save page), Ctrl+P (print spy)
            if ((e.ctrlKey || e.metaKey) && ['u','U','s','S','p','P'].includes(e.key) && !e.shiftKey) { e.preventDefault(); showToast('Action bloquée'); return false; }
            // Alt+F4 non bloqué (fermeture normale), mais Alt+Cmd+I (macOS DevTools)
            if (e.metaKey && e.altKey && ['i','I'].includes(e.key)) { e.preventDefault(); showToast('DevTools macOS bloqué'); return false; }
        }, true);
        
        // ══════════ ANTI COPIER-COLLER (sauf inputs/textareas) ══════════
        function isFormField(el) {
            return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        }
        
        document.addEventListener('copy', function(e) {
            if (!isFormField(document.activeElement)) {
                e.preventDefault();
                showToast('Copie désactivée sur cette page', '#7c3aed');
            }
        }, true);
        
        document.addEventListener('cut', function(e) {
            if (!isFormField(document.activeElement)) {
                e.preventDefault();
                showToast('Couper désactivé', '#7c3aed');
            }
        }, true);
        
        document.addEventListener('paste', function(e) {
            if (!isFormField(document.activeElement)) {
                e.preventDefault();
                showToast('Coller désactivé', '#7c3aed');
            }
        }, true);
        
        // Blocage Ctrl+C/X/V sur le document global (hors champs)
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && ['c','C','x','X','v','V','a','A'].includes(e.key) && !isFormField(document.activeElement)) {
                e.preventDefault();
                if (['c','C','x','X'].includes(e.key)) showToast('Copie/Couper désactivé', '#7c3aed');
                return false;
            }
        }, true);
        
        // ══════════ ANTI-CLIC DROIT ══════════
        document.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showToast('Clic droit désactivé');
            return false;
        }, true);
        
        // ══════════ ANTI-SÉLECTION ══════════
        document.addEventListener('selectstart', function(e) {
            if (!isFormField(e.target)) { e.preventDefault(); return false; }
        }, true);
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        document.body.style.MozUserSelect = 'none';
        document.body.style.msUserSelect = 'none';
        
        // ══════════ ANTI-DRAG ══════════
        document.addEventListener('dragstart', function(e) { e.preventDefault(); return false; }, true);
        
        // ══════════ ANTI-SCREENSHOT PrintScreen ══════════
        document.addEventListener('keyup', function(e) {
            if (e.key === 'PrintScreen' || e.keyCode === 44) {
                try { navigator.clipboard.writeText('FTY Club Pro - Accès non autorisé'); } catch(err) {}
                showToast('Capture d\'écran bloquée');
                document.body.style.filter = 'blur(25px)';
                setTimeout(function(){ document.body.style.filter = devOpen ? 'blur(20px)' : ''; }, 2500);
            }
        }, true);
        
        // ══════════ PROTECTION SOURCE HTML ══════════
        // Override console pour brouiller l'inspection
        try {
            var _cl = console.log.bind(console);
            Object.defineProperty(console, 'log', {
                get: function() {
                    showToast('Console interceptée');
                    return function(){};
                }
            });
        } catch(e) {}
    }
    
    // ══════════ WATERMARK (pour tout le monde, même xywez) ══════════
    var wm = document.createElement('div');
    wm.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:4.5rem;color:rgba(147,51,234,.035);pointer-events:none;z-index:999997;user-select:none;font-weight:900;white-space:nowrap;font-family:sans-serif;';
    wm.textContent = 'FTY CLUB PRO — PANEL';
    document.body.appendChild(wm);
    var wm2 = document.createElement('div');
    wm2.style.cssText = 'position:fixed;top:70%;left:30%;transform:translate(-50%,-50%) rotate(-35deg);font-size:2rem;color:rgba(147,51,234,.025);pointer-events:none;z-index:999997;user-select:none;font-weight:700;white-space:nowrap;font-family:sans-serif;';
    wm2.textContent = new Date().toLocaleDateString('fr-FR');
    document.body.appendChild(wm2);
    
})();
</script>
</body>
</html>`;
    
    res.send(html);
});


// PATCHED BY FTY-AUTO-PATCHER
// Route permissions (Xywez uniquement)
app.get('/panel/owner/permissions', isAuthenticated, checkSuperAdmin, (req, res) => {
    const db = readDB();
    const owners = db.users.filter(u => u.role === 'owner' && u.discordId !== SUPER_ADMIN_DISCORD_ID);
    
    const content = `
<div class="container">
    <h1 class="page-title">🔐 Gestion des Permissions</h1>
    <p style="opacity: 0.8; margin-bottom: 2rem;">Configurez les permissions des owners et admins</p>
    
    ${owners.map(owner => `
        <div class="card" style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <div>
                    <h3 style="margin: 0;">${owner.username}</h3>
                    <div style="font-size: 0.875rem; opacity: 0.6; margin-top: 0.25rem;">
                        ${owner.email} ${owner.discordId ? '| Discord lié ✅' : ''}
                    </div>
                </div>
                <button class="btn btn-secondary" onclick="togglePermissions('${owner.id}')">
                    ⚙️ Modifier
                </button>
            </div>
            
            <div id="perms-${owner.id}" style="display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(147,51,234,0.3);">
                <div class="grid-2" style="gap: 1rem;">
                    ${renderPermissionToggle(owner.id, 'canBan', 'Ban/Kick membres', owner.permissions?.canBan)}
                    ${renderPermissionToggle(owner.id, 'canManageIP', 'Gestion IP', owner.permissions?.canManageIP)}
                    ${renderPermissionToggle(owner.id, 'canManageBot', 'Gestion Bot', owner.permissions?.canManageBot)}
                    ${renderPermissionToggle(owner.id, 'canManageUsers', 'Gestion utilisateurs', owner.permissions?.canManageUsers)}
                    ${renderPermissionToggle(owner.id, 'canViewLogs', 'Voir tous les logs', owner.permissions?.canViewLogs)}
                    ${renderPermissionToggle(owner.id, 'canManageMatches', 'Gestion matchs', owner.permissions?.canManageMatches)}
                </div>
                <button class="btn btn-primary" onclick="savePermissions('${owner.id}')" style="margin-top: 1rem; width: 100%;">
                    ✅ Sauvegarder
                </button>
            </div>
        </div>
    `).join('')}
</div>

<script>
function renderPermissionToggle(userId, perm, label, checked) {
    return \`
        <label style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: rgba(147,51,234,0.05); border-radius: 8px; cursor: pointer;">
            <input type="checkbox" id="\${userId}-\${perm}" \${checked ? 'checked' : ''} style="width: 20px; height: 20px;">
            <span>\${label}</span>
        </label>
    \`;
}

function togglePermissions(userId) {
    const el = document.getElementById('perms-' + userId);
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function savePermissions(userId) {
    const perms = {
        canBan: document.getElementById(userId + '-canBan').checked,
        canManageIP: document.getElementById(userId + '-canManageIP').checked,
        canManageBot: document.getElementById(userId + '-canManageBot').checked,
        canManageUsers: document.getElementById(userId + '-canManageUsers').checked,
        canViewLogs: document.getElementById(userId + '-canViewLogs').checked,
        canManageMatches: document.getElementById(userId + '-canManageMatches').checked
    };
    
    const res = await fetch('/api/owner/update-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, permissions: perms })
    });
    
    if (res.ok) {
        alert('✅ Permissions sauvegardées');
    } else {
        alert('❌ Erreur');
    }
}
</script>
`;
    
    res.send(renderHTML('Permissions', content, req.session.user));
});

app.post('/api/owner/update-permissions', isAuthenticated, checkSuperAdmin, (req, res) => {
    const { userId, permissions } = req.body;
    
    const db = readDB();
    const user = db.users.find(u => u.id === userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    user.permissions = permissions;
    writeDB(db);
    
    res.json({ success: true });
});

function checkSuperAdmin(req, res, next) {
    if (req.session.user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.status(403).send('Accès refusé - Xywez uniquement');
    }
    next();
}

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
    const isFirstLogin = !user.hasSeenGuide && !user.lastLoginPrev; // premier login = pas encore vu le guide
    if (!user.ip) user.ip = [];
    if (!user.ip.includes(ip)) user.ip.push(ip);
    // Marquer la connexion précédente pour détecter le 1er login
    if (!user.lastLoginPrev && !user.hasSeenGuide) {
        // C'est vraiment la première connexion
        user.lastLoginPrev = user.lastLogin;
    }
    writeDB(db);
    addLog('🔐 Connexion panel', username, username, {}, ip, ci);
    req.session.user = {
        username: user.username,
        role: user.role || user.accountType || 'joueur',
        theme: user.theme || 'dark',
        discordId: user.discordId || null,
        mustChangePassword: !!user.mustChangePassword,
        firstLoginGuide: !user.hasSeenGuide
    };
    if (user.mustChangePassword) return res.redirect('/panel/change-password?forced=1');
    const isXywezUser = user.username === 'xywez' || user.discordId === SUPER_ADMIN_DISCORD_ID;
    if (!user.hasSeenGuide && !isXywezUser) return res.redirect('/panel/welcome-guide');
    // Xywez bypass guide — marquer directement comme vu
    if (isXywezUser && !user.hasSeenGuide) {
        user.hasSeenGuide = true;
        user.guideCompletedAt = new Date().toISOString();
        writeDB(db);
    }
    res.redirect('/panel/dashboard');
});

// ── Identifiant oublié ──────────────────────────────────────────────
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

// ── Mot de passe oublié ─────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════
// §8 (suite) — PANEL LAYOUT (sidebar, menu, chatbot embarqué)
// ════════════════════════════════════════════════════════════════════
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
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '👥', label: 'Membres', href: '/panel/users', id: 'users' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) menu.push({ icon: '📝', label: 'Candidatures', href: '/panel/candidatures', id: 'candidatures' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '📋', label: 'Logs', href: '/panel/logs', id: 'logs' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) menu.push({ icon: '🔑', label: 'Demandes Reset', href: '/panel/reset-requests', id: 'reset-requests' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) menu.push({ icon: '⚽', label: 'Matchs', href: '/panel/matches', id: 'matches' });
    // Lien "Mes convocations" pour les joueurs
    menu.push({ icon: '📋', label: 'Mes Convocations', href: '/panel/mes-convocations', id: 'mes-convocations' });
    if (HIERARCHY[user.role] >= HIERARCHY['support']) {
        const openTickets = (dbP.dmTickets||[]).filter(t=>t.status!=='closed').length;
        menu.push({ icon: '🎫', label: 'Tickets', href: '/panel/tickets', id: 'tickets', badge: openTickets });
    }
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '📢', label: 'Annonces', href: '/panel/annonces', id: 'annonces' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '🤖', label: 'Message Bot', href: '/panel/bot-message', id: 'bot-message' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '📢', label: 'Messages Staff', href: '/panel/broadcast', id: 'broadcast' });
    if (HIERARCHY[user.role] >= HIERARCHY['admin']) menu.push({ icon: '🔄', label: 'Patch Notes', href: '/panel/patch-notes', id: 'patch-notes' });
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '🔨', label: 'Modération', href: '/panel/moderation', id: 'moderation' });
    if (user.role === 'owner') menu.push({ icon: '🤖', label: 'Bot Discord', href: '/panel/bot', id: 'bot' });
    if (user.role === 'owner') menu.push({ icon: '⚙️', label: 'Système', href: '/panel/system', id: 'system' });
    if (user.role === 'owner') menu.push({ icon: '🔍', label: 'Recherche Utilisateurs', href: '/panel/search', id: 'search' });
    if (user.role === 'owner') menu.push({ icon: '🛡️', label: 'Anti-Double Compte', href: '/panel/anti-double', id: 'anti-double' });
    menu.push({ icon: '✉️', label: 'Messagerie', href: '/panel/messages', id: 'messages', badge: unreadMsgs });
    menu.push({ icon: '📌', label: 'Mes Notes', href: '/panel/notes', id: 'notes' });
    menu.push({ icon: '👤', label: 'Mon Profil', href: '/panel/profile', id: 'profile' });
    if (user.role === 'capitaine' || HIERARCHY[user.role] >= HIERARCHY['manager']) menu.push({ icon: '🎯', label: 'Panel Capitaine', href: '/panel/capitaine', id: 'capitaine' });
    if (user.role === 'owner') {
        menu.push({ icon: '🔧', label: 'Maintenance', href: '/panel/owner/maintenance', id: 'maintenance' });
        menu.push({ icon: '🎨', label: 'Site Public', href: '/panel/owner/public-settings', id: 'public-settings' });
        menu.push({ icon: '🛡️', label: 'Gestion IP', href: '/panel/owner/ip-manager', id: 'ip-manager' });
        menu.push({ icon: '🎨', label: 'Thèmes Site', href: '/panel/themes', id: 'themes' });
        menu.push({ icon: '☢️', label: 'Nuke All', href: '/panel/nuke', id: 'nuke', style: 'color:#ef4444' });
    }
    if (HIERARCHY[user.role] >= HIERARCHY['moderateur']) menu.push({ icon: '🌍', label: 'Logs Géo-IP', href: '/panel/logs-geo', id: 'logs-geo' });

    const menuHTML = menu.map(item => `
        <a href="${item.href}" class="sidebar-link ${activePage === item.id ? 'active' : ''}" ${item.style ? `style="${item.style}"` : ''}>
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
    <style>${GLOBAL_CSS}
/* ========== MOBILE RESPONSIVE PANEL ========== */
@media (max-width: 1024px) {
    .panel-sidebar { width: 220px; }
}
@media (max-width: 768px) {
    .container, .panel-container { padding: 0 0.75rem !important; max-width: 100% !important; }
    .panel-sidebar {
        position: fixed; top: 0; left: 0; bottom: 0;
        width: 280px; transform: translateX(-100%);
        transition: transform 0.3s cubic-bezier(.4,0,.2,1);
        z-index: 9998; overflow-y: auto;
        background: rgba(10,0,20,.98) !important;
        box-shadow: 8px 0 32px rgba(0,0,0,.8);
    }
    .panel-sidebar.open { transform: translateX(0); }
    .panel-main { margin-left: 0 !important; padding: 1rem !important; }
    .mob-menu-btn { display: flex !important; }
    
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr !important; gap: 1rem !important; }
    
    .card { padding: 1rem !important; border-radius: 12px !important; }
    
    .page-title { font-size: 1.5rem !important; }
    .page-header { flex-direction: column; gap: 1rem; }
    
    .btn { 
        padding: 0.75rem 1rem !important;
        font-size: 0.9rem !important;
    }
    
    table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; font-size: 0.82rem; }
    td, th { padding: 0.5rem !important; white-space: nowrap; }
    
    input, select, textarea, .form-control { font-size: 16px !important; width: 100% !important; }
    
    .mobile-hidden { display: none !important; }
    
    /* Chatbot mobile */
    #fty-chat-win { 
        width: calc(100vw - 16px) !important; 
        height: calc(100vh - 100px) !important;
        right: 8px !important; 
        bottom: 80px !important; 
    }
    #fty-chat-btn { 
        bottom: 16px !important; 
        right: 16px !important;
        width: 52px !important; 
        height: 52px !important; 
    }
    
    /* Overlay sidebar mobile */
    .sidebar-overlay {
        display: none;
        position: fixed; inset: 0;
        background: rgba(0,0,0,.6);
        z-index: 9997;
        backdrop-filter: blur(4px);
    }
    .sidebar-overlay.show { display: block; }
}
@media (max-width: 480px) {
    .page-title { font-size: 1.25rem !important; }
    .card { padding: 0.75rem !important; }
    .btn { font-size: 0.85rem !important; padding: 0.6rem 0.875rem !important; }
    table { font-size: 0.75rem !important; }
}
@media (hover: none) and (pointer: coarse) {
    .btn, a, button { min-height: 44px; }
    input, select, textarea { min-height: 44px; }
}

/* ── Messagerie responsive ── */
@media (max-width: 768px) {
  .msg-layout {
    grid-template-columns: 1fr !important;
    gap: 1rem !important;
  }
  .msg-layout > .card:first-child {
    max-height: 220px;
    overflow-y: auto;
  }
}
</style>
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
    <script>
        // 🔒 FTY Security — Bypass sécurité pour Xywez uniquement
        window.__xywezBypass = ${(user.discordId === SUPER_ADMIN_DISCORD_ID || user.username === 'xywez') ? 'true' : 'false'};
    </script>
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

<!-- ═══════════ CHATBOT FTY ULTRA V3 ═══════════ -->
<button id="fty-chat-btn" onclick="ftyToggle()" title="FTY Assistant" style="position:fixed!important;bottom:24px!important;right:24px!important;z-index:2147483647!important;width:62px!important;height:62px!important;border-radius:50%!important;background:linear-gradient(135deg,#7c3aed,#9333ea,#ec4899)!important;border:none!important;cursor:pointer!important;font-size:1.7rem!important;box-shadow:0 6px 30px rgba(147,51,234,.75),0 0 0 0 rgba(147,51,234,.4)!important;display:flex!important;align-items:center!important;justify-content:center!important;pointer-events:auto!important;outline:none!important;animation:ftyPulseBtn 3s ease-in-out infinite!important;">💬</button>
<div id="fty-chat-win" style="position:fixed!important;bottom:100px!important;right:24px!important;z-index:2147483646!important;width:360px!important;height:520px!important;background:linear-gradient(180deg,#0d0020 0%,#0a0014 100%)!important;border:1.5px solid rgba(147,51,234,.5)!important;border-radius:20px!important;overflow:hidden!important;display:none!important;flex-direction:column!important;box-shadow:0 25px 70px rgba(147,51,234,.55),inset 0 1px 0 rgba(147,51,234,.2)!important;">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#6d28d9,#9333ea,#ec4899);padding:1rem 1.1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:relative;overflow:hidden;">
    <div style="position:absolute;inset:0;background:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 20%22><path d=%22M0 10 Q25 0 50 10 Q75 20 100 10%22 stroke=%22rgba(255,255,255,0.1)%22 fill=%22none%22 stroke-width=%221%22/></svg>') repeat-x;opacity:.4;pointer-events:none;"></div>
    <div style="display:flex;align-items:center;gap:.75rem;position:relative;">
      <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;border:2px solid rgba(255,255,255,.25);flex-shrink:0;">🤖</div>
      <div>
        <div style="color:#fff;font-weight:800;font-size:.95rem;letter-spacing:.01em;">FTY Assistant</div>
        <div style="color:rgba(255,255,255,.8);font-size:.72rem;display:flex;align-items:center;gap:.3rem;"><span style="width:7px;height:7px;background:#10b981;border-radius:50%;display:inline-block;box-shadow:0 0 6px #10b981;"></span> En ligne • Répond instantanément</div>
      </div>
    </div>
    <div style="display:flex;gap:.35rem;position:relative;">
      <button onclick="ftyClear()" title="Effacer" style="background:rgba(255,255,255,.15);border:none;color:rgba(255,255,255,.8);cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;transition:background .2s;" onmouseover="this.style.background='rgba(255,255,255,.25)'" onmouseout="this.style.background='rgba(255,255,255,.15)'">🗑️</button>
      <button onclick="ftyToggle()" style="background:rgba(255,255,255,.15);border:none;color:#fff;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;transition:background .2s;" onmouseover="this.style.background='rgba(255,255,255,.25)'" onmouseout="this.style.background='rgba(255,255,255,.15)'">✕</button>
    </div>
  </div>
  <!-- Quick actions -->
  <div id="fty-quick" style="display:flex;gap:.4rem;padding:.6rem .75rem;flex-wrap:wrap;flex-shrink:0;border-bottom:1px solid rgba(147,51,234,.15);background:rgba(147,51,234,.04);">
    <button onclick="ftyQuick('Comment rejoindre ?')" style="background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.3);color:rgba(255,255,255,.85);border-radius:20px;padding:.3rem .8rem;font-size:.72rem;cursor:pointer;transition:all .2s;white-space:nowrap;">🎯 Rejoindre</button>
    <button onclick="ftyQuick('Prochains matchs ?')" style="background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.3);color:rgba(255,255,255,.85);border-radius:20px;padding:.3rem .8rem;font-size:.72rem;cursor:pointer;transition:all .2s;white-space:nowrap;">⚽ Matchs</button>
    <button onclick="ftyQuick('Recrutement')" style="background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.3);color:rgba(255,255,255,.85);border-radius:20px;padding:.3rem .8rem;font-size:.72rem;cursor:pointer;transition:all .2s;white-space:nowrap;">📋 Recrute</button>
    <button onclick="ftyQuick('Lien Discord')" style="background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.3);color:rgba(255,255,255,.85);border-radius:20px;padding:.3rem .8rem;font-size:.72rem;cursor:pointer;transition:all .2s;white-space:nowrap;">💬 Discord</button>
  </div>
  <!-- Messages -->
  <div id="fty-msgs" style="flex:1;overflow-y:auto;padding:.875rem;display:flex;flex-direction:column;gap:.6rem;scrollbar-width:thin;scrollbar-color:rgba(147,51,234,.4) transparent;">
    <div class="fty-bot-msg">👋 Bonjour ! Je suis le <strong>FTY Assistant</strong> 🤖<br>Pose-moi une question ou clique sur un raccourci !</div>
  </div>
  <!-- Typing indicator -->
  <div id="fty-typing" style="display:none;padding:.4rem .875rem;flex-shrink:0;">
    <div style="display:inline-flex;align-items:center;gap:.4rem;background:rgba(147,51,234,.15);border:1px solid rgba(147,51,234,.25);border-radius:0 10px 10px 10px;padding:.5rem .875rem;">
      <div style="display:flex;gap:.2rem;align-items:center;"><div class="fty-dot"></div><div class="fty-dot" style="animation-delay:.15s!important"></div><div class="fty-dot" style="animation-delay:.3s!important"></div></div>
      <span style="color:rgba(255,255,255,.5);font-size:.75rem;">FTY Assistant écrit...</span>
    </div>
  </div>
  <!-- Input -->
  <div style="padding:.75rem;border-top:1px solid rgba(147,51,234,.2);display:flex;gap:.5rem;flex-shrink:0;background:rgba(5,0,15,.6);">
    <input id="fty-inp" type="text" placeholder="Pose ta question..." style="flex:1;background:rgba(147,51,234,.1);border:1.5px solid rgba(147,51,234,.35);border-radius:10px;padding:.65rem 1rem;color:#fff;font-size:.875rem;outline:none;min-width:0;transition:border-color .2s;font-family:inherit;" onkeydown="if(event.key==='Enter'){event.preventDefault();ftySend();}" onfocus="this.style.borderColor='rgba(147,51,234,.7)'" onblur="this.style.borderColor='rgba(147,51,234,.35)'">
    <button id="fty-send-btn" onclick="ftySend()" style="background:linear-gradient(135deg,#7c3aed,#ec4899);border:none;border-radius:10px;width:42px;height:42px;color:#fff;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;transition:transform .15s,box-shadow .15s;" onmouseover="this.style.transform='scale(1.05)';this.style.boxShadow='0 4px 20px rgba(147,51,234,.6)'" onmouseout="this.style.transform='';this.style.boxShadow=''">➤</button>
  </div>
</div>
<style>
@keyframes ftyPulseBtn{0%,100%{box-shadow:0 6px 30px rgba(147,51,234,.75),0 0 0 0 rgba(147,51,234,.4)!important}50%{box-shadow:0 6px 30px rgba(147,51,234,.75),0 0 0 10px rgba(147,51,234,0)!important}}
@keyframes ftyIn{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes ftyDot{0%,80%,100%{transform:scale(0);opacity:.3}40%{transform:scale(1);opacity:1}}
#fty-chat-btn:hover{transform:scale(1.08) rotate(-5deg)!important;transition:transform .25s!important;}
#fty-chat-win.fty-open{display:flex!important;animation:ftyIn .25s ease;}
.fty-bot-msg{background:rgba(147,51,234,.18);border:1px solid rgba(147,51,234,.3);border-radius:0 12px 12px 12px;padding:.7rem .95rem;color:#f0ecff;font-size:.84rem;max-width:92%;line-height:1.5;word-break:break-word;}
.fty-user-msg{background:linear-gradient(135deg,rgba(124,58,237,.6),rgba(236,72,153,.45));border-radius:12px 12px 0 12px;padding:.7rem .95rem;color:#fff;font-size:.84rem;max-width:88%;align-self:flex-end;word-break:break-word;margin-left:auto;}
.fty-dot{width:7px;height:7px;background:rgba(147,51,234,.8);border-radius:50%;animation:ftyDot 1.2s ease-in-out infinite;}
@media(max-width:480px){#fty-chat-win{width:calc(100vw - 16px)!important;height:calc(100vh - 90px)!important;right:8px!important;bottom:82px!important;}#fty-chat-btn{bottom:16px!important;right:16px!important;width:55px!important;height:55px!important;}}
</style>
<script>
var _ftyOpen = false;
function ftyToggle() {
  var w = document.getElementById('fty-chat-win');
  if (!w) return;
  _ftyOpen = !_ftyOpen;
  if (_ftyOpen) {
    w.classList.add('fty-open'); w.style.setProperty('display','flex','important');
    setTimeout(function(){var i=document.getElementById('fty-inp');if(i)i.focus();},80);
  } else {
    w.classList.remove('fty-open'); w.style.setProperty('display','none','important');
  }
}
function ftyAddMsg(text, type) {
  var m = document.getElementById('fty-msgs');
  if (!m) return;
  var d = document.createElement('div');
  d.className = type === 'user' ? 'fty-user-msg' : 'fty-bot-msg';
  d.innerHTML = text;
  m.appendChild(d);
  m.scrollTop = m.scrollHeight;
  return d;
}
function ftyClear() {
  var m = document.getElementById('fty-msgs');
  if (m) { m.innerHTML = ''; ftyAddMsg('🗑️ Conversation effacée !<br>Comment puis-je vous aider ?', 'bot'); }
}
function ftyQuick(txt) {
  var i = document.getElementById('fty-inp');
  if (i) { i.value = txt; ftySend(); }
}
function ftyShowTyping(show) {
  var t = document.getElementById('fty-typing');
  if (t) t.style.display = show ? 'block' : 'none';
}
async function ftySend() {
  var inp = document.getElementById('fty-inp');
  var btn = document.getElementById('fty-send-btn');
  if (!inp) return;
  var msg = inp.value.trim();
  if (!msg) return;
  inp.value = ''; inp.disabled = true;
  if (btn) btn.disabled = true;
  ftyAddMsg(msg, 'user');
  ftyShowTyping(true);
  // Scroll to bottom
  var m = document.getElementById('fty-msgs');
  if (m) m.scrollTop = m.scrollHeight;
  try {
    var r = await fetch('/api/chatbot', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: msg })
    });
    ftyShowTyping(false);
    var data = await r.json();
    ftyAddMsg(data.reply || 'Pas de réponse.', 'bot');
  } catch(e) {
    ftyShowTyping(false);
    ftyAddMsg('⚠️ Erreur de connexion. Réessaie dans un instant.', 'bot');
  }
  inp.disabled = false; if (btn) btn.disabled = false; inp.focus();
}
</script>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- WATERMARK ANTI-SCREENSHOT PANEL — FTY V4 "REAL"               -->
<!-- Stratégie : watermark visible (dissuasion) + CSS mix-blend     -->
<!-- (identification même sur screenshot OBS/iOS/Android/Streamlabs)-->
<!-- ═══════════════════════════════════════════════════════════════ -->

<!-- ── WATERMARK 1 : Visible, semi-transparent, en diagonale ────── -->
<!-- Affiché H24 sur tout le panel. Contient username + timestamp.   -->
<!-- Tout le monde le voit → personne n'ose partager.               -->
<div id="fty-wm-visible" style="
  position:fixed;
  top:0;left:0;right:0;bottom:0;
  pointer-events:none;
  z-index:888888;
  overflow:hidden;
  display:flex;
  align-items:center;
  justify-content:center;
">
  <canvas id="fty-wm-canvas" style="position:absolute;top:0;left:0;width:100%;height:100%;opacity:0.13;pointer-events:none;"></canvas>
</div>

<!-- ── WATERMARK 2 : Invisible à l'œil, visible sur screenshot ─── -->
<!-- Technique CSS mix-blend-mode : différence de rendu             -->
<!-- entre affichage direct (gamma screen) et capture image.        -->
<!-- Sur screenshot le fond blanc du PNG révèle le texte.           -->
<div id="fty-wm-hidden" style="
  position:fixed;
  top:0;left:0;right:0;bottom:0;
  pointer-events:none;
  z-index:888889;
  overflow:hidden;
  mix-blend-mode:difference;
  opacity:0.03;
  display:flex;
  align-items:center;
  justify-content:center;
">
  <canvas id="fty-wm-canvas2" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></canvas>
</div>

<!-- ── Bloquer partage d'onglet Discord / Zoom via getDisplayMedia ─ -->
<!-- Seul vrai blocage possible : partage d'onglet spécifique        -->
<script>
(function() {
  'use strict';

  // ════════════════════════════════════════════════════════════
  // CONFIG
  // ════════════════════════════════════════════════════════════
  const WM_USER  = '${user.username}';
  const WM_ROLE  = '${(ROLE_LABELS[user.role] || user.role)}';
  const WM_COLOR = '#a855f7'; // couleur watermark visible
  const LOG_URL  = '/api/screenshot-attempt';

  // ════════════════════════════════════════════════════════════
  // WATERMARK VISIBLE — Canvas en diagonale, toute la page
  // Répète "username • rôle • date/heure" en grille oblique
  // ════════════════════════════════════════════════════════════
  function drawWatermark() {
    const canvas = document.getElementById('fty-wm-canvas');
    if (!canvas) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const now = new Date().toLocaleString('fr-FR');
    const line1 = WM_USER + '  •  ' + WM_ROLE;
    const line2 = '🔒 FTY CLUB PRO  •  ' + now;

    ctx.save();
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillStyle = WM_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Grille oblique -30° couvrant toute la page
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 6);  // -30°

    const spacingX = 420;
    const spacingY = 130;
    const cols = Math.ceil(Math.sqrt(W * W + H * H) / spacingX) + 2;
    const rows = Math.ceil(Math.sqrt(W * W + H * H) / spacingY) + 2;

    for (let r = -rows; r <= rows; r++) {
      for (let c = -cols; c <= cols; c++) {
        const x = c * spacingX;
        const y = r * spacingY;
        ctx.fillText(line1, x, y - 11);
        ctx.fillText(line2, x, y + 11);
      }
    }
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════
  // WATERMARK INVISIBLE (mix-blend trick)
  // Rendu avec mix-blend-mode:difference à très faible opacité
  // Invisible sur fond sombre du panel, mais apparaît sur
  // screenshot car le compositeur image le capture différemment
  // ════════════════════════════════════════════════════════════
  function drawHiddenWatermark() {
    const canvas = document.getElementById('fty-wm-canvas2');
    if (!canvas) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const now = new Date().toLocaleString('fr-FR');
    const text = 'FTY — ' + WM_USER + ' — ' + now + ' — CONFIDENTIEL';

    ctx.save();
    ctx.font = 'bold 22px Arial, sans-serif';
    // Blanc pur : avec mix-blend-mode:difference → invisible sur noir, visible sur screenshot
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;

    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 5);

    const spacingX = 500;
    const spacingY = 150;
    const cols = Math.ceil(Math.sqrt(W * W + H * H) / spacingX) + 2;
    const rows = Math.ceil(Math.sqrt(W * W + H * H) / spacingY) + 2;

    for (let r = -rows; r <= rows; r++) {
      for (let c = -cols; c <= cols; c++) {
        ctx.fillText(text, c * spacingX, r * spacingY);
      }
    }
    ctx.restore();
  }

  // Dessine au chargement et à chaque resize (responsive)
  function refreshAll() {
    drawWatermark();
    drawHiddenWatermark();
  }
  refreshAll();
  // Mise à jour du timestamp toutes les 30s
  setInterval(refreshAll, 30000);
  window.addEventListener('resize', refreshAll);

  // ════════════════════════════════════════════════════════════
  // BLOQUER getDisplayMedia (partage d'onglet Discord/Zoom/Meet)
  // C'est le seul vrai blocage possible via JS
  // ════════════════════════════════════════════════════════════
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    navigator.mediaDevices.getDisplayMedia = function() {
      try { fetch(LOG_URL, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ user: WM_USER, role: WM_ROLE, reason: 'getDisplayMedia:blocked', ts: new Date().toISOString() }) }); } catch(e) {}
      return Promise.reject(new DOMException('Le partage d\'écran est désactivé sur ce panel.', 'NotAllowedError'));
    };
  }

  // ════════════════════════════════════════════════════════════
  // LOG SERVEUR : PrintScreen détecté (niveau navigateur)
  // Ne peut pas empêcher la capture OS mais logge la tentative
  // ════════════════════════════════════════════════════════════
  function logAttempt(reason) {
    try { fetch(LOG_URL, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user: WM_USER, role: WM_ROLE, reason, ts: new Date().toISOString() }) }); } catch(e) {}
  }
  // Ctrl+P (print vers PDF)
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      logAttempt('keydown:Ctrl+P');
    }
    // Mac screenshots (reçus parfois)
    if (e.metaKey && e.shiftKey && ['3','4','5'].includes(e.key)) {
      logAttempt('keydown:Mac-Screenshot-' + e.key);
    }
  }, true);
  document.addEventListener('keyup', function(e) {
    if (e.key === 'PrintScreen') logAttempt('keyup:PrintScreen');
  }, true);

  // Clic droit & sélection désactivés (petit plus)
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  document.addEventListener('copy', function(e) {
    e.preventDefault();
    if (e.clipboardData) e.clipboardData.setData('text/plain', '🔒 Contenu protégé — FTY Club Pro — ' + WM_USER);
  });

  console.log('%c[FTY] 🛡️ Watermark Anti-Screenshot V4 actif', 'color:#a855f7;font-weight:bold;font-size:13px;');
})();
</script>

</body>
</html>`;
}

// ════════════════════════════════════════════════════════════════════
// §11 — PANEL : DASHBOARD
// ════════════════════════════════════════════════════════════════════
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

// ── Bot Discord (config owner) ─────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════
// §12 — PANEL : UTILISATEURS & PROFIL
// ════════════════════════════════════════════════════════════════════
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
                            (canAct && myRank >= HIERARCHY['manager'] ? '<a href="/panel/users/' + u.username + '/reset-password" class="btn btn-sm" style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3);" title="Réinitialiser le mot de passe (envoi DM Discord)" onclick="return confirm(\'Réinitialiser le mot de passe de ' + u.username + ' ?\\n\\nUn mot de passe provisoire sera envoyé par DM Discord.\')">🔑</a>' : '') +
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
    const { username, password, discordId } = req.body;
    // Le formulaire peut envoyer soit 'role' soit 'accountType'
    const role = req.body.role || req.body.accountType || '';
    const user = req.session.user;
    
    if (!username || !password || !role) {
        return res.redirect('/panel/users/create?error=' + encodeURIComponent('Tous les champs sont requis (username, password, rôle)'));
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


// ── Modifier un utilisateur ─────────────────────────────────────────
app.get('/panel/users/:username/edit', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const editor = req.session.user;
    const targetUser = db.users.find(u => u.username === req.params.username);

    if (!targetUser) return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    if (targetUser.username === 'xywez' && editor.username !== 'xywez') return res.redirect('/panel/users?error=' + encodeURIComponent('Impossible de modifier le compte xywez'));
    if (editor.username !== 'xywez' && HIERARCHY[editor.role] <= HIERARCHY[targetUser.role || 'joueur']) return res.redirect('/panel/users?error=' + encodeURIComponent('Vous ne pouvez pas modifier un compte de rang égal ou supérieur'));

    const allowedRoles = Object.keys(HIERARCHY).filter(r => HIERARCHY[r] < HIERARCHY[editor.role] || editor.username === 'xywez');

    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">Modifier <span>${targetUser.username}</span></div>
            <div class="page-breadcrumb">Panel · Membres · Modifier</div>
        </div>
        <a href="/panel/users" class="btn btn-outline">← Retour</a>
    </div>
    ${req.query.error ? `<div class="alert alert-danger" style="margin-bottom:1rem;">❌ ${req.query.error}</div>` : ''}
    <div class="card" style="max-width:640px;">
        <form method="POST" action="/panel/users/${targetUser.username}/update">
            <div class="form-group">
                <label class="form-label">👤 Nom d'utilisateur</label>
                <input type="text" class="form-control" value="${targetUser.username}" disabled style="opacity:.6;">
            </div>
            <div class="form-group">
                <label class="form-label">🎭 Rôle</label>
                <select name="role" class="form-control" required>
                    ${allowedRoles.map(role => `<option value="${role}" ${(targetUser.role||targetUser.accountType) === role ? 'selected' : ''}>${ROLE_LABELS[role] || role}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">💬 Discord ID</label>
                <input type="text" name="discordId" class="form-control" value="${targetUser.discordId || ''}" placeholder="Ex: 123456789012345678">
            </div>
            <div class="form-group">
                <label class="form-label">👤 Prénom</label>
                <input type="text" name="firstName" class="form-control" value="${targetUser.firstName || ''}" placeholder="Prénom">
            </div>
            <div class="form-group">
                <label class="form-label">📋 Statut du compte</label>
                <select name="status" class="form-control">
                    <option value="active" ${!targetUser.suspended && !targetUser.banned ? 'selected' : ''}>✅ Actif</option>
                    <option value="suspended" ${targetUser.suspended ? 'selected' : ''}>⏸️ Suspendu</option>
                    <option value="banned" ${targetUser.banned ? 'selected' : ''}>🔨 Banni</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">🔧 Note interne (optionnel)</label>
                <input type="text" name="note" class="form-control" value="${targetUser.note || ''}" placeholder="Note visible uniquement par le staff">
            </div>
            <div style="display:flex;gap:.75rem;margin-top:1.5rem;">
                <a href="/panel/users" class="btn btn-outline">Annuler</a>
                <button type="submit" class="btn btn-primary" style="flex:1;">💾 Sauvegarder les modifications</button>
            </div>
        </form>
    </div>`;

    res.send(panelLayout(editor, `Modifier ${targetUser.username}`, content, 'users'));
});

app.post('/panel/users/:username/update', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const editor = req.session.user;
    const targetUser = db.users.find(u => u.username === req.params.username);

    if (!targetUser) return res.redirect('/panel/users?error=' + encodeURIComponent('Utilisateur introuvable'));
    if (targetUser.username === 'xywez' && editor.username !== 'xywez') return res.redirect('/panel/users?error=' + encodeURIComponent('Impossible de modifier le compte xywez'));
    if (editor.username !== 'xywez' && HIERARCHY[editor.role] <= HIERARCHY[targetUser.role || 'joueur']) return res.redirect('/panel/users?error=' + encodeURIComponent('Rang insuffisant'));

    const { role, discordId, status, firstName, note } = req.body;
    const oldRole = targetUser.role;

    if (role) { targetUser.role = role; targetUser.accountType = role; }
    if (discordId !== undefined) targetUser.discordId = discordId.trim() || targetUser.discordId;
    if (firstName !== undefined) targetUser.firstName = firstName.trim();
    if (note !== undefined) targetUser.note = note.trim();
    targetUser.suspended = status === 'suspended';
    targetUser.banned = status === 'banned';

    writeDB(db);
    addLog('✏️ Modification membre', editor.username, targetUser.username, { role, oldRole, status }, getClientIP(req), getClientInfo(req));

    res.redirect('/panel/users?success=' + encodeURIComponent(`✅ ${targetUser.username} modifié avec succès`));
});

// ════════════════════════════════════════════════════════════════════
// §16 — PANEL : MANAGER (Candidatures, Matchs)
// ════════════════════════════════════════════════════════════════════
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

app.post('/panel/candidatures/:id/accept', isAuthenticated, hasRole('manager'), async (req, res) => {
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
    
    // Envoyer un DM Discord
    if (candidature.discordId) {
        await sendDiscordDM(candidature.discordId,
            '✅ Candidature Acceptée — FTY Club Pro',
            `Félicitations **${candidature.name}** ! 🎉\n\nTa candidature pour le poste de **${candidature.position}** sur **FTY Club Pro** a été **acceptée** !\n\n👉 Rejoins le serveur Discord et connecte-toi au panel :\nhttps://fty-club-pro-1.onrender.com\n\n**Révisée par :** ${candidature.reviewedBy}`,
            '#22c55e'
        );
    }
    
    res.redirect('/panel/candidatures?success=' + encodeURIComponent(`Candidature de ${candidature.name} acceptée`));
});

app.post('/panel/candidatures/:id/reject', isAuthenticated, hasRole('manager'), async (req, res) => {
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
    
    // Envoyer un DM Discord
    if (candidature.discordId) {
        await sendDiscordDM(candidature.discordId,
            '❌ Candidature Refusée — FTY Club Pro',
            `Bonjour **${candidature.name}**,\n\nNous avons bien examiné ta candidature pour le poste de **${candidature.position}** sur **FTY Club Pro**, mais nous ne pouvons pas la retenir pour le moment.\n\nN'hésite pas à repostuler dans le futur ! 💪\n\n**Révisée par :** ${candidature.reviewedBy}`,
            '#ef4444'
        );
    }
    
    res.redirect('/panel/candidatures?success=' + encodeURIComponent(`Candidature de ${candidature.name} refusée`));
});

// ════════════════════════════════════════════════════════════════════
// §17 — PANEL : ADMINISTRATION (Logs, Annonces, Reset MDP Admin)
// ════════════════════════════════════════════════════════════════════
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

// ── Demandes de reset mot de passe (support) ───────────────────────
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

// ── Approuver une demande reset ─────────────────────────────────────
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

// ── Rejeter une demande reset ───────────────────────────────────────
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

// ── Gestion des matchs ──────────────────────────────────────────────
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

app.post('/panel/matches/create', isAuthenticated, hasRole('manager'), async (req, res) => {
    const { adversaire, date, competition, stadium } = req.body;
    const db = readDB();
    
    if (!adversaire || !date || !competition) {
        return res.redirect('/panel/matches/create?error=' + encodeURIComponent('Tous les champs obligatoires doivent être remplis'));
    }

    // ── Génération identifiant unique hôte ──
    function genToken(len = 12) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let t = '';
        for (let i = 0; i < len; i++) t += chars[Math.floor(Math.random() * chars.length)];
        return t;
    }
    const matchToken = 'FTY-' + genToken(4) + '-' + genToken(4);

    const newMatch = {
        id: 'match-' + Date.now(),
        adversaire,
        date,
        competition,
        stadium: stadium || 'FTY Arena',
        status: 'scheduled',
        score: null,
        // ── Système match hub ──
        token: matchToken,
        hoteUsername: req.session.user.username,
        composition: [],        // [{poste, joueurUsername, joueurDiscordId}]
        tactique: { formation: '4-3-3', style: 'Équilibré', mentality: 'Normal' },
        convoqués: [],          // [{username, discordId, poste, statut}]
        remplaçants: [],
        vocDiscordId: null,
        roleDiscordId: null,
        hoteRoleDiscordId: null,
        createdAt: new Date().toISOString(),
        createdBy: req.session.user.username,
        cancelledAt: null,
        sanctionRequests: []
    };
    
    db.matches.push(newMatch);
    writeDB(db);
    
    addLog('⚽ Création match hub', req.session.user.username, adversaire, { competition, token: matchToken }, getClientIP(req), getClientInfo(req));

    // ── Notifier les joueurs qu'un match a été annoncé ──
    const joueurs = db.users.filter(u => (u.role === 'joueur' || u.accountType === 'joueur') && !u.banned && !u.suspended);
    joueurs.forEach(u => addNotification(db, u.username, 'match', '⚽ Nouveau match annoncé !', `Match contre ${adversaire} le ${date} (${competition}) — Convocations à venir.`, 'normal'));
    writeDB(db);

    // ── Créer la voc Discord temporaire via bot ──
    try {
        await callBotAPI('/api/create-match-voice', 'POST', {
            apiKey: PANEL_API_KEY,
            matchId: newMatch.id,
            matchToken,
            adversaire,
            date,
            competition,
            hoteUsername: req.session.user.username
        });
    } catch(e) { console.warn('[MATCH] Création voc Discord échouée:', e.message); }
    
    res.redirect('/panel/match/' + newMatch.id + '?success=' + encodeURIComponent('Match créé ! Accédez au panel du match.'));
});

// ── Panel match dédié (hôte ou manager+) ──────────────────────────────
app.get('/panel/match/:id', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.status(404).send(errorPage('Match introuvable', 'Ce match n\'existe pas.'));

    // Construire la liste des joueurs par poste (rôle joueur dans le panel)
    const joueurs = db.users.filter(u => (u.role === 'joueur' || u.accountType === 'joueur') && !u.banned && !u.suspended);
    const postesFootball = [
        { key: 'gardien', label: '🧤 Gardien', count: 1 },
        { key: 'defenseur_droit', label: '🛡️ Défenseur Droit', count: 1 },
        { key: 'defenseur_central_1', label: '🛡️ Défenseur Central 1', count: 1 },
        { key: 'defenseur_central_2', label: '🛡️ Défenseur Central 2', count: 1 },
        { key: 'defenseur_gauche', label: '🛡️ Défenseur Gauche', count: 1 },
        { key: 'milieu_defensif', label: '⚙️ Milieu Défensif', count: 1 },
        { key: 'milieu_central_1', label: '⚙️ Milieu Central 1', count: 1 },
        { key: 'milieu_central_2', label: '⚙️ Milieu Central 2', count: 1 },
        { key: 'ailier_droit', label: '⚡ Ailier Droit', count: 1 },
        { key: 'ailier_gauche', label: '⚡ Ailier Gauche', count: 1 },
        { key: 'attaquant', label: '🎯 Attaquant', count: 1 }
    ];
    const compositions = match.composition || [];
    const convoqués = match.convoqués || [];

    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🏟️ Match <span>vs ${match.adversaire}</span></div>
            <div class="page-breadcrumb">${match.competition} · ${match.date} · ${match.stadium}</div>
        </div>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
            <span style="background:rgba(147,51,234,.2);color:#c084fc;border:1px solid rgba(147,51,234,.4);border-radius:8px;padding:.5rem 1rem;font-size:.8rem;font-family:monospace;">🔑 Token: <strong>${match.token}</strong></span>
            <span style="background:${match.status==='scheduled'?'rgba(245,158,11,.2)':match.status==='live'?'rgba(34,197,94,.2)':'rgba(107,114,128,.2)'};color:${match.status==='scheduled'?'#fcd34d':match.status==='live'?'#6ee7b7':'#9ca3af'};border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:.5rem 1rem;font-size:.8rem;">
                ${match.status==='scheduled'?'📅 Planifié':match.status==='live'?'🔴 En cours':match.status==='cancelled'?'❌ Annulé':'✅ Terminé'}
            </span>
        </div>
    </div>

    ${req.query.success ? `<div class="alert alert-success" style="margin-bottom:1rem;">✅ ${decodeURIComponent(req.query.success)}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger" style="margin-bottom:1rem;">❌ ${decodeURIComponent(req.query.error)}</div>` : ''}

    ${match.status === 'cancelled' ? `<div class="alert" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#fca5a5;margin-bottom:1rem;">❌ Ce match a été annulé.</div>` : ''}

    <div class="grid-2" style="gap:1.5rem;align-items:start;">
        <!-- Colonne gauche : composition interactive -->
        <div>
            <div class="card" style="margin-bottom:1.5rem;">
                <h3 style="margin-bottom:1rem;">⚽ Composition Interactive</h3>
                <div class="form-group">
                    <label class="form-label">🧠 Formation</label>
                    <select id="matchFormation" class="form-control" onchange="updateFormation(this.value)">
                        ${['4-3-3','4-4-2','3-5-2','4-2-3-1','5-3-2','3-4-3'].map(f => `<option value="${f}" ${(match.tactique||{}).formation===f?'selected':''}>${f}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">🎯 Style de jeu</label>
                    <select id="matchStyle" class="form-control">
                        ${['Équilibré','Offensif','Défensif','Contre-attaque','Pressing haut'].map(s => `<option value="${s}" ${(match.tactique||{}).style===s?'selected':''}>${s}</option>`).join('')}
                    </select>
                </div>
                <button onclick="saveTactique('${match.id}')" class="btn btn-outline btn-sm" style="margin-bottom:1rem;">💾 Sauvegarder la tactique</button>

                <h4 style="margin-bottom:1rem;color:var(--text-muted);">Sélection des joueurs</h4>
                <div id="compositionForm">
                ${postesFootball.map(poste => {
                    const assigned = compositions.find(c => c.poste === poste.key);
                    return `<div class="form-group" style="background:var(--bg-tertiary);border-radius:10px;padding:.875rem;margin-bottom:.75rem;">
                        <label class="form-label" style="margin-bottom:.5rem;">${poste.label}</label>
                        <select class="form-control poste-select" data-poste="${poste.key}" onchange="markDirty()">
                            <option value="">-- Non défini --</option>
                            ${joueurs.map(j => `<option value="${j.username}|${j.discordId||''}" ${assigned && assigned.joueurUsername===j.username?'selected':''}>${j.username}${j.discordId?' ✅':' ⚠️ (pas de Discord)'}</option>`).join('')}
                        </select>
                        ${assigned ? `<div style="font-size:.75rem;color:#6ee7b7;margin-top:.3rem;">✅ ${assigned.joueurUsername}</div>` : ''}
                    </div>`;
                }).join('')}
                </div>
                <div style="display:flex;gap:.75rem;margin-top:1rem;">
                    <button onclick="saveComposition('${match.id}')" class="btn btn-primary" style="flex:1;">💾 Sauvegarder Composition</button>
                    <button onclick="validerEtConvoquer('${match.id}')" class="btn btn-success" style="flex:1;" id="btnConvoquer">🚀 Valider & Convoquer</button>
                </div>
                <div id="compResult" style="margin-top:.75rem;"></div>
            </div>

            <!-- Remplacements -->
            ${convoqués.length > 0 ? `
            <div class="card" style="margin-bottom:1.5rem;">
                <h3 style="margin-bottom:1rem;">🔄 Remplacement</h3>
                <div class="form-group">
                    <label class="form-label">Joueur sortant</label>
                    <select id="replSortant" class="form-control">
                        <option value="">-- Sélectionner --</option>
                        ${convoqués.map(c => `<option value="${c.username}">${c.username} (${c.poste||'?'})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Joueur entrant</label>
                    <select id="replEntrant" class="form-control">
                        <option value="">-- Sélectionner --</option>
                        ${joueurs.filter(j => !convoqués.find(c=>c.username===j.username)).map(j => `<option value="${j.username}|${j.discordId||''}">${j.username}</option>`).join('')}
                    </select>
                </div>
                <button onclick="faireRemplacement('${match.id}')" class="btn btn-primary btn-full">🔄 Effectuer le Remplacement</button>
                <div id="replResult" style="margin-top:.5rem;"></div>
            </div>` : ''}
        </div>

        <!-- Colonne droite : convoqués + actions -->
        <div>
            <div class="card" style="margin-bottom:1.5rem;">
                <h3 style="margin-bottom:1rem;">👥 Joueurs Convoqués (${convoqués.length})</h3>
                ${convoqués.length === 0 ? '<p style="color:var(--text-muted);text-align:center;padding:1.5rem;">Aucun joueur convoqué pour l\'instant.</p>' :
                convoqués.map(c => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem;background:var(--bg-tertiary);border-radius:10px;margin-bottom:.5rem;">
                    <div>
                        <strong>${c.username}</strong>
                        <div style="font-size:.75rem;color:var(--text-muted);">${c.poste||'?'} ${c.discordId?'· ✅ Discord lié':'· ⚠️ Pas de Discord'}</div>
                    </div>
                    <span style="font-size:.75rem;background:rgba(34,197,94,.15);color:#6ee7b7;border-radius:20px;padding:.2rem .6rem;">Convoqué</span>
                </div>`).join('')}
            </div>

            <!-- Actions match -->
            <div class="card">
                <h3 style="margin-bottom:1rem;">⚡ Actions du Match</h3>
                <div style="display:flex;flex-direction:column;gap:.75rem;">
                    ${match.status !== 'cancelled' ? `
                    <button onclick="if(confirm('Annuler ce match définitivement ?')) window.location='/panel/match/${match.id}/cancel'" class="btn btn-danger">❌ Annuler le Match</button>
                    ` : ''}
                    <button onclick="showSanctionForm('${match.id}')" class="btn btn-warning">⚠️ Demander une Sanction</button>
                    <a href="/panel/matches" class="btn btn-outline">← Retour aux matchs</a>
                </div>
                <!-- Formulaire sanction inline -->
                <div id="sanctionForm" style="display:none;margin-top:1rem;background:var(--bg-tertiary);border-radius:10px;padding:1rem;">
                    <h4 style="margin-bottom:.75rem;">⚠️ Demande de Sanction</h4>
                    <div class="form-group">
                        <label class="form-label">Joueur concerné</label>
                        <select id="sanctionJoueur" class="form-control">
                            <option value="">-- Sélectionner --</option>
                            ${convoqués.map(c => `<option value="${c.username}">${c.username}</option>`).join('')}
                            ${joueurs.filter(j => !convoqués.find(c=>c.username===j.username)).map(j => `<option value="${j.username}">${j.username} (non convoqué)</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Raison</label>
                        <textarea id="sanctionRaison" class="form-control" rows="3" placeholder="Décris le motif de la sanction..."></textarea>
                    </div>
                    <div style="display:flex;gap:.5rem;">
                        <button onclick="envoyerSanction('${match.id}')" class="btn btn-warning" style="flex:1;">Envoyer</button>
                        <button onclick="document.getElementById('sanctionForm').style.display='none'" class="btn btn-outline">Annuler</button>
                    </div>
                    <div id="sanctionResult" style="margin-top:.5rem;"></div>
                </div>
            </div>

            <!-- Info token hôte -->
            <div class="card" style="margin-top:1.5rem;border:1px solid rgba(147,51,234,.3);">
                <h3 style="margin-bottom:.75rem;color:#c084fc;">🔑 Infos Hôte</h3>
                <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:.75rem;">Partagez ce token avec l'hôte du match. Il peut accéder à ce panel via :</p>
                <code style="background:var(--bg-tertiary);padding:.5rem .875rem;border-radius:8px;font-size:.9rem;display:block;margin-bottom:.75rem;">/panel/match-host/${match.token}</code>
                <p style="font-size:.75rem;color:var(--text-muted);">L'hôte aura un rôle Discord temporaire lui permettant de mute/virer les membres dans la voix du match uniquement.</p>
            </div>
        </div>
    </div>

    <script>
    var dirty = false;
    function markDirty() { dirty = true; }
    function updateFormation(v) { markDirty(); }

    async function saveTactique(matchId) {
        var formation = document.getElementById('matchFormation').value;
        var style = document.getElementById('matchStyle').value;
        var r = await fetch('/api/match/' + matchId + '/tactique', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formation, style})});
        var d = await r.json();
        if(d.success) { document.getElementById('compResult').innerHTML='<div class="alert alert-success">✅ Tactique sauvegardée</div>'; setTimeout(()=>document.getElementById('compResult').innerHTML='',2000); }
    }

    async function saveComposition(matchId) {
        var selects = document.querySelectorAll('.poste-select');
        var composition = [];
        selects.forEach(s => {
            if(s.value) {
                var parts = s.value.split('|');
                composition.push({ poste: s.dataset.poste, joueurUsername: parts[0], joueurDiscordId: parts[1]||'' });
            }
        });
        var r = await fetch('/api/match/' + matchId + '/composition', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({composition})});
        var d = await r.json();
        if(d.success) document.getElementById('compResult').innerHTML='<div class="alert alert-success">✅ Composition sauvegardée</div>';
        else document.getElementById('compResult').innerHTML='<div class="alert alert-danger">❌ ' + (d.error||'Erreur') + '</div>';
        setTimeout(()=>document.getElementById('compResult').innerHTML='',3000);
    }

    async function validerEtConvoquer(matchId) {
        var selects = document.querySelectorAll('.poste-select');
        var composition = [];
        selects.forEach(s => {
            if(s.value) {
                var parts = s.value.split('|');
                composition.push({ poste: s.dataset.poste, joueurUsername: parts[0], joueurDiscordId: parts[1]||'' });
            }
        });
        if(composition.length < 1) return document.getElementById('compResult').innerHTML='<div class="alert alert-danger">❌ Sélectionne au moins un joueur</div>';
        document.getElementById('btnConvoquer').disabled = true;
        document.getElementById('btnConvoquer').textContent = '⏳ Envoi des convocations...';
        var r = await fetch('/api/match/' + matchId + '/convoquer', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({composition, formation: document.getElementById('matchFormation').value, style: document.getElementById('matchStyle').value})});
        var d = await r.json();
        document.getElementById('btnConvoquer').disabled = false;
        document.getElementById('btnConvoquer').textContent = '🚀 Valider & Convoquer';
        if(d.success) { document.getElementById('compResult').innerHTML='<div class="alert alert-success">✅ Convocations envoyées ! (' + (d.sent||0) + ' DM Discord)</div>'; setTimeout(()=>location.reload(),2500); }
        else document.getElementById('compResult').innerHTML='<div class="alert alert-danger">❌ ' + (d.error||'Erreur') + '</div>';
    }

    async function faireRemplacement(matchId) {
        var sortant = document.getElementById('replSortant').value;
        var entrantVal = document.getElementById('replEntrant').value;
        if(!sortant || !entrantVal) return document.getElementById('replResult').innerHTML='<div class="alert alert-danger">❌ Sélectionne les deux joueurs</div>';
        var parts = entrantVal.split('|');
        var r = await fetch('/api/match/' + matchId + '/remplacement', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sortant, entrant: parts[0], entrantDiscordId: parts[1]||''})});
        var d = await r.json();
        if(d.success) { document.getElementById('replResult').innerHTML='<div class="alert alert-success">✅ Remplacement effectué</div>'; setTimeout(()=>location.reload(),2500); }
        else document.getElementById('replResult').innerHTML='<div class="alert alert-danger">❌ ' + (d.error||'Erreur') + '</div>';
    }

    function showSanctionForm(matchId) {
        document.getElementById('sanctionForm').style.display = 'block';
    }

    async function envoyerSanction(matchId) {
        var joueur = document.getElementById('sanctionJoueur').value;
        var raison = document.getElementById('sanctionRaison').value.trim();
        if(!joueur || !raison) return document.getElementById('sanctionResult').innerHTML='<div class="alert alert-danger">❌ Champs requis</div>';
        var r = await fetch('/api/match/' + matchId + '/sanction', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({joueur, raison})});
        var d = await r.json();
        if(d.success) { document.getElementById('sanctionResult').innerHTML='<div class="alert alert-success">✅ Demande de sanction envoyée</div>'; document.getElementById('sanctionForm').style.display='none'; }
        else document.getElementById('sanctionResult').innerHTML='<div class="alert alert-danger">❌ ' + (d.error||'Erreur') + '</div>';
    }
    </script>`;

    res.send(panelLayout(user, `Match vs ${match.adversaire}`, content, 'matches'));
});

// ── Panel match hôte (token) ─────────────────────────────────────────
app.get('/panel/match-host/:token', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const match = db.matches.find(m => m.token === req.params.token);
    if (!match) return res.status(404).send(errorPage('Accès refusé', 'Token invalide ou match introuvable.'));

    // Vérification : seul l'hôte désigné ou manager+ peut accéder
    const isHote = match.hoteUsername === user.username;
    const isManager = HIERARCHY[user.role] >= HIERARCHY['manager'];
    if (!isHote && !isManager) return res.status(403).send(errorPage('Accès refusé', 'Ce panel est réservé à l\'hôte du match.'));

    res.redirect('/panel/match/' + match.id);
});

// ── Annulation match ─────────────────────────────────────────────────
app.get('/panel/match/:id/cancel', isAuthenticated, hasRole('manager'), async (req, res) => {
    const db = readDB();
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.redirect('/panel/matches?error=Match introuvable');
    match.status = 'cancelled';
    match.cancelledAt = new Date().toISOString();
    match.cancelledBy = req.session.user.username;
    writeDB(db);
    addLog('❌ Match annulé', req.session.user.username, match.adversaire, { matchId: match.id }, getClientIP(req), getClientInfo(req));

    // Notifier les convoqués
    if (Array.isArray(match.convoqués)) {
        for (const c of match.convoqués) {
            try { await sendDiscordDM(c.discordId, '❌ Match Annulé — FTY Club Pro', `Le match contre **${match.adversaire}** prévu le **${match.date}** a été **annulé**.\n\nPar : ${req.session.user.username}`, '#ef4444'); } catch(e) {}
            addNotification(db, c.username, 'match', '❌ Match annulé', `Le match vs ${match.adversaire} (${match.date}) a été annulé.`, 'high');
        }
        writeDB(db);
    }

    // Supprimer la voc Discord
    try { await callBotAPI('/api/delete-match-voice', 'POST', { apiKey: PANEL_API_KEY, matchId: match.id }); } catch(e) {}

    res.redirect('/panel/match/' + match.id + '?success=Match annulé');
});

// ── API : sauvegarder composition ───────────────────────────────────
app.post('/api/match/:id/composition', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.json({ success: false, error: 'Match introuvable' });
    match.composition = req.body.composition || [];
    writeDB(db);
    res.json({ success: true });
});

// ── API : sauvegarder tactique ───────────────────────────────────────
app.post('/api/match/:id/tactique', isAuthenticated, hasRole('manager'), (req, res) => {
    const db = readDB();
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.json({ success: false, error: 'Match introuvable' });
    match.tactique = { formation: req.body.formation || '4-3-3', style: req.body.style || 'Équilibré', mentality: req.body.mentality || 'Normal' };
    writeDB(db);
    res.json({ success: true });
});

// ── API : valider composition et convoquer les joueurs ───────────────
app.post('/api/match/:id/convoquer', isAuthenticated, hasRole('manager'), async (req, res) => {
    const db = readDB();
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.json({ success: false, error: 'Match introuvable' });

    const { composition, formation, style } = req.body;
    if (!composition || !Array.isArray(composition) || composition.length === 0)
        return res.json({ success: false, error: 'Composition vide' });

    // Sauvegarder
    match.composition = composition;
    if (formation) match.tactique = { ...(match.tactique || {}), formation, style: style || 'Équilibré' };
    match.convoqués = composition.map(c => ({ username: c.joueurUsername, discordId: c.joueurDiscordId || '', poste: c.poste, statut: 'convoqué' }));

    writeDB(db);

    let sent = 0;
    const panelUrl = process.env.PANEL_URL || 'https://fty-club-pro-1.onrender.com';

    // ── DM Discord + notification panel ─────────────────────────────
    for (const c of match.convoqués) {
        // Notification panel
        addNotification(db, c.username, 'convocation', '⚽ Convocation Match !',
            `Tu es convoqué(e) pour le match FTY vs ${match.adversaire} le ${match.date} (${match.competition}) — Poste : ${c.poste || '?'} — Rejoins la voix Discord du match !`,
            'high'
        );
        // DM Discord
        if (c.discordId) {
            try {
                await sendDiscordDM(c.discordId,
                    '⚽ Convocation Officielle — FTY Club Pro',
                    `🏟️ **FTY vs ${match.adversaire}**\n📅 **Date :** ${match.date}\n🏆 **Compétition :** ${match.competition}\n🎯 **Ton poste :** ${c.poste || '?'}\n\n✅ Tu es officellement convoqué(e) ! Rejoins la **voix Discord temporaire** du match dès ta disponibilité.\n\n🔗 Consulte ton panel joueur : ${panelUrl}/panel/dashboard`,
                    '#22c55e'
                );
                sent++;
            } catch(e) {}
        }
    }
    writeDB(db);

    // ── Attribuer rôle temporaire Discord + voix du match via bot ───
    const hoteUser = db.users.find(u => u.username === match.hoteUsername);
    try {
        await callBotAPI('/api/match-assign-roles', 'POST', {
            apiKey: PANEL_API_KEY,
            matchId: match.id,
            convoqués: match.convoqués,
            hoteUsername: match.hoteUsername,
            hoteDiscordId: hoteUser?.discordId || null,
            adversaire: match.adversaire,
            date: match.date
        });
    } catch(e) { console.warn('[MATCH] Assign roles failed:', e.message); }

    addLog('⚽ Convocations envoyées', req.session.user.username, match.adversaire, { count: sent, matchId: match.id }, '');
    res.json({ success: true, sent });
});

// ── API : remplacement joueur ────────────────────────────────────────
app.post('/api/match/:id/remplacement', isAuthenticated, hasRole('manager'), async (req, res) => {
    const db = readDB();
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.json({ success: false, error: 'Match introuvable' });

    const { sortant, entrant, entrantDiscordId } = req.body;
    if (!sortant || !entrant) return res.json({ success: false, error: 'Joueurs manquants' });

    const idx = (match.convoqués || []).findIndex(c => c.username === sortant);
    if (idx === -1) return res.json({ success: false, error: 'Joueur sortant non trouvé' });

    const poste = match.convoqués[idx].poste;
    const sortantDiscordId = match.convoqués[idx].discordId;

    // Update composition
    match.convoqués[idx] = { username: entrant, discordId: entrantDiscordId || '', poste, statut: 'remplaçant_entrant' };
    if (!match.remplaçants) match.remplaçants = [];
    match.remplaçants.push({ sortant, entrant, poste, at: new Date().toISOString() });

    // Update composition array aussi
    if (Array.isArray(match.composition)) {
        const compIdx = match.composition.findIndex(c => c.joueurUsername === sortant && c.poste === poste);
        if (compIdx !== -1) { match.composition[compIdx].joueurUsername = entrant; match.composition[compIdx].joueurDiscordId = entrantDiscordId || ''; }
    }

    writeDB(db);

    // DM sortant
    if (sortantDiscordId) { try { await sendDiscordDM(sortantDiscordId, '🔄 Remplacement — FTY Club Pro', `Tu as été remplacé(e) par **${entrant}** au poste de **${poste}** pour le match vs ${match.adversaire}.`, '#f59e0b'); } catch(e) {} }
    // DM entrant
    if (entrantDiscordId) { try { await sendDiscordDM(entrantDiscordId, '⚽ Convocation Remplacement — FTY Club Pro', `Tu rentres en jeu à la place de **${sortant}** (poste : **${poste}**) pour le match FTY vs **${match.adversaire}** le ${match.date} !\nRejoins la voix Discord du match.`, '#22c55e'); } catch(e) {} }

    // Notifs panel
    addNotification(db, sortant, 'match', '🔄 Remplacé', `Tu as été remplacé(e) par ${entrant} au poste ${poste} (vs ${match.adversaire}).`, 'normal');
    addNotification(db, entrant, 'convocation', '⚽ Tu entres en jeu !', `Tu remplaces ${sortant} au poste ${poste} pour le match vs ${match.adversaire}.`, 'high');
    writeDB(db);

    // Update rôles Discord
    try { await callBotAPI('/api/match-replace', 'POST', { apiKey: PANEL_API_KEY, matchId: match.id, sortant, sortantDiscordId, entrant, entrantDiscordId }); } catch(e) {}

    res.json({ success: true });
});

// ── API : demande de sanction ────────────────────────────────────────
app.post('/api/match/:id/sanction', isAuthenticated, hasRole('manager'), async (req, res) => {
    const db = readDB();
    const match = db.matches.find(m => m.id === req.params.id);
    if (!match) return res.json({ success: false, error: 'Match introuvable' });

    const { joueur, raison } = req.body;
    if (!joueur || !raison) return res.json({ success: false, error: 'Champs requis' });

    if (!match.sanctionRequests) match.sanctionRequests = [];
    match.sanctionRequests.push({ joueur, raison, by: req.session.user.username, at: new Date().toISOString(), status: 'pending' });
    writeDB(db);

    // Notifier les admins+
    db.users.filter(u => HIERARCHY[u.role] >= HIERARCHY['administrateur'] && !u.banned && !u.suspended).forEach(u => {
        addNotification(db, u.username, 'sanction', '⚠️ Demande de sanction', `Match vs ${match.adversaire} : Sanction demandée contre ${joueur} — ${raison.substring(0, 80)}`, 'high');
    });
    writeDB(db);

    addLog('⚠️ Demande sanction match', req.session.user.username, joueur, { matchId: match.id, raison }, getClientIP(req), getClientInfo(req));
    res.json({ success: true });
});

// ── Vue panel joueur : mes convocations ──────────────────────────────
app.get('/panel/mes-convocations', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const mesMatchs = (db.matches || []).filter(m =>
        Array.isArray(m.convoqués) && m.convoqués.find(c => c.username === user.username)
    );
    const content = `
    <div class="page-header">
        <div><div class="page-title">⚽ Mes <span>Convocations</span></div>
        <div class="page-breadcrumb">${mesMatchs.length} match(s) planifié(s)</div></div>
    </div>
    ${mesMatchs.length === 0 ? `<div class="card" style="text-align:center;padding:3rem;"><div style="font-size:3rem;margin-bottom:1rem;">⚽</div><p style="color:var(--text-muted);">Aucune convocation pour l\'instant.</p></div>` :
    mesMatchs.map(m => {
        const maConvoc = m.convoqués.find(c => c.username === user.username);
        return `<div class="card" style="margin-bottom:1rem;border-left:4px solid ${m.status==='cancelled'?'#ef4444':'var(--primary)'};">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.75rem;">
                <div>
                    <div style="font-size:1.1rem;font-weight:700;">⚽ FTY vs ${m.adversaire}</div>
                    <div style="font-size:.85rem;color:var(--text-muted);margin-top:.25rem;">📅 ${m.date} · 🏆 ${m.competition} · 📍 ${m.stadium||'FTY Arena'}</div>
                    <div style="margin-top:.5rem;"><span style="background:rgba(147,51,234,.2);color:#c084fc;border-radius:20px;padding:.2rem .75rem;font-size:.8rem;">🎯 ${maConvoc.poste||'?'}</span></div>
                </div>
                <span style="background:${m.status==='cancelled'?'rgba(239,68,68,.2)':'rgba(34,197,94,.15)'};color:${m.status==='cancelled'?'#fca5a5':'#6ee7b7'};border-radius:8px;padding:.35rem .875rem;font-size:.8rem;height:fit-content;">${m.status==='cancelled'?'❌ Annulé':'✅ Convoqué'}</span>
            </div>
        </div>`;
    }).join('')}`;
    res.send(panelLayout(user, 'Mes Convocations', content, 'mes-convocations'));
});

// ════════════════════════════════════════════════════════════════════
// §18 — PANEL : OWNER (Système, IP Manager, Thèmes, Paramètres publics)
// ════════════════════════════════════════════════════════════════════
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

// ── Gestion des owners (xywez uniquement) ───────────────────────────
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

// ── Créer un owner ──────────────────────────────────────────────────
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

// ── API créer owner ─────────────────────────────────────────────────
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

// ── Modifier un owner ───────────────────────────────────────────────
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

// ── API modifier owner ──────────────────────────────────────────────
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

// ── Supprimer un owner ──────────────────────────────────────────────
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


// ── Changement de mot de passe ──────────────────────────────────────
app.get('/panel/change-password', isAuthenticated, (req, res) => {
    const user = req.session.user;
    const forced = req.query.forced === '1';
    const content = `
    <div style="max-width:500px;margin:0 auto;">
        <div class="page-header"><div>
            <div class="page-title">🔑 <span>Changer le mot de passe</span></div>
            ${forced ? '<div class="page-breadcrumb" style="color:#f59e0b;">⚠️ Changement obligatoire avant d\'accéder au panel</div>' : '<div class="page-breadcrumb">Sécurité du compte</div>'}
        </div></div>
        ${req.query.error ? '<div class="alert alert-danger">❌ ' + decodeURIComponent(req.query.error) + '</div>' : ''}
        ${req.query.success ? '<div class="alert alert-success">✅ ' + decodeURIComponent(req.query.success) + '</div>' : ''}
        <div class="card">
            <form method="POST" action="/panel/change-password">
                ${forced ? '<div style="color:var(--text-secondary);margin-bottom:1.5rem;padding:.875rem 1rem;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;font-size:.9rem;line-height:1.6;">🔒 Ton mot de passe a été réinitialisé par un admin.<br>Saisis ton <strong>mot de passe provisoire reçu par DM Discord</strong> dans le premier champ, puis choisis un nouveau mot de passe.</div>' : ''}
                <div class="form-group">
                    <label class="form-label">${forced ? '📩 Mot de passe provisoire (reçu par DM)' : 'Mot de passe actuel'}</label>
                    <input type="password" name="currentPassword" class="form-control" required autocomplete="current-password" placeholder="${forced ? 'Colle ton mot de passe provisoire ici' : ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Nouveau mot de passe</label>
                    <input type="password" name="newPassword" class="form-control" required minlength="8" autocomplete="new-password" placeholder="Minimum 8 caractères">
                </div>
                <div class="form-group">
                    <label class="form-label">Confirmer le nouveau mot de passe</label>
                    <input type="password" name="confirmPassword" class="form-control" required autocomplete="new-password" placeholder="Répétez le mot de passe">
                </div>
                <input type="hidden" name="forced" value="${forced ? '1' : '0'}">
                <div style="display:flex;gap:.75rem;margin-top:1.5rem;">
                    <button type="submit" class="btn btn-primary">💾 Changer le mot de passe</button>
                    ${!forced ? '<a href="/panel/profile" class="btn btn-outline">Annuler</a>' : ''}
                </div>
            </form>
        </div>
    </div>`;
    res.send(panelLayout(user, 'Changer Mot de Passe', content, 'profile'));
});

app.post('/panel/change-password', isAuthenticated, (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const user = req.session.user;
    const db = readDB();
    const dbUser = db.users.find(u => u.username === user.username);

    if (!dbUser) return res.redirect('/panel/change-password?error=' + encodeURIComponent('Utilisateur introuvable'));
    if (!comparePassword(currentPassword, dbUser.password))
        return res.redirect('/panel/change-password?error=' + encodeURIComponent('Mot de passe actuel incorrect'));
    if (newPassword.length < 8)
        return res.redirect('/panel/change-password?error=' + encodeURIComponent('Le nouveau mot de passe doit faire au moins 8 caractères'));
    if (newPassword !== confirmPassword)
        return res.redirect('/panel/change-password?error=' + encodeURIComponent('Les mots de passe ne correspondent pas'));

    dbUser.password = hashPassword(newPassword);
    dbUser.mustChangePassword = false;
    writeDB(db);

    req.session.user.mustChangePassword = false;
    req.session.save(() => {
        addLog('🔑 Mot de passe changé', user.username, user.username, {}, getClientIP(req), getClientInfo(req));
        res.redirect('/panel/dashboard?success=' + encodeURIComponent('✅ Mot de passe changé avec succès !'));
    });
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

// ── Initialisation DB & démarrage ───────────────────────────────────
initDB();


// ════════════════════════════════════════════════════════════════════
// §13 — PANEL : CAPITAINE (Composition, Tactique, Joueurs)
// ════════════════════════════════════════════════════════════════════
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




// ════════════════════════════════════════════════════════════════════
// §20 — API DIVERSES & PAGES PUBLIQUES COMPLÉMENTAIRES
//       (chatbot, guide, boutique, partenaires, contact, palmares...)
// ════════════════════════════════════════════════════════════════════

// ── API : Log des tentatives de screenshot / capture ─────────────────
// Reçoit les rapports du client-side anti-screenshot system
app.post('/api/screenshot-attempt', isAuthenticated, (req, res) => {
    const { reason, ts } = req.body || {};
    const user = req.session.user;
    const ip   = getClientIP(req);
    const ci   = getClientInfo(req);
    // Log dans la base (même système que les autres logs)
    addLog('📸 Tentative Capture Écran', user.username, reason || 'unknown', {
        reason: reason || 'inconnu',
        userAgent: req.headers['user-agent'] || '',
        clientTs: ts || ''
    }, ip, ci);
    res.json({ received: true });
});

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
<a href="/panel/login" class="btn">Retour</a></div>





</body></html>`);
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
<a href="/panel/login" class="btn">Retour</a></div>





</body></html>`);
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
<a href="/panel/login" class="btn">Retour à la connexion</a></div>





</body></html>`);
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
    const db = readDB();
    const siteTheme = db.publicSettings?.siteTheme || 'dark';
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
    `, siteTheme));
});

app.get('/partenaires', (req, res) => {
    const db = readDB();
    const siteTheme = db.publicSettings?.siteTheme || 'dark';
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
    `, siteTheme));
});

app.get('/contact', (req, res) => {
    const db = readDB();
    const siteTheme = db.publicSettings?.siteTheme || 'dark';
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
    `, siteTheme));
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
<a href="/" class="btn">Retour à l'accueil</a></div>





</body></html>`);
});

// ════════════════════════════════════════════════════════════════════
// §19 — PANEL : NOTIFICATIONS, MESSAGERIE & BROADCAST STAFF
// ════════════════════════════════════════════════════════════════════
// ── Polling notifications (push JS) ─────────────────────────────────
app.get('/api/notifications/poll', isAuthenticated, (req, res) => {
    const db = readDB();
    const u = req.session.user.username;
    const notifs = (db.notifications || []).filter(n => n.targetUsername === u && !n.read).length;
    const msgs = (db.messages || []).filter(m => m.to === u && !m.read).length;
    res.json({ notifs, msgs });
});

// ── Page Notifications ──────────────────────────────────────────────
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

// ── Messagerie interne ───────────────────────────────────────────────
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
    <div style="display:grid;grid-template-columns:280px 1fr;gap:1.5rem;min-height:500px;" class="msg-layout">
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

// ── Notes / Pense-bête ──────────────────────────────────────────────
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

// ── Owners : suspension / réactivation ─────────────────────────────
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

// ── Gestion IPs bloquées ─────────────────────────────────────────────
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



// ── Recherche utilisateur / panel ───────────────────────────────────
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



// ── Gestion bot Discord (xywez) ─────────────────────────────────────
app.get('/panel/bot', isAuthenticated, (req, res) => {
    const user = req.session.user;
    if (user.username !== 'xywez' && user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.status(403).send(errorPage('Accès Refusé', 'Page réservée à Xywez uniquement.'));
    }
    const up = botStatus.isReady ? Date.now() - (botStatus.uptime || Date.now()) : 0;
    const days = Math.floor(up / 86400000);
    const hours = Math.floor((up % 86400000) / 3600000);
    const minutes = Math.floor((up % 3600000) / 60000);
    const db = readDB();
    const serverCfg = db.serverConfig || {};
    const logs = (botStatus.logs || []).slice(0, 200);
    const logStats = { info: 0, warn: 0, error: 0, success: 0, discord: 0 };
    logs.forEach(l => { if (logStats[l.level] !== undefined) logStats[l.level]++; });

    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🤖 Bot Discord <span>FTY Club Pro</span></div>
            <div class="page-breadcrumb">Panel de contrôle total — Réservé Xywez</div>
        </div>
        <div style="display:flex;gap:.75rem;align-items:center;">
            <span style="padding:.5rem 1rem;background:${botStatus.isReady?'#22c55e20':'#ef444420'};color:${botStatus.isReady?'#22c55e':'#ef4444'};border-radius:8px;font-weight:700;">${botStatus.isReady?'🟢 En ligne':'🔴 Hors ligne'}</span>
            <a href="/panel/bot" class="btn btn-outline" style="font-size:.85rem;">🔄 Actualiser</a>
        </div>
    </div>
    ${req.query.success ? `<div class="alert alert-success">✅ ${decodeURIComponent(req.query.success)}</div>` : ''}
    ${req.query.error ? `<div class="alert alert-danger">❌ ${decodeURIComponent(req.query.error)}</div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1.5rem;">
        ${[
            {icon:'🎮',label:'Serveurs',value:botStatus.guilds||0,color:'#a855f7'},
            {icon:'👥',label:'Membres',value:botStatus.members||0,color:'#ec4899'},
            {icon:'⏱️',label:'Uptime',value:`${days}j ${hours}h ${minutes}m`,color:'#f59e0b'},
            {icon:'🌐',label:'Panel',value:botStatus.panelConnected?'Connecté':'Déco',color:botStatus.panelConnected?'#22c55e':'#ef4444'},
            {icon:'🎫',label:'Tickets ouverts',value:botStatus.ticketsOpen||0,color:'#9333ea'},
            {icon:'📝',label:'Logs',value:(botStatus.logs||[]).length+'/1000',color:'#6b7280'}
        ].map(s=>`<div class="card" style="text-align:center;padding:1rem;">
            <div style="font-size:1.5rem;">${s.icon}</div>
            <div style="font-size:1.2rem;font-weight:700;color:${s.color};">${s.value}</div>
            <div style="font-size:.75rem;color:var(--text-muted);">${s.label}</div>
        </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
        <div class="card">
            <h3 style="margin-bottom:1rem;">🎮 Statut & Activité</h3>
            <form method="POST" action="/panel/bot/status">
                <div class="form-group">
                    <label class="form-label">Statut</label>
                    <select name="status" class="form-control">
                        <option value="online" ${botStatus.status==='online'?'selected':''}>🟢 En ligne</option>
                        <option value="idle" ${botStatus.status==='idle'?'selected':''}>🟡 Inactif</option>
                        <option value="dnd" ${botStatus.status==='dnd'?'selected':''}>🔴 Ne pas déranger</option>
                        <option value="invisible" ${botStatus.status==='invisible'?'selected':''}>⚫ Invisible</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Activité</label>
                    <input type="text" name="activity" class="form-control" value="${botStatus.activity?.name||'FTY Club Pro | /site'}">
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <select name="activityType" class="form-control">
                        <option value="0" ${botStatus.activity?.type===0?'selected':''}>🎮 Joue à</option>
                        <option value="2" ${botStatus.activity?.type===2?'selected':''}>🎵 Écoute</option>
                        <option value="3" ${botStatus.activity?.type===3?'selected':''}>📺 Regarde</option>
                        <option value="5" ${botStatus.activity?.type===5?'selected':''}>🏆 En compétition</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-primary">💾 Mettre à jour</button>
            </form>
        </div>
        <div class="card">
            <h3 style="margin-bottom:1rem;">⚙️ Systèmes de Protection</h3>
            <div style="margin-bottom:.75rem;">
                <span style="padding:.25rem .75rem;background:${serverCfg.configured?'#22c55e20':'#ef444420'};color:${serverCfg.configured?'#22c55e':'#ef4444'};border-radius:8px;font-size:.85rem;font-weight:700;">
                    ${serverCfg.configured?'✅ Serveur configuré':'❌ Non configuré — Lance /setup sur Discord'}
                </span>
            </div>
            <div style="display:flex;flex-direction:column;gap:.5rem;margin-top:1rem;">
                ${[
                    {label:'🛡️ Anti-Raid',key:'antiRaid',val:serverCfg.antiRaid?.enabled},
                    {label:'🔗 Anti-Link',key:'antiLink',val:serverCfg.antiLink?.enabled},
                    {label:'👥 Anti-Double Compte',key:'antiDouble',val:serverCfg.antiDouble?.enabled}
                ].map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem;background:var(--bg-tertiary);border-radius:8px;">
                    <span style="font-size:.875rem;">${s.label}</span>
                    <form method="POST" action="/panel/bot/toggle-system" style="display:inline;">
                        <input type="hidden" name="system" value="${s.key}">
                        <input type="hidden" name="enabled" value="${s.val?'0':'1'}">
                        <button type="submit" class="btn btn-sm" style="background:${s.val?'#22c55e20':'#ef444420'};color:${s.val?'#22c55e':'#ef4444'};">${s.val?'✅ Actif':'❌ Inactif'}</button>
                    </form>
                </div>`).join('')}
            </div>
        </div>
    </div>

    <div class="card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;">⌨️ Commandes Slash</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem;">
            ${[
                {cmd:'/site',desc:'Lien du site',access:'Tous'},
                {cmd:'/status',desc:'Stats du bot',access:'Xywez uniquement'},
                {cmd:'/setup',desc:'Configure salons, rôles, systèmes',access:'Xywez uniquement'},
                {cmd:'/ticket',desc:'Ouvre un ticket support en DM',access:'Tous les membres'}
            ].map(c=>`<div style="padding:1rem;background:var(--bg-tertiary);border-radius:8px;border-left:4px solid var(--primary);">
                <div style="font-weight:700;color:var(--primary);">${c.cmd}</div>
                <div style="font-size:.8rem;color:var(--text-secondary);margin:.2rem 0;">${c.desc}</div>
                <div style="font-size:.75rem;color:var(--text-muted);">👤 ${c.access}</div>
            </div>`).join('')}
        </div>
    </div>

    <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;">
            <h3>📊 Logs Profonds du Bot (${logs.length})</h3>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
                ${Object.entries(logStats).map(([lvl,cnt])=>{
                    const c={info:'#3b82f6',warn:'#f59e0b',error:'#ef4444',success:'#22c55e',discord:'#5865f2'}[lvl]||'#888';
                    return `<span style="padding:.2rem .6rem;background:${c}20;color:${c};border-radius:6px;font-size:.75rem;font-weight:700;">${lvl}:${cnt}</span>`;
                }).join('')}
                <a href="/panel/bot/clear-logs" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" onclick="return confirm('Effacer tous les logs ?')">🗑️ Vider</a>
            </div>
        </div>
        <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;">
            <button onclick="filterLogs('all')" class="btn btn-sm btn-primary">Tous</button>
            <button onclick="filterLogs('error')" class="btn btn-sm" style="background:#ef444420;color:#ef4444;">❌ Erreurs</button>
            <button onclick="filterLogs('warn')" class="btn btn-sm" style="background:#f59e0b20;color:#f59e0b;">⚠️ Warnings</button>
            <button onclick="filterLogs('success')" class="btn btn-sm" style="background:#22c55e20;color:#22c55e;">✅ Succès</button>
            <button onclick="filterLogs('discord')" class="btn btn-sm" style="background:#5865f220;color:#5865f2;">🎮 Discord</button>
            <button onclick="filterLogs('info')" class="btn btn-sm" style="background:#3b82f620;color:#3b82f6;">ℹ️ Info</button>
        </div>
        <div id="logs-container" style="max-height:500px;overflow-y:auto;font-family:monospace;">
            ${logs.length===0?'<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun log.</p>':
            logs.map(log=>{
                const c={info:'#3b82f6',warn:'#f59e0b',error:'#ef4444',success:'#22c55e',discord:'#5865f2'}[log.level]||'#888';
                const ic={info:'ℹ️',warn:'⚠️',error:'❌',success:'✅',discord:'🎮'}[log.level]||'•';
                return `<div class="log-entry" data-level="${log.level||'info'}" style="padding:.5rem .75rem;background:var(--bg-hover);border-radius:6px;margin-bottom:.3rem;border-left:3px solid ${c};font-size:.8rem;">
                    <span style="color:var(--text-muted);font-size:.7rem;">${new Date(log.timestamp).toLocaleString('fr-FR')}</span>
                    <span style="margin:0 .4rem;color:${c};">${ic}</span>
                    <span>${log.message}</span>
                </div>`;
            }).join('')}
        </div>
    </div>
    <script>
    function filterLogs(level) {
        document.querySelectorAll('.log-entry').forEach(e=>{
            e.style.display=(level==='all'||e.dataset.level===level)?'':'none';
        });
    }
    </script>
    `;
    res.send(panelLayout(user, 'Bot Discord', content, 'bot'));
});

app.post('/panel/bot/status', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    if (user.username !== 'xywez' && user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.redirect('/panel/bot?error=' + encodeURIComponent('Accès refusé'));
    }
    const { status, activity, activityType } = req.body;
    const result = await callBotAPI('/api/update-status', 'POST', { apiKey: PANEL_API_KEY, status, activity, activityType: parseInt(activityType) });
    if (result && result.success) {
        botStatus = result.botStatus || botStatus;
        addLog('🤖 Statut bot modifié', user.username, `${status} - ${activity}`, {}, getClientIP(req), getClientInfo(req));
        res.redirect('/panel/bot?success=' + encodeURIComponent('Statut mis à jour'));
    } else {
        res.redirect('/panel/bot?error=' + encodeURIComponent('Erreur: bot hors ligne ou clé invalide'));
    }
});

app.post('/panel/bot/toggle-system', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    if (user.username !== 'xywez' && user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.redirect('/panel/bot?error=' + encodeURIComponent('Accès refusé'));
    }
    const { system, enabled } = req.body;
    const isEnabled = enabled === '1';
    const currentCfg = await callBotAPI('/api/server-config', 'GET', null);
    if (currentCfg) {
        const patch = {};
        if (system === 'antiRaid') patch.antiRaid = { ...(currentCfg.antiRaid||{}), enabled: isEnabled };
        if (system === 'antiLink') patch.antiLink = { ...(currentCfg.antiLink||{}), enabled: isEnabled };
        if (system === 'antiDouble') patch.antiDouble = { ...(currentCfg.antiDouble||{}), enabled: isEnabled };
        await callBotAPI('/api/server-config', 'POST', { apiKey: PANEL_API_KEY, config: patch });
        const db = readDB();
        if (!db.serverConfig) db.serverConfig = {};
        Object.assign(db.serverConfig, patch);
        writeDB(db);
    }
    addLog(`⚙️ Système ${system} ${isEnabled?'activé':'désactivé'}`, user.username, system, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/bot?success=' + encodeURIComponent(`${system} ${isEnabled?'activé':'désactivé'}`));
});

app.get('/panel/bot/clear-logs', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    if (user.username !== 'xywez' && user.discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.redirect('/panel/bot?error=' + encodeURIComponent('Accès refusé'));
    }
    await callBotAPI('/api/bot', 'POST', { apiKey: PANEL_API_KEY, action: 'clearLogs', data: { onlyOwner: true } });
    botStatus.logs = [];
    addLog('🗑️ Logs bot effacés', user.username, 'bot', {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/bot?success=' + encodeURIComponent('Logs effacés'));
});




// Reset mot de passe avec notification Discord
app.get('/panel/users/:username/reset-password', isAuthenticated, async (req, res) => {
    const user = req.session.user;
    const targetUsername = req.params.username;
    
    const db = readDB();
    const targetUser = db.users.find(u => u.username === targetUsername);
    
    if (!targetUser) return res.redirect('/panel/users?error=Utilisateur introuvable');
    if (targetUsername === 'xywez' && user.username !== 'xywez') return res.redirect('/panel/users?error=Impossible de réinitialiser le mot de passe de Xywez');
    if (user.username !== 'xywez' && HIERARCHY[user.role] <= HIERARCHY[targetUser.role || 'joueur']) {
        return res.redirect('/panel/users?error=Vous ne pouvez pas réinitialiser le mot de passe d\'un compte de rang égal ou supérieur');
    }
    
    const newPassword = generateTempPassword();
    targetUser.password = hashPassword(newPassword);
    targetUser.mustChangePassword = true;
    targetUser.passwordResetAt = new Date().toISOString();
    targetUser.passwordResetBy = user.username;
    writeDB(db);
    
    let dmSent = false;
    if (targetUser.discordId) {
        try {
            await sendDiscordDM(
                targetUser.discordId,
                '🔑 Mot de Passe Réinitialisé — FTY Club Pro',
                `**Ton mot de passe panel a été réinitialisé par ${user.username}.**\n\n` +
                `🔐 **Nouveau mot de passe provisoire :**\n\`\`\`\n${newPassword}\n\`\`\`\n` +
                `🔗 **Connexion :** https://fty-club-pro-1.onrender.com/panel/login\n\n` +
                `⚠️ Tu devras **changer ce mot de passe** dès ta première connexion.\n` +
                `Ne partage jamais ce message.`,
                '#f59e0b'
            );
            dmSent = true;
        } catch(e) {}
    }
    
    addLog('🔑 MDP réinitialisé', user.username, targetUsername, { dmSent }, getClientIP(req), getClientInfo(req));
    
    if (dmSent) {
        res.redirect(`/panel/users?success=✅ Mot de passe de ${targetUsername} réinitialisé — DM Discord envoyé`);
    } else if (targetUser.discordId) {
        res.redirect(`/panel/users?success=✅ MDP réinitialisé — Échec DM (Discord non disponible) — Provisoire: ${newPassword}`);
    } else {
        res.redirect(`/panel/users?success=✅ MDP réinitialisé (pas de Discord lié) — Provisoire: ${newPassword}`);
    }
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
// ════════════════════════════════════════════════════════════════════
// §15 — PANEL : SUPPORT (Tickets DM, Reset MDP, Demandes)
// ════════════════════════════════════════════════════════════════════
app.get('/panel/tickets', isAuthenticated, hasRole('support'), async (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const botTickets = await callBotAPI('/api/tickets', 'GET', null);
    let tickets = [];
    if (botTickets && botTickets.tickets) {
        tickets = botTickets.tickets;
        const localTickets = db.dmTickets || [];
        const botIds = new Set(tickets.map(t => t.id));
        localTickets.forEach(lt => { if (!botIds.has(lt.id)) tickets.push(lt); });
    } else {
        tickets = db.dmTickets || [];
    }
    tickets = tickets.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const open = tickets.filter(t => t.status !== 'closed').length;
    const claimed = tickets.filter(t => t.claimedBy).length;
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🎫 Gestion des <span>Tickets</span></div>
            <div class="page-breadcrumb">${open} ouvert(s) · ${claimed} pris en charge · ${tickets.length} total</div>
        </div>
        <a href="/panel/tickets" class="btn btn-outline">🔄 Actualiser</a>
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
                    <small style="color:var(--text-muted);">Clic droit → Copier ID</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Sujet *</label>
                    <input type="text" name="sujet" class="form-control" required placeholder="Avertissement, Convocation, Info...">
                </div>
                <div class="form-group" style="grid-column:1/-1;">
                    <label class="form-label">Message *</label>
                    <textarea name="message" class="form-control" rows="4" required placeholder="Contenu envoyé en DM Discord..."></textarea>
                </div>
                <div style="grid-column:1/-1;display:flex;gap:.75rem;align-items:center;">
                    <button type="submit" class="btn btn-primary">📨 Envoyer le DM</button>
                    <span style="color:var(--text-muted);font-size:.85rem;">Le membre reçoit un embed Discord en DM</span>
                </div>
            </div>
        </form>
    </div>

    <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;">
            <h3>📋 Tickets (${tickets.length})</h3>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                <span style="padding:.25rem .75rem;background:#22c55e20;color:#22c55e;border-radius:8px;font-size:.8rem;font-weight:700;">${open} ouvert(s)</span>
                <span style="padding:.25rem .75rem;background:#3b82f620;color:#3b82f6;border-radius:8px;font-size:.8rem;">${claimed} pris</span>
                <span style="padding:.25rem .75rem;background:var(--bg-tertiary);color:var(--text-muted);border-radius:8px;font-size:.8rem;">${tickets.filter(t=>t.status==='closed').length} fermé(s)</span>
            </div>
        </div>
        ${tickets.length===0?'<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun ticket pour le moment.</p>':
        '<div style="display:flex;flex-direction:column;gap:.75rem;">'+tickets.map(t=>{
            const isOpen=t.status!=='closed';
            const isClaimed=!!t.claimedBy;
            const border=!isOpen?'var(--text-muted)':isClaimed?'#3b82f6':'var(--primary)';
            const msgs=(t.messages||[]).length;
            return `<div style="padding:1rem;background:var(--bg-tertiary);border-radius:10px;border-left:4px solid ${border};">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.5rem;gap:1rem;">
                    <div style="flex:1;">
                        <strong>${t.sujet||t.subject||'Sans sujet'}</strong>
                        <span style="margin-left:.5rem;padding:.1rem .4rem;background:${!isOpen?'#ef444420':'#22c55e20'};color:${!isOpen?'#ef4444':'#22c55e'};border-radius:5px;font-size:.7rem;font-weight:700;">${!isOpen?'Fermé':'Ouvert'}</span>
                        ${isClaimed?`<span style="margin-left:.5rem;padding:.1rem .4rem;background:#3b82f620;color:#3b82f6;border-radius:5px;font-size:.7rem;">✋ ${t.claimedBy}</span>`:''}
                        ${msgs>0?`<span style="margin-left:.5rem;font-size:.7rem;color:var(--text-muted);">💬 ${msgs}</span>`:''}
                    </div>
                    <span style="font-size:.75rem;color:var(--text-muted);white-space:nowrap;">${new Date(t.createdAt).toLocaleString('fr-FR')}</span>
                </div>
                <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem;">
                    👤 <code>${t.userTag||t.discordId||'N/A'}</code> · ID: <code>${t.discordId||'?'}</code> · Par: <strong>${t.sentBy||'Discord'}</strong>
                </div>
                ${t.message?`<p style="color:var(--text-secondary);font-size:.875rem;margin:.25rem 0 .5rem;">${(t.message||'').substring(0,200)}${(t.message||'').length>200?'...':''}</p>`:''}
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem;">
                    ${isOpen&&!isClaimed&&t.discordId?`<a href="/panel/tickets/${t.id}/claim" class="btn btn-sm" style="background:#3b82f620;color:#3b82f6;">✋ Prendre en charge</a>`:''}
                    ${t.discordId?`<a href="/panel/tickets/reply/${t.id}" class="btn btn-sm btn-outline">💬 Répondre</a>`:''}
                    ${isOpen?`<a href="/panel/tickets/${t.id}/close" class="btn btn-sm" style="background:#ef444420;color:#ef4444;" onclick="return confirm('Fermer ce ticket ?')">🔒 Fermer</a>`:''}
                    ${msgs>0?`<a href="/panel/tickets/${t.id}/history" class="btn btn-sm" style="background:#a855f720;color:#a855f7;">📜 Historique (${msgs})</a>`:''}
                </div>
            </div>`;
        }).join('')+'</div>'}
    </div>`;
    res.send(panelLayout(user,'Tickets',content,'tickets'));
});

app.post('/panel/tickets/send', isAuthenticated, hasRole('support'), async (req, res) => {
    const { discordId, sujet, message } = req.body;
    const user = req.session.user;
    if (!discordId||!sujet||!message) return res.redirect('/panel/tickets?error='+encodeURIComponent('Tous les champs sont requis'));
    const db = readDB();
    const ticket = { id:'t_'+Date.now(), discordId, sujet, message, userTag:discordId, sentBy:user.username, status:'open', createdAt:new Date().toISOString(), messages:[{from:'staff',author:user.username,content:message,timestamp:new Date().toISOString()}], claimedBy:null };
    if (!Array.isArray(db.dmTickets)) db.dmTickets=[];
    db.dmTickets.unshift(ticket);
    writeDB(db);
    const botOk = await callBotAPI('/api/ticket','POST',{ apiKey:PANEL_API_KEY, discordId, sujet, staffMessage:message, staffName:user.username, ticketId:ticket.id });
    addLog('🎫 Ticket DM envoyé', user.username, discordId, { sujet }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/tickets?success='+encodeURIComponent('Ticket envoyé'+(botOk?.success?' ✓ DM envoyé':' (bot hors ligne - enregistré)')));
});

app.get('/panel/tickets/:id/claim', isAuthenticated, hasRole('support'), async (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (t) {
        t.claimedBy = user.username;
        t.claimedAt = new Date().toISOString();
        writeDB(db);
        await callBotAPI('/api/ticket','POST',{ apiKey:PANEL_API_KEY, discordId:t.discordId, action:'claim', ticketId:t.id, staffName:user.username });
    }
    addLog('✋ Ticket pris en charge', user.username, req.params.id, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/tickets?success='+encodeURIComponent('Ticket pris en charge'));
});

app.get('/panel/tickets/:id/close', isAuthenticated, hasRole('support'), async (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (t) {
        t.status='closed'; t.closedAt=new Date().toISOString(); t.closedBy=user.username;
        writeDB(db);
        await callBotAPI('/api/ticket','POST',{ apiKey:PANEL_API_KEY, discordId:t.discordId, action:'close', ticketId:t.id, staffName:user.username });
    }
    addLog('🔒 Ticket fermé', user.username, req.params.id, {}, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/tickets?success='+encodeURIComponent('Ticket fermé'));
});

app.get('/panel/tickets/reply/:id', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (!t) return res.redirect('/panel/tickets?error='+encodeURIComponent('Ticket introuvable'));
    const msgs = t.messages||[];
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">💬 Répondre — <span>${t.sujet||'Ticket'}</span></div>
            <div class="page-breadcrumb">Discord: ${t.userTag||t.discordId} ${t.claimedBy?'· ✋ Pris par '+t.claimedBy:''}</div>
        </div>
        <a href="/panel/tickets" class="btn btn-outline">← Retour</a>
    </div>
    <div style="display:grid;grid-template-columns:1fr 300px;gap:1.5rem;">
        <div>
            <div class="card" style="margin-bottom:1rem;">
                <h3 style="margin-bottom:1rem;">💬 Historique (${msgs.length})</h3>
                <div style="max-height:350px;overflow-y:auto;display:flex;flex-direction:column;gap:.6rem;">
                    ${msgs.length===0?'<p style="color:var(--text-muted);text-align:center;">Aucun message.</p>':
                    msgs.map(m=>`<div style="padding:.75rem;background:${m.from==='staff'?'var(--bg-tertiary)':'rgba(147,51,234,0.1)'};border-radius:8px;border-left:3px solid ${m.from==='staff'?'var(--primary)':'#22c55e'};">
                        <div style="display:flex;justify-content:space-between;margin-bottom:.25rem;">
                            <strong style="font-size:.85rem;color:${m.from==='staff'?'var(--primary)':'#22c55e'};">${m.from==='staff'?'👤 '+m.author:'🎮 Membre'}</strong>
                            <span style="font-size:.7rem;color:var(--text-muted);">${new Date(m.timestamp).toLocaleString('fr-FR')}</span>
                        </div>
                        <p style="margin:0;font-size:.875rem;">${m.content}</p>
                    </div>`).join('')}
                </div>
            </div>
            <div class="card">
                <h3 style="margin-bottom:1rem;">✏️ Répondre en DM</h3>
                <form method="POST" action="/panel/tickets/reply-send/${t.id}">
                    <div class="form-group">
                        <label class="form-label">Votre réponse *</label>
                        <textarea name="message" class="form-control" rows="5" required placeholder="Votre réponse..."></textarea>
                    </div>
                    <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
                        <button type="submit" class="btn btn-primary">📨 Envoyer en DM</button>
                        ${t.status!=='closed'&&!t.claimedBy?`<a href="/panel/tickets/${t.id}/claim" class="btn btn-outline">✋ Prendre en charge</a>`:''}
                        ${t.status!=='closed'?`<a href="/panel/tickets/${t.id}/close" class="btn btn-sm" style="background:#ef444420;color:#ef4444;">🔒 Fermer</a>`:''}
                    </div>
                </form>
            </div>
        </div>
        <div class="card" style="height:fit-content;">
            <h3 style="margin-bottom:1rem;">ℹ️ Infos</h3>
            <div style="display:flex;flex-direction:column;gap:.5rem;font-size:.875rem;">
                <div><span style="color:var(--text-muted);">ID:</span> <code style="font-size:.75rem;">${t.id}</code></div>
                <div><span style="color:var(--text-muted);">Discord:</span> <code style="font-size:.75rem;">${t.discordId}</code></div>
                <div><span style="color:var(--text-muted);">Tag:</span> ${t.userTag||'?'}</div>
                <div><span style="color:var(--text-muted);">Créé:</span> ${new Date(t.createdAt).toLocaleString('fr-FR')}</div>
                <div><span style="color:var(--text-muted);">Statut:</span> <strong style="color:${t.status==='closed'?'#ef4444':'#22c55e'}">${t.status==='closed'?'🔒 Fermé':'🟢 Ouvert'}</strong></div>
                ${t.claimedBy?`<div><span style="color:var(--text-muted);">Pris par:</span> ${t.claimedBy}</div>`:''}
                ${t.closedBy?`<div><span style="color:var(--text-muted);">Fermé par:</span> ${t.closedBy}</div>`:''}
                ${t.sentBy?`<div><span style="color:var(--text-muted);">Envoyé par:</span> ${t.sentBy}</div>`:''}
            </div>
        </div>
    </div>`;
    res.send(panelLayout(user,'Répondre au Ticket',content,'tickets'));
});

app.post('/panel/tickets/reply-send/:id', isAuthenticated, hasRole('support'), async (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (!t) return res.redirect('/panel/tickets?error='+encodeURIComponent('Ticket introuvable'));
    const { message } = req.body;
    if (!t.messages) t.messages=[];
    t.messages.push({ from:'staff', author:user.username, content:message, timestamp:new Date().toISOString() });
    writeDB(db);
    await callBotAPI('/api/ticket','POST',{ apiKey:PANEL_API_KEY, discordId:t.discordId, sujet:'Réponse: '+t.sujet, staffMessage:message, staffName:user.username, ticketId:t.id, action:'reply' });
    addLog('💬 Réponse ticket', user.username, t.discordId, { sujet:t.sujet }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/tickets/reply/'+t.id+'?success='+encodeURIComponent('Réponse envoyée'));
});

app.get('/panel/tickets/:id/history', isAuthenticated, hasRole('support'), (req, res) => {
    const db = readDB();
    const user = req.session.user;
    const t = (db.dmTickets||[]).find(t=>t.id===req.params.id);
    if (!t) return res.redirect('/panel/tickets?error='+encodeURIComponent('Ticket introuvable'));
    const content = `
    <div class="page-header">
        <div><div class="page-title">📜 Historique — <span>${t.sujet}</span></div></div>
        <a href="/panel/tickets/reply/${t.id}" class="btn btn-outline">← Répondre</a>
    </div>
    <div class="card">
        ${(t.messages||[]).length===0?'<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun message.</p>':
        '<div style="display:flex;flex-direction:column;gap:.6rem;">'+(t.messages||[]).map(m=>`
        <div style="padding:.75rem;background:${m.from==='staff'?'var(--bg-tertiary)':'rgba(147,51,234,0.1)'};border-radius:8px;border-left:3px solid ${m.from==='staff'?'var(--primary)':'#22c55e'};">
            <div style="display:flex;justify-content:space-between;margin-bottom:.25rem;">
                <strong>${m.from==='staff'?'👤 '+m.author:'🎮 Membre'}</strong>
                <span style="font-size:.75rem;color:var(--text-muted);">${new Date(m.timestamp).toLocaleString('fr-FR')}</span>
            </div>
            <p style="margin:0;">${m.content}</p>
        </div>`).join('')+'</div>'}
    </div>`;
    res.send(panelLayout(user,'Historique Ticket',content,'tickets'));
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
// ════════════════════════════════════════════════════════════════════
// §14 — PANEL : MODÉRATION
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


// ── Modules Owner V3 : maintenance, IP manager, settings publics ────

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
    <div class="grid-2" style="gap:1.5rem;margin-bottom:1.5rem;">
    <div class="card">
        <h3 style="margin-bottom:1rem;">🛡️ Anti-VPN / Proxy / Tor</h3>
        <p style="color:var(--text-muted);font-size:.875rem;margin-bottom:1rem;">Bloque les VPNs, proxies, serveurs Tor, datacenters et hébergeurs connus.</p>
        <div style="display:flex;align-items:center;gap:.75rem;background:${db.publicSettings&&db.publicSettings.antiVPNEnabled?'rgba(239,68,68,.1)':'rgba(255,255,255,.04)'};border:1.5px solid ${db.publicSettings&&db.publicSettings.antiVPNEnabled?'rgba(239,68,68,.4)':'rgba(255,255,255,.08)'};border-radius:12px;padding:.875rem 1.25rem;margin-bottom:1rem;">
            <span style="font-size:1.5rem;">🔒</span>
            <div>
                <div style="font-weight:700;font-size:.9rem;">Statut : <span style="color:${db.publicSettings&&db.publicSettings.antiVPNEnabled?'#f87171':'#6b7280'}">${db.publicSettings&&db.publicSettings.antiVPNEnabled?'🔴 ACTIF — VPN bloqués':'⚫ INACTIF'}</span></div>
                <div style="font-size:.75rem;color:var(--text-muted);">IPs en cache : ${Object.keys(IP_CHECK_CACHE).length} · Durée : 30min · <a href="/panel/owner/ip-manager/clear-cache" onclick="return confirm('Vider le cache IP ?')" style="color:#9333ea;">🗑️ Vider cache</a></div>
            </div>
        </div>
        <form action="/panel/owner/ip-manager/toggle-vpn" method="POST">
            <button type="submit" class="btn ${db.publicSettings&&db.publicSettings.antiVPNEnabled?'btn-danger':'btn-primary'} btn-full" onclick="return confirm('${db.publicSettings&&db.publicSettings.antiVPNEnabled?'Désactiver':'Activer'} le blocage VPN/Proxy ?')">
                ${db.publicSettings&&db.publicSettings.antiVPNEnabled?'🔓 Désactiver Anti-VPN':'🔒 Activer Anti-VPN'}
            </button>
        </form>
    </div>
    <div class="card">
        <h3 style="margin-bottom:1rem;">📵 Anti-4G/5G/Mobile</h3>
        <p style="color:var(--text-muted);font-size:.875rem;margin-bottom:1rem;">Bloque automatiquement les connexions via opérateurs mobiles (4G, 5G, LTE). Les IPs whitelistées ne sont pas affectées.</p>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:.75rem;background:${db.publicSettings&&db.publicSettings.antiMobileEnabled?'rgba(249,115,22,.1)':'rgba(255,255,255,.04)'};border:1.5px solid ${db.publicSettings&&db.publicSettings.antiMobileEnabled?'rgba(249,115,22,.4)':'rgba(255,255,255,.08)'};border-radius:12px;padding:.875rem 1.25rem;">
                <span style="font-size:1.5rem;">📶</span>
                <div>
                    <div style="font-weight:700;font-size:.9rem;">Statut : <span style="color:${db.publicSettings&&db.publicSettings.antiMobileEnabled?'#fb923c':'#6b7280'}">${db.publicSettings&&db.publicSettings.antiMobileEnabled?'🔴 ACTIF — Mobiles bloqués':'⚫ INACTIF'}</span></div>
                    <div style="font-size:.75rem;color:var(--text-muted);">Détecte Orange, SFR, Bouygues, Free Mobile, Vodafone, T-Mobile, etc.</div>
                </div>
            </div>
            <form action="/panel/owner/ip-manager/toggle-mobile" method="POST" style="margin:0;">
                <button type="submit" class="btn ${db.publicSettings&&db.publicSettings.antiMobileEnabled?'btn-danger':'btn-warning'}" style="padding:.875rem 1.5rem;" onclick="return confirm('${db.publicSettings&&db.publicSettings.antiMobileEnabled?'Désactiver':'Activer'} le blocage des connexions mobiles ?')">
                    ${db.publicSettings&&db.publicSettings.antiMobileEnabled?'📴 Désactiver Anti-Mobile':'📵 Activer Anti-Mobile'}
                </button>
            </form>
        </div>
        <div style="margin-top:.75rem;font-size:.75rem;color:var(--text-muted);">⚠️ L'activation bloque aussi bien les smartphones que les hotspots mobiles. Les IPs whitelistées passent toujours.</div>
    </div>
    </div>
    <div class="card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;">🌍 Anti-Pays (Geo-Blocking)</h3>
        <p style="color:var(--text-muted);font-size:.875rem;margin-bottom:1rem;">Autorise uniquement certains pays à accéder au site. Laissez la liste vide pour tout autoriser.</p>
        <div style="display:flex;align-items:center;gap:.75rem;background:${db.publicSettings&&db.publicSettings.antiCountryEnabled?'rgba(239,68,68,.1)':'rgba(255,255,255,.04)'};border:1.5px solid ${db.publicSettings&&db.publicSettings.antiCountryEnabled?'rgba(239,68,68,.4)':'rgba(255,255,255,.08)'};border-radius:12px;padding:.875rem 1.25rem;margin-bottom:1rem;">
            <span style="font-size:1.5rem;">🌍</span>
            <div>
                <div style="font-weight:700;font-size:.9rem;">Statut : <span style="color:${db.publicSettings&&db.publicSettings.antiCountryEnabled?'#f87171':'#6b7280'}">${db.publicSettings&&db.publicSettings.antiCountryEnabled?'🔴 ACTIF — Pays filtrés':'⚫ INACTIF'}</span></div>
                <div style="font-size:.75rem;color:var(--text-muted);">Pays autorisés : ${db.publicSettings&&db.publicSettings.allowedCountries&&db.publicSettings.allowedCountries.length>0?db.publicSettings.allowedCountries.join(', '):'Tous'}</div>
            </div>
        </div>
        <form action="/panel/owner/ip-manager/update-country-filter" method="POST" style="display:flex;flex-direction:column;gap:.75rem;">
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Pays autorisés (codes ISO-2, séparés par virgule)</label>
                <input type="text" name="allowedCountries" class="form-control" value="${db.publicSettings&&Array.isArray(db.publicSettings.allowedCountries)?db.publicSettings.allowedCountries.join(','):''}" placeholder="Ex: FR,BE,CH,LU,CA — laisser vide = tout autoriser">
                <div style="font-size:.72rem;color:var(--text-muted);margin-top:.3rem;">Codes ISO-2 : FR=France, BE=Belgique, CH=Suisse, LU=Luxembourg, CA=Canada, MA=Maroc, DZ=Algérie, TN=Tunisie</div>
            </div>
            <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
                <button type="submit" name="action" value="save" class="btn btn-primary">💾 Sauvegarder les pays</button>
                <button type="submit" name="action" value="toggle" class="btn ${db.publicSettings&&db.publicSettings.antiCountryEnabled?'btn-danger':'btn-warning'}" onclick="return confirm('${db.publicSettings&&db.publicSettings.antiCountryEnabled?'Désactiver':'Activer'} le filtrage par pays ?')">
                    ${db.publicSettings&&db.publicSettings.antiCountryEnabled?'🔓 Désactiver Geo-Block':'🔒 Activer Geo-Block'}
                </button>
            </div>
        </form>
    </div>
    <div class="card" style="margin-bottom:1.5rem;">
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

// Toggle Anti-4G/5G/Mobile
app.post('/panel/owner/ip-manager/toggle-mobile', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    db.publicSettings.antiMobileEnabled = !db.publicSettings.antiMobileEnabled;
    writeDB(db);
    const status = db.publicSettings.antiMobileEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ';
    addLog('📵 Anti-Mobile ' + status, req.session.user.username, 'system', { antiMobileEnabled: db.publicSettings.antiMobileEnabled }, getClientIP(req), getClientInfo(req));
    console.log(`[Anti4G5G] ${status} par ${req.session.user.username}`);
    res.redirect('/panel/owner/ip-manager?success=Anti-Mobile+' + encodeURIComponent(status));
});

// Toggle Anti-VPN
app.post('/panel/owner/ip-manager/toggle-vpn', isAuthenticated, hasRole('owner'), (req, res) => {
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    db.publicSettings.antiVPNEnabled = !db.publicSettings.antiVPNEnabled;
    writeDB(db);
    const status = db.publicSettings.antiVPNEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ';
    addLog('🛡️ Anti-VPN ' + status, req.session.user.username, 'system', { antiVPNEnabled: db.publicSettings.antiVPNEnabled }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/owner/ip-manager?success=Anti-VPN+' + encodeURIComponent(status));
});

// Vider le cache IP (force re-check immédiat)
app.get('/panel/owner/ip-manager/clear-cache', isAuthenticated, hasRole('owner'), (req, res) => {
    const count = Object.keys(IP_CHECK_CACHE).length;
    for (const key of Object.keys(IP_CHECK_CACHE)) delete IP_CHECK_CACHE[key];
    addLog('🗑️ Cache IP vidé', req.session.user.username, 'system', { count }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/owner/ip-manager?success=Cache+vidé+('+count+'+IPs+supprimées)');
});

// Mise à jour filtre pays (Geo-Block)
app.post('/panel/owner/ip-manager/update-country-filter', isAuthenticated, hasRole('owner'), (req, res) => {
    const { allowedCountries, action } = req.body;
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    // Sauvegarde des pays
    const raw = (allowedCountries || '').trim();
    db.publicSettings.allowedCountries = raw ? raw.split(',').map(c => c.trim().toUpperCase()).filter(c => c.length === 2) : [];
    // Toggle si demandé
    if (action === 'toggle') {
        db.publicSettings.antiCountryEnabled = !db.publicSettings.antiCountryEnabled;
    }
    writeDB(db);
    const status = db.publicSettings.antiCountryEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ';
    addLog('🌍 Geo-Block ' + status, req.session.user.username, 'system', { antiCountryEnabled: db.publicSettings.antiCountryEnabled, allowedCountries: db.publicSettings.allowedCountries }, getClientIP(req), getClientInfo(req));
    res.redirect('/panel/owner/ip-manager?success=Geo-Block+' + encodeURIComponent(status));
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
// ════════════════════════════════════════════════════════════════════
// §20 (suite) — CHATBOT FTY ULTRA V3 & PAGES PUBLIQUES
// ════════════════════════════════════════════════════════════════════
const CHATBOT_RESPONSES = [
    // Salutations
    { keys: ['bonjour','salut','hello','yo','hey','coucou','hi','bonsoir'], reply: '👋 Salut ! Je suis <strong>FTY Assistant</strong> 🤖<br>Je peux t\'aider sur :<br>• 🎯 Rejoindre l\'équipe<br>• ⚽ Matchs & calendrier<br>• 📋 Candidatures<br>• 🎮 Discord & communauté<br>• 📖 Règlement & guide<br>Qu\'est-ce que tu veux savoir ?' },
    
    // Rejoindre
    { keys: ['rejoindre','intégrer','entrer','postuler','candidature','comment join','how to join','m\'inscrire'], reply: '🎯 <strong>Comment rejoindre FTY Club Pro ?</strong><br><br>1️⃣ Remplis le formulaire → <a href="/candidature" style="color:#c084fc;font-weight:700;">Candidature</a><br>2️⃣ Le staff examine ta demande sous 24-48h<br>3️⃣ Si accepté, tu reçois un lien Discord<br>4️⃣ Un compte panel te sera créé<br><br>💡 Assure-toi d\'avoir un Discord actif !' },
    
    // Discord
    { keys: ['discord','serveur','lien discord','rejoindre discord'], reply: '💬 <strong>Discord FTY Club Pro</strong><br><br>Notre serveur Discord est le cœur de la communauté ! Tu y trouveras :<br>• 📢 Annonces officielles<br>• 🎮 Sessions de jeu<br>• 🎫 Support & tickets<br>• 🏆 Événements & tournois<br><br>🔗 Le lien est disponible en haut de la <a href="/" style="color:#c084fc;">page d\'accueil</a>.' },
    
    // Tactique
    { keys: ['tactique','formation','compo','stratégie','4-3-3','4-4-2','système de jeu'], reply: '⚽ <strong>Tactique FTY</strong><br><br>Notre système de jeu est visible en temps réel sur la page <a href="/tactique" style="color:#c084fc;">Tactique</a> !<br><br>On joue avec une formation adaptative selon les adversaires. Le capitaine définit la compo avant chaque match.<br><br>🎯 Tu veux rejoindre l\'équipe ? → <a href="/candidature" style="color:#c084fc;">Postuler</a>' },
    
    // Matchs
    { keys: ['match','prochain','calendrier','horaire','quand','schedule'], reply: '📅 <strong>Calendrier des matchs</strong><br><br>Retrouve tous nos matchs à venir et passés sur la <a href="/#matchs" style="color:#c084fc;">page d\'accueil</a> section Matchs !<br><br>• ✅ Matchs à venir : confirmés par le staff<br>• 🏆 Résultats : dans le <a href="/palmares" style="color:#c084fc;">Palmarès</a><br><br>💡 Les membres sont notifiés sur Discord avant chaque match !' },
    
    // Recrutement
    { keys: ['recrute','recrutement','poste','ouvert','place disponible','cherchez'], reply: '🎯 <strong>FTY recrute !</strong><br><br>Postes ouverts → <a href="/recrutement" style="color:#c084fc;">Page Recrutement</a><br><br>On cherche :<br>• ⚽ Joueurs passionnés (tous niveaux)<br>• 🛡️ Modérateurs Discord<br>• 🎧 Équipe Support<br><br>📝 Candidature rapide → <a href="/candidature" style="color:#c084fc;">Postuler maintenant</a>' },
    
    // Guide / Règles
    { keys: ['guide','règle','règlement','charte','loi','interdiction','obligation'], reply: '📖 <strong>Guide & Règlement FTY</strong><br><br>Notre guide complet est disponible sur <a href="/guide" style="color:#c084fc;">/guide</a><br><br>En résumé :<br>• ✅ Respect de tous les membres<br>• ✅ Présence aux matchs prévus<br>• ✅ Communication via Discord<br>• ❌ Anti-toxicité, fair-play obligatoire<br>• ❌ Pas de double compte<br><br>🚫 Toute violation = sanction immédiate.' },
    
    // Palmarès / Résultats
    { keys: ['palmare','palmares','résultat','titre','victoire','score','bilan'], reply: '🏆 <strong>Palmarès FTY Club Pro</strong><br><br>Consulte tous nos résultats → <a href="/palmares" style="color:#c084fc;">/palmares</a><br><br>Nos statistiques globales y sont affichées : victoires, nuls, défaites, buts marqués & encaissés.<br><br>💪 On vise le top !' },
    
    // Contact / Staff
    { keys: ['contact','staff','admin','modérateur','signaler','problème'], reply: '📧 <strong>Contacter le Staff FTY</strong><br><br>• 💬 Discord : ouvre un ticket dans #support<br>• 📝 Formulaire de candidature pour rejoindre<br>• 🎫 Tickets DM via le bot Discord<br><br>Le staff répond généralement sous <strong>24h</strong> en semaine.' },
    
    // Panel / Compte
    { keys: ['panel','compte','mot de passe','connexion','login','accès','oublié'], reply: '🔑 <strong>Accès au Panel</strong><br><br>Le panel est <strong>réservé aux membres staff</strong>.<br><br>Si tu as un compte :<br>→ <a href="/panel/login" style="color:#c084fc;">Se connecter</a><br><br>Mot de passe oublié ? Contacte un admin sur Discord pour une réinitialisation.<br><br>💡 Le panel = espace de gestion interne FTY.' },
    
    // Bot Discord
    { keys: ['bot','ftybot','commande','/ticket','/help'], reply: '🤖 <strong>Bot FTY</strong><br><br>Notre bot Discord est actif sur le serveur ! Il permet :<br>• 🎫 `/ticket` — Ouvrir un support<br>• 📊 Informations sur les stats<br>• 📢 Annonces automatiques<br>• 🛡️ Modération automatique<br><br>Rejoins le Discord → <a href="/" style="color:#c084fc;">Accueil</a>' },
    
    // Merci
    { keys: ['merci','thanks','super','cool','nickel','parfait','top'], reply: '😊 <strong>De rien !</strong><br>Si tu as d\'autres questions, je suis là 24/7 !<br><br>N\'oublie pas de rejoindre le Discord pour rester connecté à la communauté FTY 🔥' },
    
    // Âge / Niveau
    { keys: ['âge','niveau','requis','exigence','faut-il','skill','rang','division'], reply: '🎮 <strong>Profil recherché</strong><br><br>Pas de limite d\'âge ou de niveau imposé !<br><br>On cherche avant tout :<br>• 💪 Motivation & régularité<br>• 🤝 Fair-play et respect<br>• 📱 Discord actif<br><br>Les compétitions internes s\'adaptent aux niveaux !' },
    
    // Horaires / Activité
    { keys: ['horaire','heure','quand jouez','activité','disponible','soirée'], reply: '🕐 <strong>Activité FTY</strong><br><br>On joue principalement :<br>• 🌆 En semaine : 18h-23h<br>• 🌙 Week-end : journée et soirée<br><br>Les matchs sont fixés à l\'avance sur Discord. Présence obligatoire ou absence à signaler !' },
];

// ── Chatbot IA contextuel avec analyse sémantique ──
app.post('/api/chatbot', async (req, res) => {
    await new Promise(r => setTimeout(r, 200 + Math.random() * 350));
    const raw = (req.body.message || '').trim();
    const msg = raw.toLowerCase();
    if (!msg) return res.json({ reply: '❓ Tu n\'as rien écrit !' });
    if (msg.length > 500) return res.json({ reply: '⚠️ Message trop long ! Pose-moi une question courte.' });
    
    // Analyse sémantique — score de correspondance
    let bestMatch = null, bestScore = 0;
    for (const r of CHATBOT_RESPONSES) {
        let score = 0;
        for (const k of r.keys) {
            if (msg.includes(k)) {
                // Score plus élevé si le keyword est plus long (plus spécifique)
                score += 1 + k.length * 0.1;
            }
        }
        if (score > bestScore) { bestScore = score; bestMatch = r; }
    }
    if (bestMatch && bestScore > 0) return res.json({ reply: bestMatch.reply });
    
    // Suggestions intelligentes
    const suggestions = [];
    if (msg.includes('?')) suggestions.push('rejoindre l\'équipe', 'calendrier matchs', 'recrutement');
    const fallbacks = [
        '🤖 Je n\'ai pas compris ta question. Voici ce que je sais faire :<br><br>• 🎯 <strong>Rejoindre</strong> l\'équipe<br>• ⚽ <strong>Matchs</strong> & calendrier<br>• 📋 <strong>Candidature</strong><br>• 💬 <strong>Discord</strong><br>• 📖 <strong>Guide</strong> & règlement<br>• 🏆 <strong>Palmarès</strong><br><br>Essaie de poser ta question différemment !',
        '🤔 Hmm, je ne suis pas sûr de comprendre. Tu veux parler de :<br>• La <a href="/candidature" style="color:#c084fc;">candidature</a> ?<br>• Le <a href="/guide" style="color:#c084fc;">guide</a> ?<br>• Les <a href="/recrutement" style="color:#c084fc;">recrutements</a> ?<br>• Le Discord ?'
    ];
    res.json({ reply: fallbacks[Math.floor(Math.random() * fallbacks.length)] });
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
    const theme = ps.siteTheme || ps.theme || 'dark';
    
    // Couleurs selon le thème choisi
    const themeVars = {
        'dark':   { bg: '#000000', bg2: '#0A0A0F', p: '#00FFA3', a: '#00D4FF' },
        'purple': { bg: '#0a0014', bg2: '#1a0b2e', p: '#9333ea', a: '#ec4899' },
        'red':    { bg: '#0a0000', bg2: '#1a0000', p: '#ff0040', a: '#ff6600' },
        'blue':   { bg: '#000814', bg2: '#001233', p: '#0080ff', a: '#00d4ff' },
        'gold':   { bg: '#0a0800', bg2: '#1a1400', p: '#ffd700', a: '#ffaa00' },
        'white':  { bg: '#f5f7fa', bg2: '#ffffff', p: '#9333ea', a: '#ec4899' }
    };
    const tv = themeVars[theme] || themeVars['dark'];
    
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
    /* Couleurs dynamiques selon le thème Xywez */
    --primary:${tv.p};
    --secondary:${tv.a};
    --accent:${tv.a};
    --purple:#9333EA;
    
    /* Fond et surfaces */
    --bg:${tv.bg};
    --bg-secondary:${tv.bg2};
    --bg-tertiary:${theme === 'white' ? '#e8ecf1' : '#141420'};
    --bg-card:${theme === 'white' ? 'rgba(0,0,0,0.04)' : 'rgba(20,20,32,0.6)'};
    --bg-card-hover:${theme === 'white' ? 'rgba(0,0,0,0.08)' : 'rgba(20,20,32,0.9)'};
    
    /* Texte */
    --text:${theme === 'white' ? '#0a0e14' : '#FFFFFF'};
    --text-secondary:${theme === 'white' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'};
    --text-muted:${theme === 'white' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'};
    
    /* Bordures et ombres */
    --border:${tv.p}33;
    --glow-primary:0 0 20px ${tv.p}80;
    --glow-secondary:0 0 20px ${tv.a}80;
    --glow-accent:0 0 20px ${tv.a}80;
    
    /* Fonts */
    --font-display:'Exo 2','Orbitron',sans-serif;
    --font-body:'Inter','Roboto',sans-serif;
    
    /* Transitions */
    --transition:all 0.3s cubic-bezier(0.4,0,0.2,1);
}

body{font-family:var(--font-body);background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;line-height:1.6}
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

/* ========== CHATBOT CSS RENFORCÉ ========== */


@keyframes chatIn {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 400px) {
    #fty-chat-win {
        width: calc(100vw - 16px) !important;
        height: calc(100vh - 100px) !important;
        right: 8px !important;
        bottom: 80px !important;
    }
    #fty-chat-btn {
        bottom: 16px !important;
        right: 16px !important;
        width: 52px !important;
        height: 52px !important;
    }
}

#fty-msgs {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    scrollbar-width: thin;
    scrollbar-color: #9333ea #0a0014;
}

.msg-bot {
    background: rgba(147,51,234,0.2);
    border-radius: 8px 8px 8px 0;
    padding: 0.65rem 0.875rem;
    color: #fff;
    font-size: 0.875rem;
    max-width: 88%;
    border: 1px solid rgba(147,51,234,0.3);
}

.msg-user {
    background: linear-gradient(135deg, rgba(147,51,234,0.5), rgba(236,72,153,0.4));
    border-radius: 8px 8px 0 8px;
    padding: 0.65rem 0.875rem;
    color: #fff;
    font-size: 0.875rem;
    max-width: 88%;
    align-self: flex-end;
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




<!-- ╔══════════════════════════════════════╗ -->
<!-- ║  CHATBOT FTY  – version finale       ║ -->
<!-- ╚══════════════════════════════════════╝ -->
<button id="fty-chat-btn"
  onclick="ftyToggle()"
  title="Assistant FTY"
  style="position:fixed!important;bottom:24px!important;right:24px!important;
         z-index:2147483647!important;width:58px!important;height:58px!important;
         border-radius:50%!important;
         background:linear-gradient(135deg,#9333ea,#ec4899)!important;
         border:none!important;cursor:pointer!important;font-size:1.5rem!important;
         box-shadow:0 6px 24px rgba(147,51,234,.65)!important;
         display:flex!important;align-items:center!important;
         justify-content:center!important;pointer-events:auto!important;
         outline:none!important;">💬</button>

<div id="fty-chat-win"
  style="position:fixed!important;bottom:92px!important;right:24px!important;
         z-index:2147483646!important;width:320px!important;height:440px!important;
         background:#0a0014!important;border:2px solid #9333ea!important;
         border-radius:16px!important;overflow:hidden!important;
         display:none!important;flex-direction:column!important;
         box-shadow:0 20px 60px rgba(147,51,234,.55)!important;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#9333ea,#ec4899);
              padding:.8rem 1rem;display:flex;align-items:center;
              justify-content:space-between;flex-shrink:0;">
    <div style="display:flex;align-items:center;gap:.6rem;">
      <span style="font-size:1.3rem;">🤖</span>
      <div>
        <div style="color:#fff;font-weight:700;font-size:.88rem;">FTY Assistant</div>
        <div style="color:rgba(255,255,255,.8);font-size:.7rem;">🟢 En ligne</div>
      </div>
    </div>
    <button onclick="ftyToggle()"
      style="background:rgba(255,255,255,.2);border:none;color:#fff;
             cursor:pointer;width:26px;height:26px;border-radius:50%;
             font-size:.9rem;display:flex;align-items:center;
             justify-content:center;padding:0;">✕</button>
  </div>

  <!-- Messages -->
  <div id="fty-msgs"
    style="flex:1;overflow-y:auto;padding:.8rem;display:flex;
           flex-direction:column;gap:.5rem;
           scrollbar-width:thin;scrollbar-color:#9333ea #0a0014;">
    <div style="background:rgba(147,51,234,.2);border:1px solid rgba(147,51,234,.3);
                border-radius:0 8px 8px 8px;padding:.6rem .8rem;
                color:#fff;font-size:.83rem;max-width:90%;line-height:1.4;">
      Bonjour ! Posez-moi vos questions sur FTY Club.
    </div>
  </div>

  <!-- Input -->
  <div style="padding:.7rem;border-top:1px solid rgba(147,51,234,.25);
              display:flex;gap:.45rem;flex-shrink:0;background:rgba(0,0,8,.7);">
    <input id="fty-inp" type="text" placeholder="Votre message…"
      style="flex:1;background:rgba(147,51,234,.1);
             border:1px solid rgba(147,51,234,.35);border-radius:7px;
             padding:.55rem .8rem;color:#fff;font-size:.83rem;
             outline:none;min-width:0;"
      onkeydown="if(event.key==='Enter'){event.preventDefault();ftySend();}">
    <button onclick="ftySend()"
      style="background:linear-gradient(135deg,#9333ea,#ec4899);
             border:none;border-radius:7px;width:36px;height:36px;
             color:#fff;cursor:pointer;font-size:.9rem;
             display:flex;align-items:center;justify-content:center;
             flex-shrink:0;padding:0;">➤</button>
  </div>
</div>

<style>
#fty-chat-win.fty-open{display:flex!important;}
.fty-b{background:rgba(147,51,234,.2);border:1px solid rgba(147,51,234,.3);border-radius:0 8px 8px 8px;padding:.6rem .8rem;color:#fff;font-size:.83rem;max-width:90%;line-height:1.4;}
.fty-u{background:linear-gradient(135deg,rgba(147,51,234,.5),rgba(236,72,153,.4));border-radius:8px 8px 0 8px;padding:.6rem .8rem;color:#fff;font-size:.83rem;max-width:85%;align-self:flex-end;}
@media(max-width:480px){
  #fty-chat-win{width:calc(100vw - 16px)!important;height:calc(100vh - 100px)!important;right:8px!important;bottom:76px!important;}
  #fty-chat-btn{bottom:16px!important;right:16px!important;width:52px!important;height:52px!important;}
}
</style>



</body></html>
`;
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


// ════════════════════════════════════════════════════════════════
// ===   API BOT — reçoit heartbeat, logs, config, tickets     ===
// ════════════════════════════════════════════════════════════════
app.post('/api/bot', (req, res) => {
    const key = req.body?.apiKey || req.headers['x-api-key'];
    if (key !== PANEL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const { action, data } = req.body;
    try {
        if (action === 'maintenance') {
            const db = readDB();
            if (!db.publicSettings) db.publicSettings = {};
            db.publicSettings.maintenanceMode = !!data?.enabled;
            writeDB(db);
        } else if (action === 'log') {
            if (data) {
                if (!Array.isArray(botStatus.logs)) botStatus.logs = [];
                botStatus.logs.unshift(data);
                if (botStatus.logs.length > 1000) botStatus.logs = botStatus.logs.slice(0, 1000);
            }
        } else if (action === 'heartbeat') {
            botStatus.isReady = true;
            botStatus.panelConnected = true;
            if (data) {
                if (data.guilds !== undefined) botStatus.guilds = data.guilds;
                if (data.members !== undefined) botStatus.members = data.members;
                if (data.uptime !== undefined) botStatus.uptime = data.uptime;
            }
        } else if (action === 'newTicket') {
            if (data) {
                const db = readDB();
                if (!Array.isArray(db.dmTickets)) db.dmTickets = [];
                const exists = db.dmTickets.find(t => t.id === data.id);
                if (!exists) { db.dmTickets.unshift(data); writeDB(db); }
            }
        } else if (action === 'configUpdate' || action === 'updateConfig') {
            if (data) {
                const db = readDB();
                if (!db.serverConfig) db.serverConfig = {};
                Object.assign(db.serverConfig, data);
                writeDB(db);
            }
        } else if (action === 'getConfig') {
            const db = readDB();
            return res.json({ success: true, data: db.serverConfig || {} });
        } else if (action === 'clearLogs') {
            botStatus.logs = [];
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// ===   NOUVELLES FONCTIONNALITÉS V5                          ===
// ════════════════════════════════════════════════════════════════

// ── Recherche utilisateur par ID Discord (owner) ──────────────
// ── API recherche Discord enrichie ──────────────────────────────
app.get('/panel/search/discord/:discordId', isAuthenticated, hasRole('owner'), async (req, res) => {
    const db = readDB();
    const { discordId } = req.params;
    const user = db.users.find(u => u.discordId === discordId);
    const sanctionsLogs = (db.logs || []).filter(l => l.target && l.target.includes(discordId) || (user && l.target === user.username));
    const loginLogs = (db.logs || []).filter(l => user && l.executor === user.username);
    const allIPs = [...new Set([...(loginLogs.map(l => l.ip).filter(Boolean)), user?.ipAddress].filter(Boolean))].filter(ip => ip !== '[PROTECTED]');
    
    // Vérification membre Discord via bot
    let discordMemberInfo = null;
    try {
        const memberCheck = await callBotAPI('/api/member/' + discordId);
        if (memberCheck) discordMemberInfo = memberCheck;
    } catch(e) {}
    
    // Vérification Discord lié au panel
    const isPanelLinked = !!user;
    const isPanelOwner = user && (user.discordId === SUPER_ADMIN_DISCORD_ID || user.username === 'xywez');
    
    if (!user && sanctionsLogs.length === 0 && !discordMemberInfo) {
        return res.json({ found: false, discordId, message: 'Aucun compte trouvé avec cet ID Discord' });
    }
    
    res.json({
        found: true,
        discordId,
        // Statut Discord serveur
        discord: {
            isMember: discordMemberInfo?.isMember || false,
            username: discordMemberInfo?.username || null,
            displayName: discordMemberInfo?.displayName || null,
            avatar: discordMemberInfo?.avatar || null,
            roles: discordMemberInfo?.roles || [],
            joinedAt: discordMemberInfo?.joinedAt || null,
            booster: discordMemberInfo?.booster || false,
            banned: discordMemberInfo?.banned || false
        },
        // Lien panel
        panelLinked: isPanelLinked,
        panelOwner: isPanelOwner,
        user: user ? {
            username: user.username,
            role: user.role,
            accountType: user.accountType,
            hasPanel: true,
            panelId: user.username,
            discordLinked: !!user.discordId,
            createdBy: user.createdBy || 'Système',
            firstLogin: user.createdAt,
            lastLogin: user.lastLogin,
            ips: allIPs,
            device: user.device || user.platforms || '?',
            city: user.city || '?',
            os: user.os || '?',
            sanctions: user.sanctions || [],
            banned: user.banned || false,
            suspended: user.suspended || false
        } : null,
        sanctions: sanctionsLogs.slice(0, 50),
        logs: loginLogs.slice(0, 20),
        ips: allIPs
    });
});

// ── API recherche compte panel enrichie ─────────────────────────
app.get('/panel/search/account/:username', isAuthenticated, hasRole('owner'), async (req, res) => {
    const db = readDB();
    const username = decodeURIComponent(req.params.username);
    const user = db.users.find(u => u.username === username);
    if (!user) return res.json({ found: false });
    const logs = (db.logs || []).filter(l => l.executor === username || l.target === username);
    const ips = [...new Set(logs.map(l => l.ip).filter(Boolean))].filter(ip => ip !== '[PROTECTED]');
    
    // Vérification membre Discord si discordId connu
    let discordMemberInfo = null;
    if (user.discordId) {
        try {
            const memberCheck = await callBotAPI('/api/member/' + user.discordId);
            if (memberCheck) discordMemberInfo = memberCheck;
        } catch(e) {}
    }
    
    res.json({
        found: true,
        user: {
            username: user.username,
            role: user.role,
            discordId: user.discordId || null,
            discordLinked: !!user.discordId,
            discordUsername: user.discordUsername || null,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            sanctions: user.sanctions || [],
            banned: user.banned || false,
            suspended: user.suspended || false,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            platforms: user.platforms || []
        },
        discord: discordMemberInfo ? {
            isMember: discordMemberInfo.isMember || false,
            username: discordMemberInfo.username || null,
            displayName: discordMemberInfo.displayName || null,
            roles: discordMemberInfo.roles || [],
            joinedAt: discordMemberInfo.joinedAt || null,
            booster: discordMemberInfo.booster || false,
            banned: discordMemberInfo.banned || false
        } : null,
        logs: logs.slice(0, 20),
        ips
    });
});

// ── Page de recherche Discord/Compte (owner) ──────────────────
app.get('/panel/search', isAuthenticated, hasRole('owner'), (req, res) => {
    const user = req.session.user;
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🔍 Recherche <span>Avancée</span></div>
            <div class="page-breadcrumb">Recherche compte panel, joueur Discord, vérification membre serveur</div>
        </div>
    </div>
    
    <!-- Onglets de recherche -->
    <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;flex-wrap:wrap;">
        <button onclick="switchTab('discord')" id="tab-discord" class="btn btn-primary" style="padding:0.6rem 1.2rem;">🎮 Recherche Discord</button>
        <button onclick="switchTab('account')" id="tab-account" class="btn btn-outline" style="padding:0.6rem 1.2rem;">👤 Recherche Panel</button>
        <button onclick="switchTab('player')" id="tab-player" class="btn btn-outline" style="padding:0.6rem 1.2rem;">⚽ Recherche Joueur</button>
    </div>
    
    <!-- Tab: Discord -->
    <div id="panel-discord" class="search-panel">
        <div class="card">
            <h3 style="margin-bottom:0.5rem;">🎮 Recherche par ID Discord</h3>
            <p style="color:var(--text-muted);margin-bottom:1rem;font-size:0.875rem;">Vérifiez si l'ID est membre du serveur Discord, s'il a un compte panel lié, et ses informations complètes.</p>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <input id="discordSearchInput" type="text" placeholder="ID Discord (ex: 969065205067825222)..." class="form-control" style="flex:1;min-width:200px;" onkeydown="if(event.key==='Enter')searchDiscord()">
                <button onclick="searchDiscord()" class="btn btn-primary">🔍 Rechercher</button>
            </div>
            <div id="discordResult" style="margin-top:1rem;"></div>
        </div>
    </div>
    
    <!-- Tab: Account -->
    <div id="panel-account" class="search-panel" style="display:none;">
        <div class="card">
            <h3 style="margin-bottom:0.5rem;">👤 Recherche par Compte Panel</h3>
            <p style="color:var(--text-muted);margin-bottom:1rem;font-size:0.875rem;">Recherchez un membre staff par son identifiant panel, voir son Discord lié et sa présence sur le serveur.</p>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <input id="accountSearchInput" type="text" placeholder="Identifiant panel (ex: xywez)..." class="form-control" style="flex:1;min-width:200px;" onkeydown="if(event.key==='Enter')searchAccount()">
                <button onclick="searchAccount()" class="btn btn-primary">🔍 Rechercher</button>
            </div>
            <div id="accountResult" style="margin-top:1rem;"></div>
        </div>
    </div>
    
    <!-- Tab: Player (recherche par pseudo joueur) -->
    <div id="panel-player" class="search-panel" style="display:none;">
        <div class="card">
            <h3 style="margin-bottom:0.5rem;">⚽ Recherche Joueur</h3>
            <p style="color:var(--text-muted);margin-bottom:1rem;font-size:0.875rem;">Recherchez un joueur par son pseudo Discord ou pseudo jeu. Vérifiez sa présence sur le serveur.</p>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <input id="playerSearchInput" type="text" placeholder="Pseudo Discord ou pseudo jeu..." class="form-control" style="flex:1;min-width:200px;" onkeydown="if(event.key==='Enter')searchPlayer()">
                <button onclick="searchPlayer()" class="btn btn-primary">🔍 Rechercher</button>
            </div>
            <div id="playerResult" style="margin-top:1rem;"></div>
        </div>
    </div>
    
    <script>
    // ── Tab switcher ──
    function switchTab(tab) {
        ['discord','account','player'].forEach(t => {
            document.getElementById('panel-' + t).style.display = t === tab ? '' : 'none';
            var btn = document.getElementById('tab-' + t);
            if (btn) {
                btn.className = t === tab ? 'btn btn-primary' : 'btn btn-outline';
                btn.style.padding = '0.6rem 1.2rem';
            }
        });
    }
    
    // ── Rendu statut Discord ──
    function renderDiscordStatus(discord) {
        if (!discord) return '<div style="color:var(--text-muted);font-size:0.85rem;">🤖 Bot Discord indisponible</div>';
        if (discord.banned) return '<div style="background:rgba(239,68,68,0.1);border:1px solid #ef4444;padding:0.5rem 0.75rem;border-radius:8px;color:#ef4444;font-size:0.875rem;">🚫 Banni du serveur Discord</div>';
        if (!discord.isMember) return '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);padding:0.5rem 0.75rem;border-radius:8px;color:#f87171;font-size:0.875rem;">❌ N\'est pas membre du serveur Discord</div>';
        return '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.3);padding:0.75rem;border-radius:10px;">' +
            '<div style="font-weight:700;color:#22c55e;margin-bottom:0.5rem;">✅ Membre du serveur Discord</div>' +
            (discord.displayName ? '<div style="font-size:0.85rem;">🏷️ Pseudo: <strong>' + discord.displayName + '</strong>' + (discord.username ? ' (@' + discord.username + ')' : '') + '</div>' : '') +
            (discord.joinedAt ? '<div style="font-size:0.85rem;">📅 A rejoint: ' + new Date(discord.joinedAt).toLocaleDateString("fr-FR") + '</div>' : '') +
            (discord.roles && discord.roles.length ? '<div style="font-size:0.85rem;margin-top:0.3rem;">🎭 Rôles: ' + discord.roles.slice(0,5).join(', ') + '</div>' : '') +
            (discord.booster ? '<div style="font-size:0.85rem;color:#f472b6;">💎 Booster du serveur</div>' : '') +
            '</div>';
    }
    
    // ── Rendu lien panel ──
    function renderPanelLink(panelLinked, userData) {
        if (!panelLinked || !userData) return '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);padding:0.5rem 0.75rem;border-radius:8px;color:#f59e0b;font-size:0.875rem;">⚠️ Aucun compte panel lié à ce Discord</div>';
        return '<div style="background:rgba(147,51,234,0.08);border:1px solid rgba(147,51,234,0.3);padding:0.75rem;border-radius:10px;">' +
            '<div style="font-weight:700;color:#a855f7;margin-bottom:0.5rem;">🔗 Compte panel lié</div>' +
            '<div style="font-size:0.85rem;">👤 Pseudo: <strong>' + userData.username + '</strong></div>' +
            '<div style="font-size:0.85rem;">🎭 Rôle: <strong>' + userData.role + '</strong></div>' +
            (userData.banned ? '<div style="font-size:0.85rem;color:#ef4444;">🚫 Compte banni</div>' : '') +
            (userData.suspended ? '<div style="font-size:0.85rem;color:#f59e0b;">⏸️ Compte suspendu</div>' : '') +
            '<div style="font-size:0.85rem;">📅 Créé: ' + (userData.firstLogin ? new Date(userData.firstLogin).toLocaleDateString("fr-FR") : '?') + '</div>' +
            '<div style="font-size:0.85rem;">🕒 Dernière connexion: ' + (userData.lastLogin ? new Date(userData.lastLogin).toLocaleString("fr-FR") : 'Jamais') + '</div>' +
            (userData.ips && userData.ips.length ? '<div style="font-size:0.85rem;">🌐 IPs connues: ' + userData.ips.join(', ') + '</div>' : '') +
            '</div>';
    }
    
    // ── Recherche Discord ──
    async function searchDiscord() {
        const id = document.getElementById('discordSearchInput').value.trim();
        if (!id || !/^\\d{15,20}$/.test(id)) {
            document.getElementById('discordResult').innerHTML = '<div style="color:#f59e0b;font-size:0.875rem;">⚠️ ID Discord invalide (17-18 chiffres attendus)</div>';
            return;
        }
        const el = document.getElementById('discordResult');
        el.innerHTML = '<div style="color:var(--text-muted);display:flex;align-items:center;gap:0.5rem;"><div style="width:16px;height:16px;border:2px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;"></div> Recherche en cours...</div>';
        try {
            const r = await fetch('/panel/search/discord/' + id);
            const data = await r.json();
            if (!data.found) {
                el.innerHTML = '<div class="alert alert-error">❌ ' + (data.message || 'Aucun résultat') + '</div>';
                return;
            }
            el.innerHTML = '<div style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem;">' +
                '<div>' +
                    '<div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:0.4rem;">📡 Statut Discord Serveur</div>' +
                    renderDiscordStatus(data.discord) +
                '</div>' +
                '<div>' +
                    '<div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:0.4rem;">🔗 Compte Panel</div>' +
                    renderPanelLink(data.panelLinked, data.user) +
                '</div>' +
                (data.sanctions && data.sanctions.length > 0 ? 
                    '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);padding:0.75rem;border-radius:10px;">' +
                    '<div style="font-weight:700;color:#f87171;margin-bottom:0.5rem;">⚠️ Sanctions (' + data.sanctions.length + ')</div>' +
                    data.sanctions.slice(0,5).map(s => '<div style="font-size:0.8rem;color:var(--text-muted);padding:0.2rem 0;">• ' + s.action + ' — ' + new Date(s.timestamp).toLocaleDateString("fr-FR") + ' par ' + s.executor + '</div>').join('') +
                    '</div>' : '') +
                '</div>';
        } catch(e) { el.innerHTML = '<div class="alert alert-error">❌ Erreur: ' + e.message + '</div>'; }
    }
    
    // ── Recherche Compte Panel ──
    async function searchAccount() {
        const id = document.getElementById('accountSearchInput').value.trim();
        if (!id) return;
        const el = document.getElementById('accountResult');
        el.innerHTML = '<div style="color:var(--text-muted);display:flex;align-items:center;gap:0.5rem;"><div style="width:16px;height:16px;border:2px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;"></div> Recherche en cours...</div>';
        try {
            const r = await fetch('/panel/search/account/' + encodeURIComponent(id));
            const data = await r.json();
            if (!data.found) {
                el.innerHTML = '<div class="alert alert-error">❌ Compte panel introuvable</div>';
                return;
            }
            const u = data.user;
            el.innerHTML = '<div style="display:flex;flex-direction:column;gap:1rem;margin-top:0.5rem;">' +
                '<div style="background:rgba(147,51,234,0.08);border:1px solid rgba(147,51,234,0.3);padding:1rem;border-radius:12px;">' +
                    '<div style="font-size:1rem;font-weight:900;margin-bottom:0.5rem;">👤 ' + u.username + ' <span style="font-size:0.75rem;font-weight:600;background:rgba(147,51,234,0.2);padding:2px 8px;border-radius:4px;">' + u.role + '</span></div>' +
                    (u.firstName || u.lastName ? '<div style="font-size:0.85rem;">🪪 ' + ((u.firstName||'') + ' ' + (u.lastName||'')).trim() + '</div>' : '') +
                    '<div style="font-size:0.85rem;">📅 Créé: ' + (u.createdAt ? new Date(u.createdAt).toLocaleDateString("fr-FR") : '?') + '</div>' +
                    '<div style="font-size:0.85rem;">🕒 Dernière connexion: ' + (u.lastLogin ? new Date(u.lastLogin).toLocaleString("fr-FR") : 'Jamais') + '</div>' +
                    (data.ips && data.ips.length ? '<div style="font-size:0.85rem;">🌐 IPs: ' + data.ips.join(', ') + '</div>' : '') +
                    (u.platforms && u.platforms.length ? '<div style="font-size:0.85rem;">🕹️ Plateformes: ' + u.platforms.join(', ') + '</div>' : '') +
                    (u.banned ? '<div style="font-size:0.85rem;color:#ef4444;margin-top:0.3rem;">🚫 Compte banni</div>' : '') +
                    (u.suspended ? '<div style="font-size:0.85rem;color:#f59e0b;margin-top:0.3rem;">⏸️ Compte suspendu</div>' : '') +
                    (u.sanctions && u.sanctions.length ? '<div style="font-size:0.85rem;color:#f59e0b;margin-top:0.3rem;">⚠️ ' + u.sanctions.length + ' sanction(s)</div>' : '') +
                '</div>' +
                '<div>' +
                    '<div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:0.4rem;">🔗 Discord lié</div>' +
                    (u.discordLinked ?
                        '<div style="background:rgba(88,101,242,0.1);border:1px solid rgba(88,101,242,0.3);padding:0.75rem;border-radius:10px;">' +
                        '<div style="font-weight:700;color:#818cf8;margin-bottom:0.4rem;">✅ Discord lié au compte panel</div>' +
                        '<div style="font-size:0.85rem;">🆔 Discord ID: <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">' + u.discordId + '</code></div>' +
                        (u.discordUsername ? '<div style="font-size:0.85rem;">👤 Discord: @' + u.discordUsername + '</div>' : '') +
                        '</div>'
                        : '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);padding:0.5rem 0.75rem;border-radius:8px;color:#f59e0b;font-size:0.875rem;">⚠️ Aucun Discord lié au compte panel</div>'
                    ) +
                '</div>' +
                (data.discord ?
                    '<div>' +
                        '<div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:0.4rem;">📡 Présence sur le serveur Discord</div>' +
                        renderDiscordStatus(data.discord) +
                    '</div>' : '') +
                '</div>';
        } catch(e) { el.innerHTML = '<div class="alert alert-error">❌ Erreur: ' + e.message + '</div>'; }
    }
    
    // ── Recherche Joueur (pseudo Discord) ──
    async function searchPlayer() {
        const query = document.getElementById('playerSearchInput').value.trim();
        if (!query || query.length < 2) {
            document.getElementById('playerResult').innerHTML = '<div style="color:#f59e0b;font-size:0.875rem;">⚠️ Entrez au moins 2 caractères</div>';
            return;
        }
        const el = document.getElementById('playerResult');
        el.innerHTML = '<div style="color:var(--text-muted);display:flex;align-items:center;gap:0.5rem;"><div style="width:16px;height:16px;border:2px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;"></div> Recherche en cours...</div>';
        try {
            const r = await fetch('/panel/search/player/' + encodeURIComponent(query));
            const data = await r.json();
            if (!data.found || !data.results || data.results.length === 0) {
                el.innerHTML = '<div class="alert alert-error">❌ Aucun joueur trouvé pour "' + query + '"</div>';
                return;
            }
            el.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">' + data.results.length + ' résultat(s) trouvé(s)</div>' +
                data.results.map(r2 => 
                    '<div style="background:rgba(147,51,234,0.06);border:1px solid rgba(147,51,234,0.2);padding:0.75rem;border-radius:10px;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">' +
                    '<div>' +
                        '<div style="font-weight:700;">👤 ' + (r2.username || r2.discordUsername || '?') + '</div>' +
                        '<div style="font-size:0.8rem;color:var(--text-muted);">🎭 Rôle: ' + (r2.role || '?') + (r2.discordId ? ' • 🔗 Discord lié' : ' • ⚠️ Pas de Discord') + '</div>' +
                        (r2.discordMember !== undefined ? '<div style="font-size:0.8rem;color:' + (r2.discordMember ? '#22c55e' : '#ef4444') + ';">' + (r2.discordMember ? '✅ Membre Discord' : '❌ Non membre Discord') + '</div>' : '') +
                    '</div>' +
                    '<button onclick="copyToClipboard(\'' + (r2.discordId||r2.username) + '\')" class="btn btn-outline btn-sm">📋 Copier ID</button>' +
                    '</div>'
                ).join('');
        } catch(e) { el.innerHTML = '<div class="alert alert-error">❌ Erreur: ' + e.message + '</div>'; }
    }
    
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            var t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#22c55e;color:#fff;padding:0.75rem 1.25rem;border-radius:10px;font-weight:700;z-index:9999;font-size:0.875rem;';
            t.textContent = '✅ Copié : ' + text;
            document.body.appendChild(t);
            setTimeout(function(){t.remove();}, 2500);
        });
    }
    
    // Spinner CSS
    var style = document.createElement('style');
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
    </script>
    `;
    res.send(panelLayout(user, 'Recherche Avancée', content, 'search'));
});

// ── API Recherche joueur par pseudo ─────────────────────────────
app.get('/panel/search/player/:query', isAuthenticated, hasRole('owner'), async (req, res) => {
    const db = readDB();
    const query = decodeURIComponent(req.params.query).toLowerCase().trim();
    if (!query || query.length < 2) return res.json({ found: false, results: [] });
    
    // Cherche dans users par username ou discordUsername
    const matched = db.users.filter(u => 
        u.username.toLowerCase().includes(query) ||
        (u.discordUsername && u.discordUsername.toLowerCase().includes(query)) ||
        (u.firstName && u.firstName.toLowerCase().includes(query)) ||
        (u.lastName && u.lastName.toLowerCase().includes(query))
    );
    
    // Pour chaque résultat, vérifier si membre Discord
    const results = await Promise.all(matched.slice(0, 20).map(async (u) => {
        let discordMember = null;
        if (u.discordId) {
            try {
                const m = await callBotAPI('/api/member/' + u.discordId);
                discordMember = m ? m.isMember : null;
            } catch(e) {}
        }
        return {
            username: u.username,
            role: u.role,
            discordId: u.discordId || null,
            discordUsername: u.discordUsername || null,
            discordMember,
            banned: u.banned || false,
            suspended: u.suspended || false
        };
    }));
    
    res.json({ found: results.length > 0, results });
});

// ── Anti-double compte poussé (owner) ─────────────────────────
app.get('/panel/anti-double', isAuthenticated, hasRole('owner'), async (req, res) => {
    const db = readDB();
    const user = req.session.user;
    
    // Détecter les doublons par IP
    const ipMap = {};
    db.logs.forEach(l => {
        if (l.ip && l.executor) {
            if (!ipMap[l.ip]) ipMap[l.ip] = new Set();
            ipMap[l.ip].add(l.executor);
        }
    });
    const suspiciousIPs = Object.entries(ipMap)
        .filter(([ip, users]) => users.size > 1 && ip !== '127.0.0.1' && ip !== 'unknown')
        .map(([ip, users]) => ({ ip, users: [...users], count: users.size }))
        .sort((a, b) => b.count - a.count);
    
    // Doublons par ressemblance de pseudo
    const userList = db.users;
    const similarPairs = [];
    for (let i = 0; i < userList.length; i++) {
        for (let j = i+1; j < userList.length; j++) {
            const a = userList[i].username.toLowerCase();
            const b = userList[j].username.toLowerCase();
            if (a === b) continue;
            const longer = a.length > b.length ? a : b;
            const shorter = a.length > b.length ? b : a;
            if (longer.length === 0) continue;
            const dp = Array.from({length:longer.length+1},(_,i)=>Array.from({length:shorter.length+1},(_,j)=>i===0?j:j===0?i:0));
            for(let x=1;x<=longer.length;x++)for(let y=1;y<=shorter.length;y++)dp[x][y]=longer[x-1]===shorter[y-1]?dp[x-1][y-1]:1+Math.min(dp[x-1][y],dp[x][y-1],dp[x-1][y-1]);
            const sim=(longer.length-dp[longer.length][shorter.length])/longer.length;
            if (sim > 0.75) similarPairs.push({ a: userList[i].username, b: userList[j].username, similarity: Math.round(sim*100) });
        }
    }
    
    const content = `
    <div class="page-header">
        <div><div class="page-title">🛡️ Anti-Double <span>Compte</span></div><div class="page-breadcrumb">${suspiciousIPs.length} IPs suspectes | ${similarPairs.length} pseudos similaires</div></div>
    </div>
    
    <div class="card" style="margin-bottom:1.5rem;">
        <h3 style="margin-bottom:1rem;">🌐 IPs avec Plusieurs Comptes</h3>
        ${suspiciousIPs.length === 0 ? '<p style="color:var(--text-muted);">✅ Aucune IP suspecte détectée</p>' : `
        <table class="table" style="min-width:600px;overflow-x:auto;">
            <thead><tr><th>IP</th><th>Comptes</th><th>Nombre</th><th>Action</th></tr></thead>
            <tbody>
                ${suspiciousIPs.slice(0,50).map(s => `
                <tr>
                    <td><code>${s.ip}</code></td>
                    <td>${s.users.map(u => `<span style="background:rgba(147,51,234,0.2);padding:2px 6px;border-radius:4px;">${u}</span>`).join(' ')}</td>
                    <td><span style="color:#f59e0b;font-weight:700;">${s.count}</span></td>
                    <td><a href="/panel/search?ip=${encodeURIComponent(s.ip)}" class="btn btn-sm btn-outline">🔍 Détails</a>
                        <form method="POST" action="/panel/block-ip" style="display:inline;margin-left:4px;">
                            <input type="hidden" name="ip" value="${s.ip}">
                            <input type="hidden" name="reason" value="Double compte détecté automatiquement">
                            <button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Bloquer cette IP ?')">🚫 Bloquer</button>
                        </form>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>`}
    </div>
    
    <div class="card">
        <h3 style="margin-bottom:1rem;">👥 Pseudos Similaires (>75%)</h3>
        ${similarPairs.length === 0 ? '<p style="color:var(--text-muted);">✅ Aucun pseudo similaire détecté</p>' : `
        <table class="table">
            <thead><tr><th>Compte A</th><th>Compte B</th><th>Similarité</th></tr></thead>
            <tbody>
                ${similarPairs.slice(0,50).map(p => `
                <tr>
                    <td><strong>${p.a}</strong></td>
                    <td><strong>${p.b}</strong></td>
                    <td><span style="color:${p.similarity>90?'#ef4444':p.similarity>80?'#f59e0b':'#22c55e'};font-weight:700;">${p.similarity}%</span></td>
                </tr>`).join('')}
            </tbody>
        </table>`}
    </div>
    `;
    res.send(panelLayout(user, 'Anti-Double Compte', content, 'anti-double'));
});

// ── Nuke All (Xywez uniquement) ───────────────────────────────
app.post('/panel/nuke-all', isAuthenticated, hasRole('owner'), async (req, res) => {
    const user = req.session.user;
    // Vérification double: Xywez seulement
    if (user.discordId !== SUPER_ADMIN_DISCORD_ID && user.username !== 'xywez') {
        return res.status(403).json({ error: 'Réservé à Xywez uniquement' });
    }
    const { confirm } = req.body;
    if (confirm !== 'NUKE_CONFIRM_FTY_2026') {
        return res.status(400).json({ error: 'Confirmation incorrecte' });
    }
    
    try {
        // Déclencher le nuke sur le bot
        const botRes = await callBotAPI('/api/nuke-all', 'POST', {
            apiKey: PANEL_API_KEY,
            xywezId: user.discordId || SUPER_ADMIN_DISCORD_ID,
            confirm: 'NUKE_CONFIRM_FTY_2026'
        });
        
        // Reset la DB (garder uniquement le compte xywez)
        const xywezUser = db_xywez_backup();
        const emptyDB = {
            users: [xywezUser],
            applications: [], notifications: [], teamMembers: [], matches: [],
            announcements: [], logs: [], notes: [], blockedIPs: [], whitelistedIPs: [],
            publicSettings: {}, serverConfig: { configured: false, categories: {}, channels: {}, roles: {} },
            antiRaid: { enabled: true, joinThreshold: 5, timeWindow: 10, doubleCompteEnabled: true, antiLinkEnabled: true },
            dmTickets: [], candidatures: [], communiques: [], sanctions: [], tickets: []
        };
        writeDB(emptyDB);
        addLog('NUKE ALL', 'xywez', 'Système', { action: 'Reset complet' }, getClientIP(req));
        
        res.json({ success: true, message: 'Nuke complet effectué. Tous les comptes, salons et données ont été supprimés.' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

function db_xywez_backup() {
    try {
        const db = readDB();
        return db.users.find(u => u.username === 'xywez') || {
            username: 'xywez', password: hashPassword('xywez2026'), accountType: 'owner', role: 'owner',
            loginAttempts: 0, discordId: SUPER_ADMIN_DISCORD_ID, createdAt: new Date().toISOString(), lastLogin: null, sanctions: []
        };
    } catch(e) {
        return { username: 'xywez', password: hashPassword('xywez2026'), accountType: 'owner', role: 'owner', loginAttempts: 0, discordId: SUPER_ADMIN_DISCORD_ID, createdAt: new Date().toISOString(), lastLogin: null, sanctions: [] };
    }
}

// ── Page Nuke All (owner) ─────────────────────────────────────
app.get('/panel/nuke', isAuthenticated, hasRole('owner'), (req, res) => {
    const user = req.session.user;
    if (user.discordId !== SUPER_ADMIN_DISCORD_ID && user.username !== 'xywez') {
        return res.status(403).send('<h1>Accès refusé</h1>');
    }
    const content = `
    <div class="page-header">
        <div><div class="page-title" style="color:#ef4444;">☢️ Nuke <span>All</span></div><div class="page-breadcrumb">Réservé à Xywez uniquement</div></div>
    </div>
    <div class="card" style="border-color:#ef4444;max-width:600px;margin:0 auto;">
        <div style="text-align:center;margin-bottom:2rem;">
            <div style="font-size:4rem;margin-bottom:1rem;">☢️</div>
            <h2 style="color:#ef4444;margin-bottom:0.5rem;">DANGER — Nuke All</h2>
            <p style="color:var(--text-muted);">Cette action est <strong style="color:#ef4444;">IRRÉVERSIBLE</strong> :<br>
            • Supprime tous les salons et catégories Discord<br>
            • Supprime tous les rôles Discord<br>
            • Reset toute la base de données<br>
            • Supprime tous les comptes staff (sauf xywez)</p>
        </div>
        <div id="nukeForm">
            <div class="form-group">
                <label class="form-label" style="color:#ef4444;">Tapez exactement : <code>NUKE_CONFIRM_FTY_2026</code></label>
                <input type="text" id="nukeConfirm" class="form-control" style="border-color:#ef4444;" placeholder="Confirmation...">
            </div>
            <button onclick="doNuke()" class="btn" style="background:#ef4444;color:#fff;width:100%;font-size:1.1rem;padding:1rem;">
                ☢️ CONFIRMER LE NUKE TOTAL
            </button>
        </div>
        <div id="nukeResult" style="margin-top:1rem;"></div>
    </div>
    <script>
    async function doNuke() {
        const confirm = document.getElementById('nukeConfirm').value;
        if (confirm !== 'NUKE_CONFIRM_FTY_2026') {
            alert('Confirmation incorrecte !');
            return;
        }
        if (!window.confirm('DERNIÈRE CHANCE — Voulez-vous vraiment tout supprimer ?')) return;
        document.getElementById('nukeForm').innerHTML = '<div style="text-align:center;color:#f59e0b;">⏳ Nuke en cours...</div>';
        try {
            const r = await fetch('/panel/nuke-all', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ confirm: 'NUKE_CONFIRM_FTY_2026' }) });
            const data = await r.json();
            document.getElementById('nukeResult').innerHTML = data.success
                ? '<div style="color:#22c55e;padding:1rem;border:1px solid #22c55e;border-radius:8px;">✅ ' + data.message + '</div>'
                : '<div style="color:#ef4444;padding:1rem;border:1px solid #ef4444;border-radius:8px;">❌ ' + data.error + '</div>';
        } catch(e) {
            document.getElementById('nukeResult').innerHTML = '<div style="color:#ef4444;">❌ ' + e.message + '</div>';
        }
    }
    </script>
    `;
    res.send(panelLayout(user, 'Nuke All', content, 'nuke'));
});

// ── Sélecteur de thème (Xywez uniquement) ────────────────────
app.get('/panel/themes', isAuthenticated, hasRole('owner'), (req, res) => {
    const user = req.session.user;
    if (user.discordId !== SUPER_ADMIN_DISCORD_ID && user.username !== 'xywez') {
        return res.status(403).send('<h1>Accès refusé</h1>');
    }
    const themes = [
        { id: 'dark',   name: '🌑 Noir & Néon',   desc: 'Sombre avec accents verts fluo (défaut)', preview: 'linear-gradient(135deg,#000,#0a0014)',    primary: '#00FFA3', accent: '#00D4FF', textColor: '#fff' },
        { id: 'purple', name: '💜 Purple Haze',    desc: 'Violet profond avec accents roses',        preview: 'linear-gradient(135deg,#0a0014,#1a0b2e)', primary: '#9333ea', accent: '#ec4899', textColor: '#fff' },
        { id: 'red',    name: '🔴 Red Neon',       desc: 'Noir avec accents rouge vif',              preview: 'linear-gradient(135deg,#0a0000,#1a0000)', primary: '#ff0040', accent: '#ff6600', textColor: '#fff' },
        { id: 'blue',   name: '💙 Cyber Blue',     desc: 'Bleu cyberpunk avec accents cyan',         preview: 'linear-gradient(135deg,#000814,#001233)', primary: '#0080ff', accent: '#00d4ff', textColor: '#fff' },
        { id: 'gold',   name: '🥇 Gold Elite',     desc: 'Noir premium avec accents dorés',          preview: 'linear-gradient(135deg,#0a0800,#1a1400)', primary: '#ffd700', accent: '#ffaa00', textColor: '#fff' },
        { id: 'white',  name: '⚪ Light Mode',     desc: 'Thème clair professionnel',                preview: 'linear-gradient(135deg,#f5f7fa,#e8ecf1)', primary: '#9333ea', accent: '#ec4899', textColor: '#111' }
    ];
    const db = readDB();
    const currentTheme = db.publicSettings?.siteTheme || 'dark';
    
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">🎨 Thèmes <span>Site Public</span></div>
            <div class="page-breadcrumb">Personnalisation exclusive Xywez — Thème actuel : <strong id="currentThemeLabel">${themes.find(t=>t.id===currentTheme)?.name || currentTheme}</strong></div>
        </div>
    </div>
    
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;margin-bottom:2rem;">
        ${themes.map(t => `
        <div id="theme-card-${t.id}" 
             onclick="applyTheme('${t.id}','${t.name}','${t.primary}')"
             style="cursor:pointer;background:rgba(255,255,255,0.04);border:2px solid ${t.id === currentTheme ? t.primary : 'rgba(255,255,255,0.08)'};border-radius:16px;padding:1.25rem;transition:all 0.2s;${t.id === currentTheme ? 'box-shadow:0 0 24px '+t.primary+'66;' : ''}">
            <!-- Aperçu visuel -->
            <div style="height:90px;border-radius:10px;margin-bottom:1rem;background:${t.preview};display:flex;align-items:center;justify-content:center;gap:0.5rem;overflow:hidden;position:relative;">
                <div style="font-size:2rem;">${t.name.split(' ')[0]}</div>
                <div style="position:absolute;bottom:6px;right:8px;display:flex;gap:4px;">
                    <div style="width:16px;height:16px;border-radius:50%;background:${t.primary};box-shadow:0 0 8px ${t.primary};"></div>
                    <div style="width:16px;height:16px;border-radius:50%;background:${t.accent};box-shadow:0 0 8px ${t.accent};"></div>
                </div>
            </div>
            <!-- Nom et description -->
            <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.25rem;color:${t.textColor === '#fff' ? '#fff' : '#000'}">${t.name}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">${t.desc}</div>
            <!-- Badge actif -->
            <div id="badge-${t.id}" style="font-size:0.8rem;font-weight:700;color:${t.id===currentTheme?'#22c55e':'transparent'};">
                ${t.id===currentTheme?'✅ Actif':'✅ Actif'}
            </div>
        </div>`).join('')}
    </div>
    
    <div id="themeMsg"></div>
    
    <div class="card" style="max-width:500px;margin-top:1rem;">
        <h4 style="margin-bottom:0.75rem;">ℹ️ Comment fonctionne le thème ?</h4>
        <p style="color:var(--text-muted);font-size:0.875rem;line-height:1.6;">
            Le thème s'applique sur toutes les <strong>pages publiques</strong> du site (accueil, recrutement, guide, palmarès, tactique, candidature).<br><br>
            Le panel garde son propre thème indépendamment.<br>
            Les changements sont instantanés pour tous les visiteurs.
        </p>
    </div>
    
    <script>
    const themeData = {
        'dark':   { primary: '#00FFA3', accent: '#00D4FF', bg: '#000000' },
        'purple': { primary: '#9333ea', accent: '#ec4899', bg: '#0a0014' },
        'red':    { primary: '#ff0040', accent: '#ff6600', bg: '#0a0000' },
        'blue':   { primary: '#0080ff', accent: '#00d4ff', bg: '#000814' },
        'gold':   { primary: '#ffd700', accent: '#ffaa00', bg: '#0a0800' },
        'white':  { primary: '#9333ea', accent: '#ec4899', bg: '#f5f7fa' }
    };
    let currentTheme = '${currentTheme}';
    
    // Initialiser les badges (cacher tous sauf actif)
    document.querySelectorAll('[id^="badge-"]').forEach(el => {
        const tid = el.id.replace('badge-', '');
        el.style.color = tid === currentTheme ? '#22c55e' : 'transparent';
    });
    
    async function applyTheme(themeId, themeName, primaryColor) {
        const el = document.getElementById('themeMsg');
        el.innerHTML = '<div style="color:var(--text-muted);padding:0.5rem 0;">⏳ Application du thème...</div>';
        
        try {
            const r = await fetch('/panel/themes/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: themeId })
            });
            const data = await r.json();
            
            if (data.success) {
                // Mise à jour visuelle des cartes
                document.querySelectorAll('[id^="theme-card-"]').forEach(card => {
                    const tid = card.id.replace('theme-card-', '');
                    const td = themeData[tid] || themeData['dark'];
                    card.style.borderColor = tid === themeId ? td.primary : 'rgba(255,255,255,0.08)';
                    card.style.boxShadow = tid === themeId ? '0 0 24px ' + td.primary + '66' : 'none';
                });
                
                // Mise à jour des badges
                document.querySelectorAll('[id^="badge-"]').forEach(badge => {
                    badge.style.color = badge.id === 'badge-' + themeId ? '#22c55e' : 'transparent';
                });
                
                // Mise à jour du label
                document.getElementById('currentThemeLabel').textContent = themeName;
                currentTheme = themeId;
                
                el.innerHTML = '<div style="color:#22c55e;padding:0.75rem 1rem;border:1px solid #22c55e;border-radius:8px;margin-top:0.5rem;">✅ Thème <strong>' + themeName + '</strong> appliqué sur le site public !</div>';
                
                // Effacer le message après 3s
                setTimeout(() => { el.innerHTML = ''; }, 3000);
            } else {
                el.innerHTML = '<div style="color:#ef4444;padding:0.75rem 1rem;border:1px solid #ef4444;border-radius:8px;">❌ ' + (data.error || 'Erreur inconnue') + '</div>';
            }
        } catch(e) {
            el.innerHTML = '<div style="color:#ef4444;padding:0.75rem 1rem;border:1px solid #ef4444;border-radius:8px;">❌ ' + e.message + '</div>';
        }
    }
    </script>
    `;
    res.send(panelLayout(user, 'Thèmes Site', content, 'themes'));
});

app.post('/panel/themes/apply', isAuthenticated, hasRole('owner'), (req, res) => {
    const user = req.session.user;
    if (user.discordId !== SUPER_ADMIN_DISCORD_ID && user.username !== 'xywez') {
        return res.status(403).json({ error: 'Réservé à Xywez uniquement' });
    }
    const { theme } = req.body;
    const validThemes = ['dark', 'purple', 'red', 'blue', 'gold', 'white'];
    if (!validThemes.includes(theme)) return res.status(400).json({ error: 'Thème invalide: ' + theme });
    const db = readDB();
    if (!db.publicSettings) db.publicSettings = {};
    db.publicSettings.siteTheme = theme;
    writeDB(db);
    addLog('Thème site appliqué', user.username, theme, { theme }, getClientIP(req));
    res.json({ success: true, theme });
});


// ── Écrire avec le bot depuis le panel ───────────────────────
app.get('/panel/bot-message', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const user = req.session.user;
    const channels = await callBotAPI('/api/guild-channels');
    const content = `
    <div class="page-header">
        <div><div class="page-title">📢 Message <span>Bot</span></div><div class="page-breadcrumb">Écrire avec le bot depuis le panel</div></div>
    </div>
    <div class="card" style="max-width:700px;">
        <div class="form-group">
            <label class="form-label">📁 Salon cible</label>
            <select id="botMsgChannel" class="form-control">
                <option value="">-- Sélectionner un salon --</option>
                ${(channels?.channels || []).map(c => `<option value="${c.id}">#${c.name} (${c.category})</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">📝 Type de message</label>
            <select id="botMsgType" class="form-control" onchange="toggleEmbedFields()">
                <option value="text">Texte simple</option>
                <option value="embed">Embed (avec titre et couleur)</option>
            </select>
        </div>
        <div id="simpleFields">
            <div class="form-group">
                <label class="form-label">💬 Message</label>
                <textarea id="botMsgText" class="form-control" rows="4" placeholder="Votre message..."></textarea>
            </div>
        </div>
        <div id="embedFields" style="display:none;">
            <div class="form-group">
                <label class="form-label">📌 Titre</label>
                <input type="text" id="embedTitle" class="form-control" placeholder="Titre de l'embed">
            </div>
            <div class="form-group">
                <label class="form-label">📝 Description</label>
                <textarea id="embedDesc" class="form-control" rows="4" placeholder="Contenu de l'embed..."></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">🎨 Couleur (hex)</label>
                <input type="color" id="embedColor" class="form-control" value="#9333ea" style="height:48px;">
            </div>
        </div>
        <button onclick="sendBotMessage()" class="btn btn-primary" style="margin-top:0.5rem;">📤 Envoyer le Message</button>
        <div id="botMsgResult" style="margin-top:1rem;"></div>
    </div>
    <script>
    function toggleEmbedFields() {
        const t = document.getElementById('botMsgType').value;
        document.getElementById('simpleFields').style.display = t === 'text' ? '' : 'none';
        document.getElementById('embedFields').style.display = t === 'embed' ? '' : 'none';
    }
    async function sendBotMessage() {
        const channelId = document.getElementById('botMsgChannel').value;
        const type = document.getElementById('botMsgType').value;
        const el = document.getElementById('botMsgResult');
        if (!channelId) return el.innerHTML = '<div style="color:#ef4444;">❌ Sélectionne un salon</div>';
        let payload = { channelId, author: '${user.username}' };
        if (type === 'text') {
            const msg = document.getElementById('botMsgText').value.trim();
            if (!msg) return el.innerHTML = '<div style="color:#ef4444;">❌ Message vide</div>';
            payload.message = msg;
        } else {
            const color = document.getElementById('embedColor').value;
            payload.embed = {
                title: document.getElementById('embedTitle').value,
                description: document.getElementById('embedDesc').value,
                color: parseInt(color.replace('#',''), 16),
                timestamp: new Date().toISOString(),
                footer: { text: 'FTY Club Pro | ${user.username}' }
            };
        }
        el.innerHTML = '<div style="color:var(--text-muted);">⏳ Envoi...</div>';
        try {
            const r = await fetch('/api/bot-send', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            const data = await r.json();
            el.innerHTML = data.success ? '<div style="color:#22c55e;">✅ Message envoyé !</div>' : '<div style="color:#ef4444;">❌ ' + data.error + '</div>';
        } catch(e) { el.innerHTML = '<div style="color:#ef4444;">❌ ' + e.message + '</div>'; }
    }
    </script>
    `;
    res.send(panelLayout(user, 'Message Bot', content, 'bot-message'));
});

// API proxy send bot message
app.post('/api/bot-send', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const result = await callBotAPI('/api/send-message', 'POST', { ...req.body, apiKey: PANEL_API_KEY });
    if (result) res.json(result);
    else res.json({ success: false, error: 'Bot inaccessible' });
});

// ── Patch Notes depuis le panel ───────────────────────────────
app.get('/panel/patch-notes', isAuthenticated, hasRole('admin'), async (req, res) => {
    const user = req.session.user;
    const content = `
    <div class="page-header">
        <div><div class="page-title">🔄 Patch <span>Notes</span></div></div>
    </div>
    <div class="card" style="max-width:600px;">
        <div class="form-group">
            <label class="form-label">🏷️ Version (ex: 1.2.3)</label>
            <input type="text" id="pnVersion" class="form-control" placeholder="1.0.0">
        </div>
        <div class="form-group">
            <label class="form-label">📌 Titre</label>
            <input type="text" id="pnTitle" class="form-control" placeholder="Nouvelles fonctionnalités">
        </div>
        <div class="form-group">
            <label class="form-label">📝 Changements (une ligne par changement)</label>
            <textarea id="pnChanges" class="form-control" rows="8" placeholder="Ajout du système de tickets\nCorrection du bug de connexion\nNouveau salon giveaway..."></textarea>
        </div>
        <button onclick="publishPatchNotes()" class="btn btn-primary">🚀 Publier les Patch Notes</button>
        <div id="pnResult" style="margin-top:1rem;"></div>
    </div>
    <script>
    async function publishPatchNotes() {
        const version = document.getElementById('pnVersion').value.trim();
        const title = document.getElementById('pnTitle').value.trim();
        const changesText = document.getElementById('pnChanges').value.trim();
        const changes = changesText.split('\\n').filter(c => c.trim());
        const el = document.getElementById('pnResult');
        if (!version || changes.length === 0) return el.innerHTML = '<div style="color:#ef4444;">❌ Version et changements requis</div>';
        el.innerHTML = '<div style="color:var(--text-muted);">⏳ Publication...</div>';
        try {
            const r = await fetch('/api/publish-patch-notes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ version, title, changes, author: '${user.username}' }) });
            const data = await r.json();
            el.innerHTML = data.success ? '<div style="color:#22c55e;">✅ Patch notes publiés dans le salon mises-à-jour !</div>' : '<div style="color:#ef4444;">❌ ' + data.error + '</div>';
        } catch(e) { el.innerHTML = '<div style="color:#ef4444;">❌ ' + e.message + '</div>'; }
    }
    </script>
    `;
    res.send(panelLayout(user, 'Patch Notes', content, 'patch-notes'));
});

app.post('/api/publish-patch-notes', isAuthenticated, hasRole('admin'), async (req, res) => {
    const result = await callBotAPI('/api/patch-notes', 'POST', { ...req.body, apiKey: PANEL_API_KEY });
    if (result) res.json(result);
    else res.json({ success: false, error: 'Bot inaccessible' });
});

// ── API Nuke Reset reçu par le bot ────────────────────────────
app.post('/api/bot-nuke-reset', (req, res) => {
    const key = req.body?.apiKey || req.headers['x-api-key'];
    if (key !== PANEL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const { action, data } = req.body;
    if (action === 'nukeReset') {
        try {
            const xywez = db_xywez_backup();
            const emptyDB = { users: [xywez], applications: [], notifications: [], teamMembers: [], matches: [], announcements: [], logs: [{ id: Date.now().toString(), action: 'NUKE ALL', executor: 'xywez', target: 'Système', timestamp: new Date().toISOString() }], notes: [], blockedIPs: [], whitelistedIPs: [], publicSettings: {}, serverConfig: { configured: false }, antiRaid: { enabled: true }, dmTickets: [], candidatures: [], communiques: [], sanctions: [], tickets: [] };
            writeDB(emptyDB);
            res.json({ success: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    } else {
        res.json({ success: false, error: 'Action inconnue' });
    }
});


// ── Guide obligatoire première connexion ────────────────────────────
app.get('/panel/welcome-guide', isAuthenticated, (req, res) => {
    const user = req.session.user;
    const db = readDB();
    const dbUser = db.users.find(u => u.username === user.username);
    // Bypass guide pour xywez
    const isXywezUser = user.username === 'xywez' || user.discordId === SUPER_ADMIN_DISCORD_ID;
    if (isXywezUser) {
        if (dbUser && !dbUser.hasSeenGuide) { dbUser.hasSeenGuide = true; dbUser.guideCompletedAt = new Date().toISOString(); writeDB(db); }
        return res.redirect('/panel/dashboard');
    }
    if (dbUser && dbUser.hasSeenGuide) return res.redirect('/panel/dashboard');
    const roleColor = ROLE_COLORS[user.role] || '#9333ea';
    const roleLabel = ROLE_LABELS[user.role] || user.role;
    const roleFeatures = {
        owner: [
            { icon: '☢️', title: 'Nuke All', desc: 'Réinitialise la base de données. Extrême précaution.' },
            { icon: '🛡️', title: 'Gestion IPs', desc: 'Bloquer/débloquer des IPs, gérer whitelist et protections.' },
            { icon: '⚙️', title: 'Système', desc: 'Configuration complète, thèmes, maintenance, anti-VPN.' },
            { icon: '🔍', title: 'Recherche Avancée', desc: 'Chercher un utilisateur, vérifier son Discord, ses IPs.' },
            { icon: '📢', title: 'Message Staff', desc: 'Envoyer des messages importants à tout le staff.' }
        ],
        fondateur: [
            { icon: '👥', title: 'Gestion Membres', desc: 'Créer, modifier, suspendre des comptes panel.' },
            { icon: '📋', title: 'Logs Complets', desc: 'Accès à tous les logs avec géolocalisation IP.' },
            { icon: '🤖', title: 'Bot Discord', desc: 'Contrôle du bot : commandes, statut, paramètres.' },
            { icon: '📢', title: 'Message Staff', desc: 'Envoyer des messages importants à tout le staff.' }
        ],
        default: [
            { icon: '📊', title: 'Dashboard', desc: 'Vue d\'ensemble, statistiques, accès rapide.' },
            { icon: '📝', title: 'Candidatures', desc: 'Gérer les demandes d\'entrée dans le club.' },
            { icon: '🎫', title: 'Tickets', desc: 'Répondre aux tickets des membres Discord.' },
            { icon: '✉️', title: 'Messagerie', desc: 'Communiquer avec le staff en privé.' },
            { icon: '👤', title: 'Mon Profil', desc: 'Gérer vos infos, lier Discord, changer mot de passe.' }
        ]
    };
    const features = roleFeatures[user.role] || roleFeatures.default;
    const html = `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🎉 Bienvenue - FTY Club Pro</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@700;900&family=Titillium+Web:wght@400;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:radial-gradient(ellipse at 20% 50%,#1a0b2e 0%,#000 60%);color:#fff;font-family:'Titillium Web',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;}
.guide-wrap{width:100%;max-width:760px;}
.progress-bar{display:flex;align-items:center;margin-bottom:2.5rem;padding:0 .5rem;}
.prog-step{flex:1;height:4px;background:rgba(147,51,234,.2);border-radius:4px;transition:background .4s;}
.prog-step.done{background:linear-gradient(90deg,#9333ea,#ec4899);}
.prog-dot{width:32px;height:32px;border-radius:50%;background:rgba(147,51,234,.2);border:2px solid rgba(147,51,234,.4);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0;transition:all .4s;}
.prog-dot.active{background:linear-gradient(135deg,#9333ea,#ec4899);border-color:transparent;box-shadow:0 0 20px rgba(147,51,234,.6);}
.prog-dot.completed{background:linear-gradient(135deg,#10b981,#059669);border-color:transparent;}
.guide-card{display:none;animation:fadeUp .4s ease;}
.guide-card.active{display:block;}
@keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
.card{background:rgba(255,255,255,.03);border:1px solid rgba(147,51,234,.25);border-radius:20px;padding:2.5rem;backdrop-filter:blur(20px);}
.card-icon{font-size:4rem;text-align:center;margin-bottom:1rem;display:block;filter:drop-shadow(0 0 20px rgba(147,51,234,.6));}
.card-title{font-family:'Exo 2',sans-serif;font-size:2rem;font-weight:900;text-align:center;margin-bottom:1rem;background:linear-gradient(135deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.card-sub{color:rgba(255,255,255,.6);text-align:center;margin-bottom:2rem;font-size:1rem;line-height:1.7;}
.features{display:flex;flex-direction:column;gap:.75rem;margin-bottom:2rem;}
.feat{display:flex;align-items:flex-start;gap:1rem;background:rgba(147,51,234,.06);border:1px solid rgba(147,51,234,.15);border-radius:12px;padding:1rem;}
.feat-ico{font-size:1.6rem;flex-shrink:0;}
.feat-title{font-weight:700;font-size:.95rem;margin-bottom:.25rem;color:#e2d9f3;}
.feat-desc{font-size:.85rem;color:rgba(255,255,255,.55);line-height:1.5;}
.rules{display:flex;flex-direction:column;gap:.75rem;margin-bottom:2rem;}
.rule{display:flex;gap:.875rem;align-items:flex-start;background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.15);border-radius:12px;padding:1rem;}
.rule-icon{font-size:1.3rem;flex-shrink:0;}
.rule-text{font-size:.875rem;color:rgba(255,255,255,.75);line-height:1.5;}
.confirm-box{display:flex;align-items:flex-start;gap:.875rem;background:rgba(147,51,234,.08);border:1px solid rgba(147,51,234,.3);border-radius:12px;padding:1.25rem;margin-bottom:1rem;cursor:pointer;}
.confirm-box input{width:20px;height:20px;flex-shrink:0;margin-top:2px;accent-color:#9333ea;}
.confirm-box label{font-size:.9rem;color:rgba(255,255,255,.8);cursor:pointer;line-height:1.5;}
.btns{display:flex;gap:1rem;margin-top:1.5rem;}
.btn-p{flex:1;background:linear-gradient(135deg,#9333ea,#ec4899);color:#fff;border:none;border-radius:12px;padding:1rem 1.5rem;font-weight:700;font-size:1rem;cursor:pointer;transition:all .25s;font-family:inherit;}
.btn-p:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(147,51,234,.5);}
.btn-p:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.btn-s{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:1rem 1.5rem;font-weight:600;font-size:.9rem;cursor:pointer;transition:all .25s;font-family:inherit;}
.btn-s:hover{background:rgba(255,255,255,.12);}
@media(max-width:600px){.card{padding:1.5rem}.card-title{font-size:1.5rem}.btns{flex-direction:column}}
.quiz-opt{display:flex;align-items:center;gap:.75rem;background:rgba(147,51,234,.06);border:1.5px solid rgba(147,51,234,.15);border-radius:10px;padding:.75rem 1rem;cursor:pointer;transition:all .2s;font-size:.875rem;color:rgba(255,255,255,.75);}
.quiz-opt:hover{background:rgba(147,51,234,.12);border-color:rgba(147,51,234,.35);}
.quiz-opt.correct{background:rgba(16,185,129,.12);border-color:rgba(16,185,129,.5);color:#6ee7b7;}
.quiz-opt.wrong{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.4);color:#fca5a5;}
.quiz-opt input{accent-color:#9333ea;width:16px;height:16px;flex-shrink:0;}
</style></head>
<body>
<div class="guide-wrap">
<div class="progress-bar" id="progressBar">
<div class="prog-dot active" id="dot1">1</div><div class="prog-step" id="step1"></div>
<div class="prog-dot" id="dot2">2</div><div class="prog-step" id="step2"></div>
<div class="prog-dot" id="dot3">3</div><div class="prog-step" id="step3"></div>
<div class="prog-dot" id="dot4">4</div><div class="prog-step" id="step4"></div>
<div class="prog-dot" id="dot5">5</div>
</div>
<!-- Step 1 -->
<div class="guide-card active" id="card1"><div class="card">
<span class="card-icon">🎉</span>
<div class="card-title">Bienvenue, ${user.username} !</div>
<p class="card-sub">Tu accèdes pour la <strong>première fois</strong> au panel FTY Club Pro. Ce guide (4 étapes) est <strong style="color:#e879f9;">obligatoire</strong> avant d'accéder au panel.</p>
<div style="text-align:center;margin-bottom:2rem;">
<span style="display:inline-block;padding:.4rem 1.5rem;border-radius:50px;font-weight:700;font-size:.95rem;background:${roleColor}25;border:2px solid ${roleColor}60;color:${roleColor};">${roleLabel}</span>
<p style="color:rgba(255,255,255,.5);font-size:.8rem;margin-top:.5rem;">Ton rôle dans FTY Club Pro</p>
</div>
<div class="feat" style="background:rgba(147,51,234,.1);border-color:rgba(147,51,234,.3);">
<div class="feat-ico">⚡</div>
<div><div class="feat-title">Panel FTY Club Pro V5</div>
<div class="feat-desc">Espace de gestion avancé du staff. Toute action est tracée et loggée avec ton IP, appareil et navigateur.</div></div>
</div>
<div class="btns"><button class="btn-p" onclick="goTo(2)">Commencer le guide →</button></div>
</div></div>
<!-- Step 2 -->
<div class="guide-card" id="card2"><div class="card">
<span class="card-icon">🧭</span>
<div class="card-title">Tes Fonctionnalités</div>
<p class="card-sub">En tant que <strong style="color:${roleColor};">${roleLabel}</strong>, voici tes outils :</p>
<div class="features">${features.map(f => '<div class="feat"><div class="feat-ico">'+f.icon+'</div><div><div class="feat-title">'+f.title+'</div><div class="feat-desc">'+f.desc+'</div></div></div>').join('')}</div>
<div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.2);border-radius:12px;padding:.875rem 1rem;margin-bottom:1rem;">
  <div style="font-weight:700;color:#10b981;margin-bottom:.4rem;font-size:.875rem;">💡 Astuce</div>
  <div style="font-size:.82rem;color:rgba(255,255,255,.6);line-height:1.5;">Toutes tes actions dans le panel sont <strong style="color:#fff;">tracées et enregistrées</strong> : IP, appareil, navigateur, heure exacte.</div>
</div>
<div class="btns"><button class="btn-s" onclick="goTo(1)">← Retour</button><button class="btn-p" onclick="goTo(3)">Suivant →</button></div>
</div></div>
<!-- Step 3 -->
<div class="guide-card" id="card3"><div class="card">
<span class="card-icon">📜</span>
<div class="card-title">Règles Obligatoires</div>
<p class="card-sub">Ces règles sont <strong style="color:#f87171;">non négociables</strong>. Toute violation = sanction immédiate sans avertissement.</p>
<div class="rules">
<div class="rule"><div class="rule-icon">🚫</div><div class="rule-text"><strong>Confidentialité absolue</strong> — Aucune information du panel ne doit être partagée extérieurement. Captures d'écran et enregistrements interdits.</div></div>
<div class="rule"><div class="rule-icon">🔐</div><div class="rule-text"><strong>Sécurité du compte</strong> — Ne partage jamais tes identifiants. En cas de compromission, contacte xywez immédiatement via Discord.</div></div>
<div class="rule"><div class="rule-icon">⚖️</div><div class="rule-text"><strong>Usage éthique uniquement</strong> — Tout abus (sanctions injustifiées, accès non autorisés, espionnage) = suspension immédiate + ban Discord.</div></div>
<div class="rule"><div class="rule-icon">📋</div><div class="rule-text"><strong>Traçabilité totale</strong> — Chaque action est loggée avec ton IP, appareil, navigateur, OS et géolocalisation précise.</div></div>
<div class="rule"><div class="rule-icon">🤝</div><div class="rule-text"><strong>Respect permanent</strong> — Comportement professionnel envers tous, membres et staff. Zéro tolérance pour le harcèlement.</div></div>
<div class="rule"><div class="rule-icon">🔄</div><div class="rule-text"><strong>Mise à jour obligatoire</strong> — En cas de changement de règles, tu seras notifié(e) et devras relire le guide. Le refus = révocation d'accès.</div></div>
</div>
<div class="btns"><button class="btn-s" onclick="goTo(2)">← Retour</button><button class="btn-p" onclick="goTo(4)">J'ai compris →</button></div>
</div></div>
<!-- Step 4 : Quiz rapide -->
<div class="guide-card" id="card4"><div class="card">
<span class="card-icon">🎯</span>
<div class="card-title">Quiz Rapide</div>
<p class="card-sub">Prouve que tu as bien lu les règles en répondant à ces 2 questions !</p>
<div class="quiz-q" style="margin-bottom:1.25rem;">
  <p style="font-weight:700;font-size:.95rem;margin-bottom:.75rem;color:#e2d9f3;">1️⃣ Que dois-tu faire si tu découvres une faille de sécurité dans le panel ?</p>
  <div style="display:flex;flex-direction:column;gap:.5rem;">
    <label class="quiz-opt" data-q="1" data-correct="false"><input type="radio" name="q1" value="a"> <span>L'exploiter pour avoir plus d'accès</span></label>
    <label class="quiz-opt" data-q="1" data-correct="true"><input type="radio" name="q1" value="b"> <span>La signaler immédiatement à xywez via Discord</span></label>
    <label class="quiz-opt" data-q="1" data-correct="false"><input type="radio" name="q1" value="c"> <span>La partager avec d'autres membres</span></label>
  </div>
</div>
<div class="quiz-q" style="margin-bottom:1.25rem;">
  <p style="font-weight:700;font-size:.95rem;margin-bottom:.75rem;color:#e2d9f3;">2️⃣ Est-il autorisé de partager une capture d'écran du panel ?</p>
  <div style="display:flex;flex-direction:column;gap:.5rem;">
    <label class="quiz-opt" data-q="2" data-correct="true"><input type="radio" name="q2" value="a"> <span>Non, jamais — c'est strictement interdit</span></label>
    <label class="quiz-opt" data-q="2" data-correct="false"><input type="radio" name="q2" value="b"> <span>Oui, si c'est pour aider un ami</span></label>
    <label class="quiz-opt" data-q="2" data-correct="false"><input type="radio" name="q2" value="c"> <span>Oui, uniquement si floutée</span></label>
  </div>
</div>
<div id="quiz-feedback" style="display:none;"></div>
<div class="btns"><button class="btn-s" onclick="goTo(3)">← Retour</button><button class="btn-p" id="btnQuiz" onclick="checkQuiz()">Vérifier mes réponses ✓</button></div>
<style>
.quiz-opt{display:flex;align-items:center;gap:.75rem;background:rgba(147,51,234,.06);border:1.5px solid rgba(147,51,234,.15);border-radius:10px;padding:.75rem 1rem;cursor:pointer;transition:all .2s;font-size:.875rem;color:rgba(255,255,255,.75);}
.quiz-opt:hover{background:rgba(147,51,234,.12);border-color:rgba(147,51,234,.35);}
.quiz-opt.correct{background:rgba(16,185,129,.12);border-color:rgba(16,185,129,.5);color:#6ee7b7;}
.quiz-opt.wrong{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.4);color:#fca5a5;}
.quiz-opt input{accent-color:#9333ea;width:16px;height:16px;flex-shrink:0;}
</style>
</div></div>
<!-- Step 5 : Confirmation finale -->
<div class="guide-card" id="card5"><div class="card">
<span class="card-icon">✅</span>
<div class="card-title">Engagement Final</div>
<p class="card-sub">Dernière étape ! Confirme tes engagements pour accéder au panel.</p>
<div class="confirm-box" onclick="tog(1)">
<input type="checkbox" id="c1" onchange="chk()">
<label for="c1">J'ai lu, compris et j'accepte <strong>toutes les règles</strong> du panel FTY Club Pro. Je suis conscient(e) que toutes mes actions sont enregistrées.</label>
</div>
<div class="confirm-box" onclick="tog(2)">
<input type="checkbox" id="c2" onchange="chk()">
<label for="c2">Je m'engage à respecter la <strong>confidentialité totale</strong> des informations et à ne jamais partager mes accès.</label>
</div>
<div class="confirm-box" onclick="tog(3)">
<input type="checkbox" id="c3" onchange="chk()">
<label for="c3">Je comprends que tout abus entraînera une <strong>sanction immédiate</strong> (suspension/ban panel + Discord) sans appel possible.</label>
</div>
<div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:.875rem 1rem;margin-top:1rem;">
  <div style="font-size:.8rem;color:rgba(255,255,255,.5);text-align:center;line-height:1.6;">
    🔒 Connexion tracée • IP, appareil &amp; navigateur enregistrés<br>
    <strong style="color:rgba(245,158,11,.7);">FTY Security System V5</strong>
  </div>
</div>
<div class="btns">
<button class="btn-s" onclick="goTo(4)">← Retour</button>
<button class="btn-p" id="btnOk" disabled onclick="finish()">🚀 Accéder au Panel FTY</button>
</div>
</div></div>
</div>
<script>
var cur=1;var totalSteps=5;
function goTo(s){
  document.getElementById('card'+cur).classList.remove('active');
  document.getElementById('card'+s).classList.add('active');
  for(var i=1;i<=totalSteps;i++){
    var d=document.getElementById('dot'+i),st=document.getElementById('step'+i);
    if(i<s){d.className='prog-dot completed';d.innerHTML='✓';if(st)st.classList.add('done');}
    else if(i===s){d.className='prog-dot active';d.innerHTML=i;}
    else{d.className='prog-dot';d.innerHTML=i;if(st&&i<=totalSteps-1)st.classList.remove('done');}
  }
  cur=s;window.scrollTo({top:0,behavior:'smooth'});
}
function tog(n){var c=document.getElementById('c'+n);c.checked=!c.checked;chk();}
function chk(){var ok=document.getElementById('c1').checked&&document.getElementById('c2').checked&&document.getElementById('c3').checked;document.getElementById('btnOk').disabled=!ok;}

function checkQuiz(){
  var q1=document.querySelector('input[name="q1"]:checked');
  var q2=document.querySelector('input[name="q2"]:checked');
  var fb=document.getElementById('quiz-feedback');
  fb.style.display='block';
  if(!q1||!q2){
    fb.innerHTML='<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:.75rem 1rem;color:#fcd34d;font-size:.875rem;">⚠️ Réponds aux 2 questions avant de continuer.</div>';
    return;
  }
  var ok1=(q1.value==='b');
  var ok2=(q2.value==='a');
  // Reset styles
  document.querySelectorAll('.quiz-opt').forEach(function(el){el.classList.remove('correct','wrong');});
  // Colorer la réponse choisie Q1
  var label1=q1.closest ? q1.closest('.quiz-opt') : q1.parentNode;
  if(label1) label1.classList.add(ok1?'correct':'wrong');
  // Colorer la réponse choisie Q2
  var label2=q2.closest ? q2.closest('.quiz-opt') : q2.parentNode;
  if(label2) label2.classList.add(ok2?'correct':'wrong');
  if(ok1&&ok2){
    fb.innerHTML='<div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:.875rem 1rem;color:#6ee7b7;font-size:.875rem;text-align:center;">✅ Parfait ! Tu as tout bon. Passage à la dernière étape...</div>';
    document.getElementById('btnQuiz').disabled=true;
    setTimeout(function(){goTo(5);},1200);
  } else {
    fb.innerHTML='<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:.875rem 1rem;color:#fca5a5;font-size:.875rem;">❌ Mauvaise(s) réponse(s). Relis les règles à l\'étape 3 et réessaie !</div>';
  }
}

async function finish(){
  var b=document.getElementById('btnOk');b.disabled=true;b.textContent='⏳ Validation en cours...';
  b.style.background='linear-gradient(135deg,#10b981,#059669)';
  try{await fetch('/panel/guide-complete',{method:'POST',headers:{'Content-Type':'application/json'}});}catch(e){}
  b.textContent='✅ Accès accordé !';
  setTimeout(function(){window.location.href='/panel/dashboard';},800);
}
</script>
</body></html>`;
    res.send(html);
});

app.post('/panel/guide-complete', isAuthenticated, (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.username === req.session.user.username);
    if (user) { user.hasSeenGuide = true; user.guideCompletedAt = new Date().toISOString(); writeDB(db); req.session.user.firstLoginGuide = false; }
    res.json({ success: true });
});

// ── Broadcast Staff (messages importants) ────────────────────────────
//    Accessible : owners, fondateurs, admins, modérateurs
app.get('/panel/broadcast', isAuthenticated, hasRole('moderateur'), (req, res) => {
    const user = req.session.user;
    const db = readDB();
    const recentBroadcasts = (db.broadcasts||[]).slice(0,15);
    const myRank = HIERARCHY[user.role] || 0;
    const targetGroups = [
        { val: 'all', label: '🌐 Tout le staff', desc: 'Tous les membres actifs' },
        { val: 'admin', label: '🛡️ Admins & +', desc: 'Administrateurs et supérieurs' },
        { val: 'moderateur', label: '⚖️ Modérateurs & +', desc: 'Mods et supérieurs' },
        { val: 'support', label: '🎧 Support & +', desc: 'Équipe support et +' },
        { val: 'joueur', label: '⚽ Joueurs', desc: 'Membres joueurs uniquement' },
    ].filter(g => {
        if (g.val === 'owner' && myRank < HIERARCHY['owner']) return false;
        return true;
    });
    const content = `
    <div class="page-header">
        <div>
            <div class="page-title">📢 Messages <span>Staff</span></div>
            <div class="page-breadcrumb">Envoyer des messages importants à des groupes ou à tout le staff</div>
        </div>
    </div>
    <div class="grid-2" style="gap:1.5rem;align-items:start;">
      <div>
        <div class="card">
            <h3 style="margin-bottom:1.25rem;">📤 Nouveau Message</h3>
            <div class="form-group">
                <label class="form-label">🎯 Destinataires</label>
                <select id="bcTarget" class="form-control">
                    ${targetGroups.map(g => '<option value="'+g.val+'">'+g.label+' — '+g.desc+'</option>').join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">⚠️ Priorité</label>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;background:rgba(34,197,94,.08);border:1.5px solid rgba(34,197,94,.2);border-radius:8px;padding:.5rem 1rem;">
                        <input type="radio" name="bcPriority" value="info" checked style="accent-color:#22c55e;"> <span style="color:#22c55e;font-size:.875rem;">ℹ️ Info</span></label>
                    <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;background:rgba(245,158,11,.08);border:1.5px solid rgba(245,158,11,.2);border-radius:8px;padding:.5rem 1rem;">
                        <input type="radio" name="bcPriority" value="important" style="accent-color:#f59e0b;"> <span style="color:#f59e0b;font-size:.875rem;">⚠️ Important</span></label>
                    <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;background:rgba(239,68,68,.08);border:1.5px solid rgba(239,68,68,.2);border-radius:8px;padding:.5rem 1rem;">
                        <input type="radio" name="bcPriority" value="urgent" style="accent-color:#ef4444;"> <span style="color:#ef4444;font-size:.875rem;">🚨 URGENT</span></label>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">📌 Titre</label>
                <input type="text" id="bcTitle" class="form-control" placeholder="Ex: Réunion staff ce soir 21h" maxlength="100">
                <div style="text-align:right;font-size:.72rem;color:var(--text-muted);margin-top:.2rem;"><span id="bcTitleCount">0</span>/100</div>
            </div>
            <div class="form-group">
                <label class="form-label">💬 Contenu</label>
                <textarea id="bcContent" class="form-control" rows="6" placeholder="Détails du message..." maxlength="2000" style="resize:vertical;"></textarea>
                <div style="text-align:right;font-size:.72rem;color:var(--text-muted);margin-top:.2rem;"><span id="bcCount">0</span>/2000</div>
            </div>
            <div class="form-group">
                <div style="display:flex;flex-direction:column;gap:.5rem;">
                    <label style="display:flex;align-items:center;gap:.75rem;cursor:pointer;background:rgba(88,101,242,.06);border:1px solid rgba(88,101,242,.2);border-radius:8px;padding:.6rem .875rem;">
                        <input type="checkbox" id="bcDiscord" style="width:16px;height:16px;accent-color:#5865f2;flex-shrink:0;">
                        <span style="font-size:.85rem;">📮 DM Discord aux membres avec Discord lié</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:.75rem;cursor:pointer;background:rgba(147,51,234,.06);border:1px solid rgba(147,51,234,.2);border-radius:8px;padding:.6rem .875rem;">
                        <input type="checkbox" id="bcNotifPanel" checked style="width:16px;height:16px;accent-color:#9333ea;flex-shrink:0;">
                        <span style="font-size:.85rem;">🔔 Notification panel (recommandé)</span>
                    </label>
                </div>
            </div>
            <button onclick="sendBC()" class="btn btn-primary" style="width:100%;padding:.875rem;" id="bcBtn">📤 Envoyer le Message</button>
            <div id="bcResult" style="margin-top:1rem;"></div>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-bottom:1.25rem;">📋 Historique (15 derniers)</h3>
        <div style="display:flex;flex-direction:column;gap:.75rem;max-height:700px;overflow-y:auto;">
        ${recentBroadcasts.length===0?'<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucun message envoyé.</p>':recentBroadcasts.map(b=>{
            const pc=b.priority==='urgent'?'#ef4444':b.priority==='important'?'#f59e0b':'#22c55e';
            const pi=b.priority==='urgent'?'🚨':b.priority==='important'?'⚠️':'ℹ️';
            return '<div style="background:rgba(147,51,234,.04);border:1px solid rgba(147,51,234,.12);border-left:4px solid '+pc+';border-radius:10px;padding:.875rem;">'+
            '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.4rem;margin-bottom:.4rem;">'+
                '<div><span style="color:'+pc+';font-size:.72rem;font-weight:700;">'+pi+' '+(b.priority||'info').toUpperCase()+'</span> <strong style="font-size:.9rem;margin-left:.35rem;">'+( b.title||'Sans titre')+'</strong></div>'+
                '<div style="font-size:.72rem;color:var(--text-muted);">'+new Date(b.sentAt).toLocaleString('fr-FR')+'</div>'+
            '</div>'+
            '<p style="font-size:.82rem;color:rgba(255,255,255,.55);margin-bottom:.4rem;">'+(b.content||'').slice(0,200)+(b.content&&b.content.length>200?'...':'')+'</p>'+
            '<div style="font-size:.72rem;color:var(--text-muted);">Par <strong>'+b.sentBy+'</strong> → '+(b.target==='all'?'Tout le staff':(ROLE_LABELS[b.target]||b.target))+' · 👥 '+(b.sentToCount||0)+' destinataire(s)'+(b.discordSent?' · 💬 '+b.discordSent+' DM':'')+' </div>'+
            '</div>';}).join('')}
        </div>
      </div>
    </div>
    <script>
    document.getElementById('bcTitle').addEventListener('input',function(){document.getElementById('bcTitleCount').textContent=this.value.length;});
    document.getElementById('bcContent').addEventListener('input',function(){document.getElementById('bcCount').textContent=this.value.length;});
    async function sendBC(){
        var title=document.getElementById('bcTitle').value.trim();
        var content=document.getElementById('bcContent').value.trim();
        var target=document.getElementById('bcTarget').value;
        var priority=document.querySelector('input[name="bcPriority"]:checked')?.value||'info';
        var withDiscord=document.getElementById('bcDiscord').checked;
        var el=document.getElementById('bcResult'),btn=document.getElementById('bcBtn');
        if(!title)return el.innerHTML='<div class="alert alert-error">❌ Titre requis</div>';
        if(!content||content.length<10)return el.innerHTML='<div class="alert alert-error">❌ Contenu trop court (min 10 caractères)</div>';
        btn.disabled=true;btn.textContent='⏳ Envoi...';
        try{
            var r=await fetch('/api/broadcast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,content,target,priority,withDiscord})});
            var data=await r.json();
            if(data.success){el.innerHTML='<div class="alert alert-success">✅ Envoyé à <strong>'+data.sentTo+'</strong> membre(s)'+(data.discordSent?' + <strong>'+data.discordSent+'</strong> DM Discord':'')+' !</div>';document.getElementById('bcTitle').value='';document.getElementById('bcContent').value='';document.getElementById('bcTitleCount').textContent='0';document.getElementById('bcCount').textContent='0';setTimeout(()=>location.reload(),2500);}
            else{el.innerHTML='<div class="alert alert-error">❌ '+(data.error||'Erreur')+'</div>';}
        }catch(e){el.innerHTML='<div class="alert alert-error">❌ '+e.message+'</div>';}
        btn.disabled=false;btn.textContent='📤 Envoyer le Message';
    }
    </script>`;
    res.send(panelLayout(user, 'Messages Staff', content, 'broadcast'));
});

app.post('/api/broadcast', isAuthenticated, hasRole('moderateur'), async (req, res) => {
    const senderUser = req.session.user;
    const { title, content, target, priority, withDiscord } = req.body;
    if (!title || !content) return res.json({ success: false, error: 'Titre et contenu requis' });
    if (content.length < 10) return res.json({ success: false, error: 'Message trop court' });
    const db = readDB();
    let targets = db.users.filter(u => u.username !== senderUser.username && !u.banned && !u.suspended);
    if (target === 'admin') targets = targets.filter(u => HIERARCHY[u.role||u.accountType] >= HIERARCHY['administrateur']);
    else if (target !== 'all') targets = targets.filter(u => (u.role||u.accountType) === target);
    const priIcons = { urgent: '🚨', important: '⚠️', info: 'ℹ️' };
    const priColors = { urgent: '#ef4444', important: '#f59e0b', info: '#22c55e' };
    targets.forEach(u => addNotification(db, u.username, 'broadcast', priIcons[priority]+'  '+title, 'De '+senderUser.username+': '+content, priority==='urgent'||priority==='important'?'high':'normal'));
    if (!db.broadcasts) db.broadcasts = [];
    db.broadcasts.unshift({ id: 'bc_'+Date.now(), title, content, target, priority, sentBy: senderUser.username, sentAt: new Date().toISOString(), sentToCount: targets.length, withDiscord: !!withDiscord, discordSent: 0 });
    if (db.broadcasts.length > 200) db.broadcasts = db.broadcasts.slice(0,200);
    writeDB(db);
    addLog('📢 Broadcast Staff', senderUser.username, target, { title, priority, sentTo: targets.length }, getClientIP(req), getClientInfo(req));
    let discordSent = 0;
    if (withDiscord) {
        for (const u of targets.filter(u2 => u2.discordId)) {
            try { await sendDiscordDM(u.discordId, priIcons[priority]+'  '+title, '**📢 Message Staff FTY — De '+senderUser.username+':**\n\n'+content, priColors[priority]||'#22c55e'); discordSent++; } catch(e) {}
        }
        const db2=readDB(); if(db2.broadcasts&&db2.broadcasts[0]){db2.broadcasts[0].discordSent=discordSent;writeDB(db2);}
    }
    res.json({ success: true, sentTo: targets.length, discordSent });
});

// ════════════════════════════════════════════════════════════════════
// §20 — API BOT : MAINTENANCE & MATCH DISCORD
// ════════════════════════════════════════════════════════════════════

// ── API maintenance contrôlée par le bot Discord (Xywez uniquement) ──
app.post('/api/bot/maintenance', (req, res) => {
    const key = req.body?.apiKey || req.headers['x-api-key'];
    if (key !== PANEL_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
    const { enabled, discordId, message } = req.body;
    // Vérification Xywez uniquement
    if (discordId !== SUPER_ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Réservé à Xywez uniquement.' });
    }
    try {
        const db = readDB();
        if (!db.publicSettings) db.publicSettings = { ...DEFAULT_PUBLIC_SETTINGS };
        db.publicSettings.maintenanceMode = !!enabled;
        if (message) db.publicSettings.maintenanceMessage = message;
        writeDB(db);
        addLog(enabled ? '⚙️ Maintenance activée via Discord' : '✅ Maintenance désactivée via Discord', 'bot-xywez', 'system', { enabled }, '');
        console.log(`[BOT MAINTENANCE] ${enabled ? 'ACTIVÉE' : 'DÉSACTIVÉE'} par Xywez via Discord`);
        res.json({ success: true, maintenanceMode: !!enabled });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ── API : match vocale Discord créée par le bot → stocker l'ID ──
app.post('/api/match/voice-created', (req, res) => {
    const key = req.body?.apiKey || req.headers['x-api-key'];
    if (key !== PANEL_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
    const { matchId, vocChannelId, hoteRoleId, matchRoleId } = req.body;
    try {
        const db = readDB();
        const match = db.matches.find(m => m.id === matchId);
        if (!match) return res.json({ success: false, error: 'Match introuvable' });
        if (vocChannelId) match.vocDiscordId = vocChannelId;
        if (hoteRoleId) match.hoteRoleDiscordId = hoteRoleId;
        if (matchRoleId) match.roleDiscordId = matchRoleId;
        writeDB(db);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ════════════════════════════════════════════════════════════════════
// §21 — DÉMARRAGE DU SERVEUR & HONEYPOTS ANTI-SCANNER
// ════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log('[FTY CLUB PRO V5] Serveur demarre sur port ' + PORT);
    console.log('  Panel: /panel/login | Maintenance: /panel/owner/maintenance');

    // ── AUTO-MAINTENANCE AU DÉMARRAGE ──────────────────────────────────
    try {
        const db = readDB();
        if (!db.publicSettings) db.publicSettings = { ...DEFAULT_PUBLIC_SETTINGS };
        db.publicSettings.maintenanceMode = true;
        db.publicSettings.maintenanceMessage = 'Le site est en cours de démarrage / maintenance. Revenez bientôt !';
        writeDB(db);
        console.log('[FTY CLUB PRO V5] ⚙️ Mode maintenance ACTIVÉ automatiquement au démarrage');
        console.log('[FTY CLUB PRO V5] → Utilisez /maintenance sur Discord (Xywez uniquement) pour désactiver');
    } catch(e) {
        console.error('[FTY CLUB PRO V5] Erreur activation maintenance:', e.message);
    }
    
    // ── Routes honeypot anti-DDoS/scanner ──
    // Ces routes n'existent pas réellement — tout bot qui les visite est blacklisté
    const honeypotRoutes = ['/wp-admin','/wp-login.php','/.env','/config.php','/admin/config',
        '/phpMyAdmin','/shell.php','/eval.php','/xmlrpc.php','/.git/config',
        '/server-status','/.htaccess','/cgi-bin/php'];
    honeypotRoutes.forEach(route => {
        app.all(route, (req, res) => {
            const ip = getClientIP(req);
            if (ip !== XYWEZ_IP && !req.isXywez) {
                DDOS_BLACKLIST.add(ip);
                console.warn(`[Honeypot] Scanner blacklisté: ${ip} → ${route}`);
                addLog('🍯 Honeypot Hit', ip, route, { method: req.method, ua: req.headers['user-agent'] }, ip);
            }
            res.status(404).send('Not found');
        });
    });
});
