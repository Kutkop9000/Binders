# Pokédex Binders

## Cloud sync (Google sign-in)

The collection syncs across devices through Firebase. One-time setup:

1. Go to https://console.firebase.google.com and create a project (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Authentication → Settings → Authorized domains:** add the domain the app is hosted on (e.g. `yourname.github.io`).
4. **Build → Firestore Database → Create database** (production mode, any region).
5. **Firestore → Rules:** paste the contents of `firestore.rules` and publish.
6. **Project settings → Your apps → Web (`</>`):** register an app and copy `apiKey`, `authDomain`, `projectId`, `appId` into `firebase-config.js`.

Signing in with Google is required: the app opens on a sign-in screen and shows your binders once you're signed in. Sign out from ⚙︎ (this clears the device; your data stays in your account).

## Licence

This app is licensed under the GNU General Public License v3.0 (see `LICENSE`).
The holo effects in `holo/` come from [pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) by Simon Goellner (GPL-3.0).
