// Google sign-in (required) via Firebase Auth + one Firestore document per user holding the collection.
import { firebaseConfig } from './firebase-config.js';

const V = '10.14.1', CDN = `https://www.gstatic.com/firebasejs/${V}`;
const $ = id => document.getElementById(id);
const app = window.pbApp;
// The app stays behind the sign-in screen until a Google account is signed in.
const gate = (msg, canSignIn) => {
  $('gate').hidden = false;
  $('gmsg').textContent = msg;
  $('gin').disabled = !canSignIn;
  $('gin').textContent = 'Sign in with Google';
};

if (!firebaseConfig.apiKey) {
  gate('Sign-in is not set up yet (add your Firebase config to firebase-config.js).', false);
} else {
  start().catch(e => {
    console.error(e);
    gate('Can’t reach Google sign-in right now. Check your connection and try again.', true);
    $('gin').textContent = 'Try again';
    $('gin').onclick = () => location.reload();
  });
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
  // Sign out: upload anything still waiting, then clear this device so the next account starts clean.
  $('gout').onclick = async () => {
    if (!confirm('Sign out? Your binders stay saved in your Google account.')) return;
    if (dirty) await write();
    await A.signOut(auth);
    app.loadCustoms({});
    app.load({ col: {}, binders: [], wants: {} });
  };
  gate('Checking your sign-in…', true);
  A.getRedirectResult(auth).catch(e => app.toast('Sign-in failed: ' + (e.code || e.message)));

  let ref = null, ready = false, unsub = null, unsubC = null, pushT = null, dirty = false;
  // Cards you added yourself (with photos) live in their own documents: users/{uid}/custom/{id}
  const cdoc = id => F.doc(ref, 'custom', id);
  window.pbSyncCustom = id => {
    if (!ref || !ready) return;
    const c = app.customs()[id];
    (c ? F.setDoc(cdoc(id), c) : F.deleteDoc(cdoc(id))).catch(e => console.warn('custom card sync', e.code || e));
  };
  async function syncCustoms() {
    try {
      const snap = await F.getDocs(F.collection(ref, 'custom')), cloud = {};
      snap.forEach(d => { cloud[d.id] = d.data(); });
      const local = app.customs();
      app.loadCustoms(Object.assign({}, local, cloud));
      Object.keys(local).filter(id => !cloud[id]).forEach(id => window.pbSyncCustom(id));
      unsubC = F.onSnapshot(F.collection(ref, 'custom'), s => {
        if (s.metadata.hasPendingWrites) return;
        const m = Object.assign({}, app.customs()); let changed = false;
        s.docChanges().forEach(x => {
          if (x.type === 'removed') { if (m[x.doc.id]) { delete m[x.doc.id]; changed = true; } }
          else if (JSON.stringify(m[x.doc.id]) !== JSON.stringify(x.doc.data())) { m[x.doc.id] = x.doc.data(); changed = true; }
        });
        if (changed) app.loadCustoms(m);
      }, e => console.warn('custom cards listener', e.code || e));
    } catch (e) {
      // Usually: the Firestore rules haven't been updated for custom cards yet. Everything else keeps syncing.
      console.warn('custom cards not synced', e.code || e);
    }
  }

  const write = () => {
    clearTimeout(pushT); dirty = false;
    const { col, binders, wants } = app.state();
    return F.setDoc(ref, { col: JSON.stringify(col), binders: JSON.stringify(binders), wants: JSON.stringify(wants || {}), updated: F.serverTimestamp() })
      .then(() => app.note('Synced to your Google account ✓'))
      .catch(() => app.note('Saved on this device – will sync when online'));
  };
  // Local change: upload shortly after (batches quick taps). Until then, incoming cloud updates don't overwrite it.
  const push = () => {
    if (!ref || !ready) return;
    dirty = true; clearTimeout(pushT); app.note('Syncing…');
    pushT = setTimeout(write, 600);
  };
  window.pbSync = push;

  A.onAuthStateChanged(auth, async user => {
    if (unsub) { unsub(); unsub = null; }
    if (unsubC) { unsubC(); unsubC = null; }
    ready = false; ref = null; dirty = false; clearTimeout(pushT);
    if (!user) { gate('Sign in with Google to use your binders. Your collection syncs across all your devices.', true); return; }

    $('gate').hidden = true;
    $('acct').textContent = `Signed in as ${user.email || user.displayName}. Your binders and collection sync automatically.`;
    $('gout').hidden = false;
    ref = F.doc(db, 'users', user.uid);

    // First sync on this device: merge local + cloud so nothing is lost.
    // Cards: cloud wins for the same Pokémon. Binders: the account's layouts, plus any local binders it doesn't have yet.
    try {
      const snap = await F.getDoc(ref), d = snap.exists() ? snap.data() : {};
      const cloudCol = JSON.parse(d.col || '{}'), cloudBinders = JSON.parse(d.binders || '[]'), cloudWants = JSON.parse(d.wants || '{}');
      const local = app.state();
      const col = Object.assign({}, local.col, cloudCol);
      const binders = cloudBinders.concat(local.binders.filter(b => !cloudBinders.some(c => c.id === b.id)));
      const wants = Object.assign({}, local.wants, cloudWants);   // want list: both devices' wants
      app.load({ col, binders, wants });
      ready = true;
      const now = app.state();
      if (JSON.stringify(now.col) !== (d.col || '{}') || JSON.stringify(now.binders) !== (d.binders || '[]') || JSON.stringify(now.wants) !== (d.wants || '{}')) write(); // applied to the local cache at once, so the listener below sees it as a pending write
      else app.note('Synced to your Google account ✓');
    } catch (e) {
      console.error(e); app.note('Saved on this device – cloud sync failed'); return;
    }

    // Live updates from your other devices (started after the merge is uploaded, so it can't be overwritten by the old copy).
    unsub = F.onSnapshot(ref, snap => {
      if (!snap.exists() || snap.metadata.hasPendingWrites || dirty) return;
      const d = snap.data(), st = app.state();
      const c = d.col ?? JSON.stringify(st.col), b = d.binders ?? JSON.stringify(st.binders), w = d.wants ?? JSON.stringify(st.wants);
      if (c !== JSON.stringify(st.col) || b !== JSON.stringify(st.binders) || w !== JSON.stringify(st.wants)) {
        app.load({ col: JSON.parse(c), binders: JSON.parse(b), wants: JSON.parse(w) });
        app.note('Synced to your Google account ✓');
      }
    });
    syncCustoms();
  });
}
