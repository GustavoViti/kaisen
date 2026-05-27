// ============================================================
// SUBSTITUA os valores abaixo pelas suas credenciais Firebase
// Console: https://console.firebase.google.com
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  apiKey: "AIzaSyB0WIHyCtPyndl8SDHbM23cXCXXDgRb9UA",
  authDomain: "kaisen-ec30a.firebaseapp.com",
  projectId: "kaisen-ec30a",
  storageBucket: "kaisen-ec30a.firebasestorage.app",
  messagingSenderId: "732869224381",
  appId: "1:732869224381:web:425650f07bc7cfaacc14d4",
  measurementId: "G-13GQTM4CJ4"
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

export function loginWithEmailAndPassword(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function registerWithEmailAndPassword(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
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
  'auth/popup-closed-by-user':                    'Login cancelado. Tente novamente.',
  'auth/cancelled-popup-request':                 'Login cancelado.',
  'auth/popup-blocked':                           'Popup bloqueado. Permita popups e tente novamente.',
  'auth/network-request-failed':                  'Sem conexão. Verifique sua internet.',
  'auth/too-many-requests':                       'Muitas tentativas. Aguarde um momento.',
  'auth/user-disabled':                           'Esta conta foi desativada.',
  'auth/account-exists-with-different-credential': 'Conta já existe com outro método.',
  'auth/unauthorized-domain':                     'O domínio não está autorizado no Firebase Auth.',
  'auth/operation-not-supported-in-this-environment': 'Operação não suportada neste ambiente.',
  'auth/invalid-credential':                      'Credenciais inválidas. Tente novamente.',
  'auth/credential-already-in-use':               'Esta credencial já está associada a outra conta.',
  'auth/invalid-email':                           'E-mail inválido.',
  'auth/user-not-found':                          'Usuário não encontrado.',
  'auth/email-already-in-use':                    'Este e-mail já está em uso.',
  'auth/wrong-password':                          'Senha incorreta. Verifique e tente novamente.',
  'auth/weak-password':                           'Senha fraca. Informe pelo menos 6 caracteres.',
  'auth/missing-email':                           'Informe um e-mail válido.',
};

export function getAuthErrorMessage(error) {
  if (!error) return 'Erro ao fazer login. Tente novamente.';
  return AUTH_ERRORS[error.code] ?? `${AUTH_ERRORS[error.code] || 'Erro ao fazer login. Tente novamente.'} (${error.code})`;
}

// ── XP / Level system ─────────────────────────────────────────

/**
 * XP necessário para avançar do nível `level` para `level + 1`.
 *   Nível 1 → 2 : 100 XP
 *   Nível 2 → 3 : 150 XP
 *   Nível 3 → 4 : 200 XP  (+50 a cada nível)
 */
export function xpForNextLevel(level) {
  return 100 + (level - 1) * 50;
}

/**
 * Dado o XP total acumulado, calcula:
 *   level      — nível atual
 *   xpInLevel  — XP acumulado dentro do nível corrente
 *   xpNeeded   — XP total necessário para subir ao próximo nível
 */
export function calcLevel(totalXp) {
  let level     = 1;
  let remaining = Math.max(0, totalXp);
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
  }
  return { level, xpInLevel: remaining, xpNeeded: xpForNextLevel(level) };
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

  const xpAmount       = habit.xp || 20;
  const userRef        = doc(db, 'users', uid);
  const userData       = (await getDoc(userRef)).data();
  const newXp          = Math.max(0, (userData.xp || 0) + (done ? -xpAmount : xpAmount));
  const { level: newLevel } = calcLevel(newXp);
  await updateDoc(userRef, { xp: newXp, level: newLevel });

  return { done: !done, xp: newXp, level: newLevel, xpAmount, completedDates: updated };
}
