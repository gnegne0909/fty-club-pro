# ✅ CHECKLIST DÉPLOIEMENT RAPIDE

## 🎯 AVANT DE COMMENCER

- [ ] Créer un compte Discord Developer (https://discord.com/developers/applications)
- [ ] Créer un compte Render.com (https://render.com)
- [ ] Créer un compte GitHub (https://github.com) - OPTIONNEL mais recommandé

---

## 📋 ÉTAPES À SUIVRE

### 1️⃣ Discord Developer Portal
- [ ] Créer une application "FTY Club"
- [ ] Noter le CLIENT ID
- [ ] Noter le CLIENT SECRET
- [ ] Laisser la Redirect URI vide pour l'instant

### 2️⃣ GitHub (Recommandé)
- [ ] Créer un nouveau repository "fty-club-pro"
- [ ] Uploader tous les fichiers de ce dossier
- [ ] Faire un commit initial

### 3️⃣ Render.com
- [ ] Créer un compte
- [ ] New + → Web Service
- [ ] Connecter le dépôt GitHub
- [ ] Configurer :
  - Name: fty-club-pro
  - Build: `npm install`
  - Start: `npm start`
  - Plan: FREE

### 4️⃣ Variables d'Environnement sur Render
- [ ] DISCORD_CLIENT_ID = [votre client id]
- [ ] DISCORD_CLIENT_SECRET = [votre secret]
- [ ] DISCORD_REDIRECT_URI = https://VOTRE-APP.onrender.com/auth/discord/callback
- [ ] PORT = 3000

### 5️⃣ Créer le Web Service
- [ ] Cliquer "Create Web Service"
- [ ] Attendre 3-5 minutes
- [ ] Noter l'URL finale (ex: https://fty-club-pro.onrender.com)

### 6️⃣ Retour sur Discord Developer
- [ ] OAuth2 → Redirects
- [ ] Ajouter: https://VOTRE-APP.onrender.com/auth/discord/callback
- [ ] Sauvegarder

### 7️⃣ TESTER !
- [ ] Visiter https://VOTRE-APP.onrender.com
- [ ] Tester /panel/login
- [ ] Tester /auth/discord

---

## 🎉 C'EST EN LIGNE !

Votre lien permanent : **https://VOTRE-APP.onrender.com**

---

## ⚠️ IMPORTANT

**Temps d'inactivité** : Sur le plan gratuit, l'app se met en veille après 15 min sans visite.
Elle redémarre automatiquement à la prochaine visite (délai : ~30 secondes).

**Base de données** : Le fichier database.json sera réinitialisé chaque mois sur le plan gratuit.
Pour persister les données → upgrade vers un plan payant ou utiliser une DB externe.

---

## 💡 ALTERNATIVES À RENDER

Si vous préférez une autre plateforme :

1. **Railway.app** - Interface plus simple
2. **Fly.io** - Plus rapide mais config CLI
3. **Cyclic.sh** - Spécialisé Node.js
4. **Glitch.com** - Éditeur en ligne

Le processus est similaire !

---

Besoin d'aide ? Relisez le GUIDE-DEPLOIEMENT.md complet !
