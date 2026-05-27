# Approtina – Setup

## 1. Firebase

1. Acesse https://console.firebase.google.com e crie um projeto.
2. Ative **Authentication → Google**.
3. Ative **Firestore Database** (modo de teste por enquanto).
4. Em *Configurações do projeto → Seus apps*, copie o `firebaseConfig`.
5. Cole os valores em `js/firebase.js`, substituindo os `"YOUR_*"`.

### Regras do Firestore

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /habits/{habitId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.uid;
    }
  }
}
```

## 2. Ícones

Abra `icons/generate-icons.html` no navegador, salve os canvases como:
- `icons/icon-192.png`
- `icons/icon-512.png`

## 3. Servir localmente

O service worker exige HTTPS ou `localhost`. Use um servidor local:

```bash
# Node.js
npx serve .

# Python
python -m http.server 8080
```

Depois acesse `http://localhost:5000/login.html` (ou a porta do seu servidor).

## 4. Deploy

Recomendado: **Firebase Hosting**

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # pasta pública: . (raiz)
firebase deploy
```
