# Binders

## Cloud sync (Google sign-in)

The collection syncs across devices through Firebase. One-time setup:

1. Go to https://console.firebase.google.com and create a project (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Authentication → Settings → Authorized domains:** add the domain the app is hosted on (e.g. `yourname.github.io`).
4. **Build → Firestore Database → Create database** (production mode, any region).
5. **Firestore → Rules:** paste the contents of `firestore.rules` and publish.
6. **Project settings → Your apps → Web (`</>`):** register an app and copy `apiKey`, `authDomain`, `projectId`, `appId` into `firebase-config.js`.

Then open ⚙︎ in the app and tap **Sign in with Google** on each device. Without a config, the app works as before (this device only).
