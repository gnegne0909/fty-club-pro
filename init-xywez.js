// init-xywez.js - Script pour créer le compte owner xywez
// Lance ce fichier UNE SEULE FOIS : node init-xywez.js

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');
const XYWEZ_DISCORD_ID = '969065205067825222';

// Lire ou créer la DB
function readDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        users: [],
        logs: [],
        sanctions: [],
        tickets: [],
        matches: [],
        compositions: [],
        candidatures: [],
        communiques: [],
        serverConfig: {},
        accountChecks: []
    };
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Initialiser xywez
console.log('🔧 Initialisation du compte owner xywez...\n');

const db = readDB();

// Chercher si xywez existe déjà
let xyweUser = db.users.find(u => u.discordId === XYWEZ_DISCORD_ID);

if (xyweUser) {
    console.log('✅ Compte xywez trouvé dans la DB');
    console.log(`   Username: ${xyweUser.username}`);
    console.log(`   Rôle actuel: ${xyweUser.accountType}`);
    
    // Mettre à jour le rôle en owner
    if (xyweUser.accountType !== 'owner') {
        xyweUser.accountType = 'owner';
        xyweUser.roles = ['owner'];
        console.log('   🔄 Rôle mis à jour → owner');
    } else {
        console.log('   ✅ Déjà owner !');
    }
} else {
    console.log('📝 Création du compte xywez...');
    
    // Créer le compte xywez
    xyweUser = {
        id: Date.now().toString(),
        username: 'xywez',
        discordId: XYWEZ_DISCORD_ID,
        accountType: 'owner',
        roles: ['owner'],
        email: 'xywez@fty.club',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
    };
    
    db.users.push(xyweUser);
    console.log('✅ Compte créé !');
}

// Sauvegarder
writeDB(db);

console.log('\n✅ SUCCÈS ! Ton compte xywez est configuré en owner.');
console.log('\n📋 Informations du compte :');
console.log(`   Discord ID: ${xyweUser.discordId}`);
console.log(`   Username: ${xyweUser.username}`);
console.log(`   Rôle: ${xyweUser.accountType}`);
console.log('\n🎯 Tu peux maintenant :');
console.log('   1. Te connecter au panel avec Discord OAuth');
console.log('   2. Accéder à /panel/bot-config');
console.log('   3. Accéder à /panel/system');
console.log('   4. Gérer tous les aspects du panel\n');
