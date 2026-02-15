const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Discord OAuth
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'YOUR_CLIENT_ID';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/discord/callback`;
const PANEL_API_SECRET = process.env.PANEL_API_SECRET || 'fty-bot-secret-2026';

// ID Discord de xywez (seul autorisé pour gérer les owners)
const SUPER_ADMIN_DISCORD_ID = '969065205067825222';

// URL DU BOT pour webhooks
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || 'http://localhost:3001';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'fty-club-ultra-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const DB_FILE = path.join(__dirname, 'database.json');
const BOT_STATUS_FILE = path.join(__dirname, 'bot-status.json');

function readDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        users: [], logs: [], sanctions: [], tickets: [], matches: [],
        compositions: [], candidatures: [], communiques: [], serverConfig: {}, accountChecks: []
    };
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function readBotStatus() {
    try {
        if (fs.existsSync(BOT_STATUS_FILE)) {
            return JSON.parse(fs.readFileSync(BOT_STATUS_FILE, 'utf8'));
        }
    } catch (e) {}
    return null;
}

function writeBotStatus(data) {
    try {
        fs.writeFileSync(BOT_STATUS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
}

function isBotOnline(status) {
    if (!status || !status.lastHeartbeat) return false;
    const diff = (Date.now() - new Date(status.lastHeartbeat).getTime()) / 1000;
    return diff < 30;
}

const HIERARCHY = {
    'owner': 9, 'fondateur': 8, 'cofondateur': 7, 'manager': 6,
    'administrateur': 5, 'moderateur': 4, 'support': 3, 'capitaine': 2, 'joueur': 1
};

function getUserRole(user) {
    if (user.roles) {
        for (const role of Object.keys(HIERARCHY).sort((a, b) => HIERARCHY[b] - HIERARCHY[a])) {
            if (user.roles.includes(role)) return role;
        }
    }
    return 'joueur';
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/');
    }
    next();
}

function requireRole(minRole) {
    return (req, res, next) => {
        if (!req.session.user) return res.redirect('/');
        const userRole = getUserRole(req.session.user);
        if (HIERARCHY[userRole] < HIERARCHY[minRole]) {
            return res.status(403).send('❌ Permission insuffisante');
        }
        next();
    };
}

function requireSuperAdmin(req, res, next) {
    if (!req.session.user || req.session.user.id !== SUPER_ADMIN_DISCORD_ID) {
        return res.status(403).send('❌ Réservé à xywez uniquement');
    }
    next();
}

// Routes Auth Discord
app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code,
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
        let user = db.users.find(u => u.id === discordUser.id);

        if (!user) {
            user = {
                id: discordUser.id,
                username: discordUser.username,
                discriminator: discordUser.discriminator,
                avatar: discordUser.avatar,
                roles: ['joueur'],
                joinedAt: new Date().toISOString()
            };
            db.users.push(user);
            writeDB(db);
        }

        req.session.user = user;
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Erreur OAuth:', error);
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// API: Heartbeat du bot
app.post('/api/bot/heartbeat', (req, res) => {
    const { secret } = req.body;
    if (secret !== PANEL_API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const botStatus = {
        ...req.body,
        lastHeartbeat: new Date().toISOString()
    };
    writeBotStatus(botStatus);
    res.json({ status: 'ok' });
});

// Page d'accueil
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }

    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>FTY Club Pro - Panel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            padding: 40px 30px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
            width: 100%;
        }
        
        h1 {
            font-size: 2rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        p {
            color: #666;
            margin-bottom: 30px;
            font-size: 0.95rem;
        }
        
        .login-btn {
            background: #5865F2;
            color: white;
            padding: 15px 30px;
            border-radius: 10px;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-weight: 600;
            transition: all 0.3s;
            border: none;
            font-size: 1rem;
            cursor: pointer;
        }
        
        .login-btn:hover {
            background: #4752C4;
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(88,101,242,0.3);
        }
        
        @media (max-width: 480px) {
            .container { padding: 30px 20px; }
            h1 { font-size: 1.75rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 FTY Club Pro</h1>
        <p>Panel de gestion du club e-sport</p>
        <a href="/auth/discord" class="login-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515a.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0a12.64 12.64 0 00-.617-1.25a.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057a19.9 19.9 0 005.993 3.03a.078.078 0 00.084-.028a14.09 14.09 0 001.226-1.994a.076.076 0 00-.041-.106a13.107 13.107 0 01-1.872-.892a.077.077 0 01-.008-.128a10.2 10.2 0 00.372-.292a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127a12.299 12.299 0 01-1.873.892a.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028a19.839 19.839 0 006.002-3.03a.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Se connecter avec Discord
        </a>
    </div>
</body>
</html>
    `);
});

