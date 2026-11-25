// Cloud sync: Google sign-in (Firebase Auth) + one Firestore document per user holding the collection.
import { firebaseConfig } from './firebase-config.js';

const V = '10.14.1', CDN = `https://www.gstatic.com/firebasejs/${V}`;
const $ = id => document.getElementById(id);
const app = window.pbApp;
const ui = (text, signedIn) => {
  $('acct').textContent = text;
  $('gin').hidden = !!signedIn;
  $('gout').hidden = !signedIn;
};

if (!firebaseConfig.apiKey) {
  ui('Cloud sync is not set up yet (add your Firebase config to firebase-config.js).');
  $('gin').disabled = true;
} else {
  start().catch(e => { console.error(e); ui('Cloud sync is unavailable right now (offline?).'); });
}

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`)
  ]);
  const fb = initializeApp(firebaseConfig);
  const auth = A.getAuth(fb);
  const db = F.initializeFirestore(fb, { localCache: F.persistentLocalCache() });
  const provider = new A.GoogleAuthProvider();

  // Popup works everywhere except where it is blocked (some home-screen apps); fall back to a redirect there.
  $('gin').onclick = async () => {
    try { await A.signInWithPopup(auth, provider); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code))
        return A.signInWithRedirect(auth, provider);
      if (e.code !== 'auth/popup-closed-by-user') app.toast('Sign-in failed: ' + (e.code || e.message));
    }
  };
  $('gout').onclick = () => A.signOut(auth);
  A.getRedirectResult(auth).catch(e => app.toast('Sign-in failed: ' + (e.code || e.message)));

  let ref = null, ready = false, unsub = null, pushT = null;

  const push = col => {
    if (!ref || !ready) return;
    clearTimeout(pushT);
    app.note('Syncing…');
    pushT = setTimeout(() => {
      F.setDoc(ref, { col: JSON.stringify(col), updated: F.serverTimestamp() })
        .then(() => app.note('Synced to your Google account ✓'))
        .catch(() => app.note('Saved on this device – will sync when online'));
    }, 600);
  };
  window.pbSync = push;

  A.onAuthStateChanged(auth, async user => {
    if (unsub) { unsub(); unsub = null; }
    ready = false; ref = null;
    if (!user) { ui('Sign in with Google to keep your collection in sync across all your devices.'); app.note('Saved on this device'); return; }

    ui(`Signed in as ${user.email || user.displayName}. Your collection syncs automatically.`, true);
    ref = F.doc(db, 'users', user.uid);

    // First sync on this device: merge local + cloud so nothing is lost (cloud wins for the same Pokémon).
    try {
      const snap = await F.getDoc(ref);
      const cloud = snap.exists() ? JSON.parse(snap.data().col || '{}') : {};
      const merged = Object.assign({}, app.col(), cloud);
      app.load(merged);
      ready = true;
      if (JSON.stringify(merged) !== JSON.stringify(cloud)) push(merged);
      else app.note('Synced to your Google account ✓');
    } catch (e) {
      console.error(e); app.note('Saved on this device – cloud sync failed'); return;
    }

    // Live updates from your other devices.
    unsub = F.onSnapshot(ref, snap => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const raw = snap.data().col || '{}';
      if (raw !== JSON.stringify(app.col())) { app.load(JSON.parse(raw)); app.note('Synced to your Google account ✓'); }
    });
  });
}
