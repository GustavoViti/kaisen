// ============================================================
// SUBSTITUA os valores abaixo pelas suas credenciais Firebase
// Console: https://console.firebase.google.com
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ── Auth ──────────────────────────────────────────────────────

export function getCurrentUser() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => { unsub(); resolve(user); }, reject);
  });
}

export function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function requireAuth(onAuthed, onUnauthed) {
  const user = await getCurrentUser();
  if (user) onAuthed(user);
  else onUnauthed();
}

const AUTH_ERRORS = {
  'auth/popup-closed-by-user':    'Login cancelado. Tente novamente.',
  'auth/cancelled-popup-request': 'Login cancelado.',
  'auth/popup-blocked':           'Popup bloqueado. Permita popups e tente novamente.',
  'auth/network-request-failed':  'Sem conexão. Verifique sua internet.',
  'auth/too-many-requests':       'Muitas tentativas. Aguarde um momento.',
  'auth/user-disabled':           'Esta conta foi desativada.',
  'auth/account-exists-with-different-credential': 'Conta já existe com outro método.',
};

export function getAuthErrorMessage(error) {
  return AUTH_ERRORS[error?.code] ?? 'Erro ao fazer login. Tente novamente.';
}

// ── User profile ──────────────────────────────────────────────

export async function getOrCreateProfile(user) {
  const ref  = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const profile = {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    xp: 0,
    level: 1,
    streak: 0,
    lastActiveDate: null,
    createdAt: serverTimestamp()
  };
  await setDoc(ref, profile);
  return profile;
}

export function updateProfile(uid, data) {
  return updateDoc(doc(db, 'users', uid), data);
}

/** Listener em tempo real para o perfil do usuário. Retorna unsubscribe. */
export function subscribeToProfile(uid, callback) {
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

// ── Habits ────────────────────────────────────────────────────

const DEFAULT_HABITS = [
  { name: 'Postar Vídeos',    icon: '🎬', xp: 50, category: 'conteudo' },
  { name: 'Programar',        icon: '💻', xp: 40, category: 'estudo'   },
  { name: 'Treinar',          icon: '🏋️', xp: 35, category: 'fitness'  },
  { name: 'Vendas SaaS',      icon: '💼', xp: 60, category: 'financas' },
  { name: 'Dormir no Horário',icon: '😴', xp: 25, category: 'saude'    },
];

/** Popula os 5 hábitos padrão apenas no primeiro login (sem hábitos existentes). */
export async function seedDefaultHabits(uid) {
  const snap = await getDocs(query(collection(db, 'habits'), where('uid', '==', uid)));
  if (!snap.empty) return;
  for (const h of DEFAULT_HABITS) {
    await addDoc(collection(db, 'habits'), {
      uid,
      ...h,
      completedDates: [],
      createdAt: serverTimestamp()
    });
  }
}

export async function getHabits(uid) {
  const q    = query(collection(db, 'habits'), where('uid', '==', uid), orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Listener em tempo real para a coleção de hábitos. Retorna unsubscribe. */
export function subscribeToHabits(uid, callback) {
  const q = query(collection(db, 'habits'), where('uid', '==', uid), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function addHabit(uid, habit) {
  return addDoc(collection(db, 'habits'), {
    uid,
    ...habit,
    completedDates: [],
    createdAt: serverTimestamp()
  });
}

export function deleteHabit(habitId) {
  return deleteDoc(doc(db, 'habits', habitId));
}

/**
 * Alterna o estado de conclusão do hábito hoje.
 * Usa o XP do próprio hábito (habit.xp), não mais valor fixo.
 * Retorna { done, xp, level, xpAmount, completedDates }.
 */
export async function toggleHabitToday(uid, habit) {
  const today   = new Date().toISOString().split('T')[0];
  const ref     = doc(db, 'habits', habit.id);
  const dates   = habit.completedDates || [];
  const done    = dates.includes(today);
  const updated = done ? dates.filter((d) => d !== today) : [...dates, today];

  await updateDoc(ref, { completedDates: updated });

  const xpAmount = habit.xp || 20;
  const userRef  = doc(db, 'users', uid);
  const userData = (await getDoc(userRef)).data();
  const newXp    = Math.max(0, (userData.xp || 0) + (done ? -xpAmount : xpAmount));
  const newLevel = Math.floor(newXp / 200) + 1;
  await updateDoc(userRef, { xp: newXp, level: newLevel });

  return { done: !done, xp: newXp, level: newLevel, xpAmount, completedDates: updated };
}
