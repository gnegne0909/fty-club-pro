# 🚀 GUIDE DE DÉPLOIEMENT RENDER.COM

## 📝 Étape 1 : Créer un Compte Discord Developer

1. Allez sur https://discord.com/developers/applications
2. Cliquez sur "New Application"
3. Nommez votre application "FTY Club"
4. Allez dans "OAuth2" → "General"
5. Notez votre **CLIENT ID** et **CLIENT SECRET**
6. Dans "Redirects", ajoutez : `https://VOTRE-APP.onrender.com/auth/discord/callback`
   (Vous ajouterez l'URL exacte après le déploiement)

---

## 🌐 Étape 2 : Créer un Compte Render

1. Allez sur https://render.com
2. Cliquez sur "Get Started for Free"
3. Inscrivez-vous avec Google ou Email

---

## 📤 Étape 3 : Uploader Votre Code

### Option A : Via GitHub/GitLab (Recommandé)

1. Créez un dépôt sur GitHub
2. Uploadez tous les fichiers :
   - `fty-club-pro.js`
   - `package.json`
   - `.gitignore`
   - `README.md`

### Option B : Via Git Direct

```bash
# Dans le dossier de votre projet
git init
git add .
git commit -m "Initial commit - FTY Club"
# Puis connectez à GitHub
```

---

## 🔧 Étape 4 : Déployer sur Render

1. Sur Render Dashboard, cliquez **"New +"** → **"Web Service"**

2. Connectez votre dépôt GitHub/GitLab

3. Configurez :
   - **Name**: `fty-club-pro` (ou votre choix)
   - **Region**: Frankfurt (Europe) ou Oregon (US)
   - **Branch**: main
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

4. Cliquez sur **"Advanced"** et ajoutez les variables d'environnement :

```
DISCORD_CLIENT_ID = votre_client_id_ici
DISCORD_CLIENT_SECRET = votre_secret_ici
DISCORD_REDIRECT_URI = https://fty-club-pro.onrender.com/auth/discord/callback
PORT = 3000
```

5. Cliquez **"Create Web Service"**

---

## ⏱️ Étape 5 : Attendre le Déploiement

- Le déploiement prend 2-5 minutes
- Vous verrez les logs en temps réel
- Une fois terminé, vous obtiendrez votre URL : `https://VOTRE-APP.onrender.com`

---

## 🔗 Étape 6 : Mettre à Jour Discord OAuth

1. Retournez sur Discord Developer Portal
2. Dans OAuth2 → Redirects, ajoutez votre URL Render :
   `https://VOTRE-APP.onrender.com/auth/discord/callback`
3. Sauvegardez

---

## ✅ Étape 7 : Tester Votre Application

1. Visitez `https://VOTRE-APP.onrender.com`
2. Testez le login : `/panel/login`
3. Connectez Discord : `/auth/discord`

---

## 🎯 Compte Owner par Défaut

**Username**: xywez
**Password**: Vous devrez le créer lors de la première connexion

---

## 🔄 Redéploiement Automatique

Render redéploie automatiquement à chaque nouveau commit sur votre dépôt GitHub !

---

## 🆘 Problèmes Courants

### L'app ne démarre pas
- Vérifiez les logs sur Render Dashboard
- Vérifiez que toutes les variables d'environnement sont définies

### Discord OAuth ne fonctionne pas
- Vérifiez que l'URL de redirection est exactement la même
- Vérifiez CLIENT_ID et CLIENT_SECRET

### L'app se met en veille
- Normal sur le plan gratuit après 15 min d'inactivité
- Elle redémarre automatiquement à la prochaine visite

---

## 📊 Monitoring

- **Logs** : Render Dashboard → Logs
- **Métriques** : Render Dashboard → Metrics
- **Redémarrer** : Settings → Manual Deploy

---

## 💡 Conseils

1. **Base de données** : Sur Render gratuit, la DB sera réinitialisée tous les mois
   - Pour persister les données, upgrader vers un plan payant
   - Ou utilisez une DB externe gratuite (MongoDB Atlas, etc.)

2. **Performance** : Le plan gratuit a des limites
   - 512 MB RAM
   - CPU partagé
   - Suffisant pour petits projets

3. **SSL** : Certificat HTTPS automatique et gratuit !

---

## 🎉 Terminé !

Votre application FTY Club est maintenant en ligne avec un lien permanent !

**URL publique** : https://VOTRE-APP.onrender.com
**Panel admin** : https://VOTRE-APP.onrender.com/panel

---

## 📞 Support

En cas de problème, vérifiez :
1. Les logs Render
2. Les variables d'environnement
3. La configuration Discord OAuth

Bonne chance ! ⚽🚀