// Dashboard
app.get('/dashboard', requireAuth, (req, res) => {
    const userRole = getUserRole(req.session.user);
    const botStatus = readBotStatus();
    const botOnline = isBotOnline(botStatus);
    const db = readDB();
    
    const isSuperAdmin = req.session.user.id === SUPER_ADMIN_DISCORD_ID;

    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Dashboard - FTY Club Pro</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #0f0f23;
            color: #fff;
            min-height: 100vh;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }
        
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
        }
        
        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255,255,255,0.1);
            padding: 8px 15px;
            border-radius: 50px;
        }
        
        .avatar {
            width: 35px;
            height: 35px;
            border-radius: 50%;
            border: 2px solid white;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .bot-status {
            background: ${botOnline ? 'linear-gradient(135deg, #00d4aa 0%, #00a080 100%)' : 'linear-gradient(135deg, #ff4444 0%, #cc0000 100%)'};
            padding: 15px 20px;
            border-radius: 15px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 600;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .card {
            background: #1a1a2e;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        }
        
        .card h3 {
            font-size: 1.25rem;
            margin-bottom: 15px;
            color: #667eea;
        }
        
        .stat {
            font-size: 2.5rem;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .btn {
            display: inline-block;
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 10px;
            font-weight: 600;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
            margin: 5px;
            font-size: 0.95rem;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102,126,234,0.3);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
        }
        
        .textarea {
            width: 100%;
            min-height: 120px;
            padding: 12px;
            background: #0f0f23;
            border: 2px solid #667eea;
            border-radius: 10px;
            color: white;
            font-family: inherit;
            font-size: 0.95rem;
            resize: vertical;
        }
        
        .input {
            width: 100%;
            padding: 12px;
            background: #0f0f23;
            border: 2px solid #667eea;
            border-radius: 10px;
            color: white;
            font-family: inherit;
            font-size: 0.95rem;
            margin-bottom: 10px;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #667eea;
            font-weight: 600;
        }
        
        @media (max-width: 768px) {
            .grid {
                grid-template-columns: 1fr;
            }
            
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .container {
                padding: 15px;
            }
            
            .stat {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="logo">🎮 FTY Club Pro</div>
            <div class="user-info">
                <img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" class="avatar" alt="${req.session.user.username}">
                <span>${req.session.user.username}</span>
                <a href="/logout" style="color: white; margin-left: 10px; text-decoration: none;">🚪</a>
            </div>
        </div>
    </div>
    
    <div class="container">
        <div class="bot-status">
            <span style="font-size: 1.5rem;">${botOnline ? '🟢' : '🔴'}</span>
            Bot Discord : ${botOnline ? 'En ligne' : 'Hors ligne'}
        </div>
        
        <div class="grid">
            <div class="card">
                <h3>👥 Membres</h3>
                <div class="stat">${db.users.length}</div>
            </div>
            
            <div class="card">
                <h3>⚽ Matchs</h3>
                <div class="stat">${db.matches.length}</div>
            </div>
            
            <div class="card">
                <h3>🎫 Tickets</h3>
                <div class="stat">${db.tickets.filter(t => t.status === 'open').length}</div>
            </div>
            
            <div class="card">
                <h3>📋 Logs</h3>
                <div class="stat">${db.logs.length}</div>
            </div>
        </div>
        
        ${HIERARCHY[userRole] >= HIERARCHY['support'] ? `
        <div class="card" style="margin-bottom: 20px;">
            <h3>⚽ Publier une Composition</h3>
            <form action="/api/composition" method="POST">
                <div class="form-group">
                    <label>Match</label>
                    <input type="text" name="match" class="input" placeholder="Ex: FTY vs Real Madrid" required>
                </div>
                <div class="form-group">
                    <label>Composition</label>
                    <textarea name="composition" class="textarea" placeholder="Ex: Gardien: Tom
Défense: ...
Milieu: ...
Attaque: ..." required></textarea>
                </div>
                <button type="submit" class="btn">📤 Publier sur Discord</button>
            </form>
        </div>
        
        <div class="card" style="margin-bottom: 20px;">
            <h3>📢 Publier une Annonce</h3>
            <form action="/api/annonce" method="POST">
                <div class="form-group">
                    <label>Titre</label>
                    <input type="text" name="title" class="input" placeholder="Ex: Nouveau tournoi" required>
                </div>
                <div class="form-group">
                    <label>Message</label>
                    <textarea name="message" class="textarea" placeholder="Votre annonce..." required></textarea>
                </div>
                <button type="submit" class="btn">📤 Publier sur Discord</button>
            </form>
        </div>
        ` : ''}
        
        ${isSuperAdmin ? `
        <div class="card">
            <h3>👑 Gestion Owners (xywez uniquement)</h3>
            <p style="margin-bottom: 15px; color: #999;">Seul xywez peut gérer les owners</p>
            <a href="/admin/owners" class="btn">🔧 Gérer les Owners</a>
        </div>
        ` : ''}
    </div>
</body>
</html>
    `);
});

// API Composition
app.post('/api/composition', requireAuth, requireRole('support'), async (req, res) => {
    const { composition, match } = req.body;
    
    const db = readDB();
    db.compositions.push({
        id: Date.now().toString(),
        composition,
        match,
        moderator: req.session.user.username,
        timestamp: new Date().toISOString()
    });
    writeDB(db);
    
    // Envoyer au bot via webhook
    try {
        await axios.post(`${BOT_WEBHOOK_URL}/webhook/composition`, {
            secret: PANEL_API_SECRET,
            composition,
            match,
            moderator: req.session.user.username
        });
    } catch (e) {
        console.error('Erreur webhook composition:', e);
    }
    
    res.send('<script>alert("✅ Composition publiée sur Discord !"); window.location="/dashboard";</script>');
});

// API Annonce
app.post('/api/annonce', requireAuth, requireRole('support'), async (req, res) => {
    const { title, message } = req.body;
    
    // Envoyer au bot via webhook
    try {
        await axios.post(`${BOT_WEBHOOK_URL}/webhook/annonce`, {
            secret: PANEL_API_SECRET,
            title,
            message,
            moderator: req.session.user.username
        });
    } catch (e) {
        console.error('Erreur webhook annonce:', e);
    }
    
    res.send('<script>alert("✅ Annonce publiée sur Discord !"); window.location="/dashboard";</script>');
});

// Page Owners (xywez uniquement)
app.get('/admin/owners', requireSuperAdmin, (req, res) => {
    const db = readDB();
    const owners = db.users.filter(u => u.roles.includes('owner'));
    
    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Gestion Owners - FTY</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f0f23;
            color: #fff;
            padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { margin-bottom: 30px; color: #667eea; }
        .card {
            background: #1a1a2e;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
        }
        .btn {
            padding: 10px 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            margin: 5px;
        }
        .btn-danger { background: #ff4444; }
        .user-item {
            padding: 15px;
            background: #0f0f23;
            border-radius: 10px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .input {
            width: 100%;
            padding: 12px;
            background: #0f0f23;
            border: 2px solid #667eea;
            border-radius: 10px;
            color: white;
            font-size: 0.95rem;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>👑 Gestion des Owners</h1>
        <a href="/dashboard" class="btn">← Retour</a>
        
        <div class="card">
            <h3 style="margin-bottom: 20px; color: #667eea;">Owners actuels</h3>
            ${owners.map(owner => `
                <div class="user-item">
                    <span>${owner.username}</span>
                    <form action="/admin/owners/remove" method="POST" style="display: inline;">
                        <input type="hidden" name="userId" value="${owner.id}">
                        <button class="btn btn-danger" onclick="return confirm('Retirer owner à ${owner.username} ?')">
                            ❌ Retirer
                        </button>
                    </form>
                </div>
            `).join('')}
        </div>
        
        <div class="card">
            <h3 style="margin-bottom: 20px; color: #667eea;">Ajouter un Owner</h3>
            <form action="/admin/owners/add" method="POST">
                <input type="text" name="userId" class="input" placeholder="ID Discord du membre" required>
                <button type="submit" class="btn">➕ Ajouter Owner</button>
            </form>
        </div>
    </div>
</body>
</html>
    `);
});

// Ajouter owner (xywez uniquement)
app.post('/admin/owners/add', requireSuperAdmin, (req, res) => {
    const { userId } = req.body;
    const db = readDB();
    
    const user = db.users.find(u => u.id === userId);
    if (!user) {
        return res.send('<script>alert("❌ Utilisateur introuvable"); window.location="/admin/owners";</script>');
    }
    
    if (!user.roles.includes('owner')) {
        user.roles.push('owner');
        writeDB(db);
    }
    
    res.send('<script>alert("✅ Owner ajouté !"); window.location="/admin/owners";</script>');
});

// Retirer owner (xywez uniquement)
app.post('/admin/owners/remove', requireSuperAdmin, (req, res) => {
    const { userId } = req.body;
    const db = readDB();
    
    const user = db.users.find(u => u.id === userId);
    if (user) {
        user.roles = user.roles.filter(r => r !== 'owner');
        writeDB(db);
    }
    
    res.send('<script>alert("✅ Owner retiré !"); window.location="/admin/owners";</script>');
});

app.listen(PORT, () => {
    console.log(`✅ Panel FTY démarré sur le port ${PORT}`);
});
