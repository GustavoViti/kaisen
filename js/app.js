import {
  requireAuth,
  logout,
  getOrCreateProfile,
  updateProfile,
  calcLevel,
  seedDefaultHabits,
  subscribeToHabits,
  subscribeToProfile,
  addHabit,
  deleteHabit,
  toggleHabitToday
} from './firebase.js';
import { initCharts, updateCharts, destroyCharts } from './charts.js';

// ── State ─────────────────────────────────────────────────────
const state = {
  user:           null,
  profile:        null,
  habits:         [],
  unsubHabits:    null,
  unsubProfile:   null,
  profileReady:   false,   // evita falso level-up na primeira carga
};

// ── Boot ──────────────────────────────────────────────────────
requireAuth(
  async (user) => {
    state.user    = user;
    state.profile = await getOrCreateProfile(user);
    await updateStreak();
    await seedDefaultHabits(user.uid);

    // Perfil em tempo real (XP, level, streak)
    state.unsubProfile = subscribeToProfile(user.uid, async (profile) => {
      const { level: correctLevel } = calcLevel(profile.xp || 0);

      // Migração silenciosa: corrige level armazenado se a fórmula mudou
      if (profile.level !== correctLevel) {
        await updateProfile(user.uid, { level: correctLevel });
      }

      const prevLevel     = state.profile?.level;
      state.profile       = { ...profile, level: correctLevel };
      renderHeader();
      renderStats();
      if (state.profileReady && prevLevel && correctLevel > prevLevel) {
        celebrateLevelUp(correctLevel);
      }
      state.profileReady = true;
    });

    // Hábitos em tempo real
    state.unsubHabits = subscribeToHabits(user.uid, (habits) => {
      state.habits = habits;
      renderHabits();
      renderStats();
      updateCharts(habits);
    });

    hideAuthLoading();
    initCharts();
  },
  () => window.location.replace('login.html')
);

// ── Auth overlay ──────────────────────────────────────────────
function hideAuthLoading() {
  const el = document.getElementById('auth-loading');
  if (!el) return;
  el.classList.add('fade-out');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

// ── Streak diário ─────────────────────────────────────────────
async function updateStreak() {
  const p         = state.profile;
  const today     = todayStr();
  const yesterday = dateStr(Date.now() - 86400000);
  if (p.lastActiveDate === today) return;

  const newStreak = p.lastActiveDate === yesterday ? (p.streak || 0) + 1 : 1;
  await updateProfile(state.user.uid, { streak: newStreak, lastActiveDate: today });
  state.profile = { ...p, streak: newStreak, lastActiveDate: today };
}

// ── Render: header ────────────────────────────────────────────
function renderHeader() {
  const p = state.profile;
  document.getElementById('user-name').textContent   = p.displayName?.split(' ')[0] || 'Player';
  document.getElementById('user-avatar').src         = p.photoURL || 'assets/icone.png';
}

// ── Render: stats bar ─────────────────────────────────────────
function renderStats() {
  const p                        = state.profile || {};
  const totalXp                  = p.xp || 0;
  const { level, xpInLevel, xpNeeded } = calcLevel(totalXp);
  const pct                      = Math.round((xpInLevel / xpNeeded) * 100);
  const today                    = todayStr();
  const doneToday                = state.habits.filter((h) => h.completedDates?.includes(today)).length;

  // Stat cards
  setEl('stat-level',  level);
  setEl('stat-xp',     fmtNum(totalXp));
  setEl('stat-streak', p.streak || 0);
  setEl('stat-done',   `${doneToday}/${state.habits.length}`);

  // XP progress card
  const bar = document.getElementById('xp-bar');
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.closest('[role="progressbar"]')?.setAttribute('aria-valuenow', pct);
  }

  setEl('xp-level-num',   level);
  setEl('level-title',    getLevelTitle(level));
  setEl('xp-total-val',   fmtNum(totalXp));
  setEl('xp-label',       `${fmtNum(xpInLevel)} / ${fmtNum(xpNeeded)} XP`);
  setEl('xp-pct',         `${pct}%`);
  setEl('xp-remaining',   fmtNum(xpNeeded - xpInLevel));
  setEl('xp-next-level',  level + 1);
}

// ── Level titles ──────────────────────────────────────────────
const LEVEL_TITLES = [
  [2,  'Iniciante'],
  [5,  'Aventureiro'],
  [10, 'Guerreiro'],
  [15, 'Herói'],
  [20, 'Lendário'],
];

function getLevelTitle(level) {
  for (const [max, title] of LEVEL_TITLES) {
    if (level <= max) return title;
  }
  return 'Mestre';
}

// ── Helpers ───────────────────────────────────────────────────
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function fmtNum(n) {
  return Number(n).toLocaleString('pt-BR');
}

// ── Render: habit cards ───────────────────────────────────────
const CATEGORY_LABELS = {
  conteudo: 'Conteúdo', estudo: 'Estudo', fitness: 'Fitness',
  financas: 'Finanças', saude: 'Saúde',   lazer: 'Lazer', outros: 'Outros',
};

function renderHabits() {
  const today     = todayStr();
  const container = document.getElementById('habits-list');
  container.innerHTML = '';

  if (!state.habits.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🎮</span>
        <p>Nenhuma missão ainda.<br>Adicione seu primeiro desafio!</p>
      </div>`;
    return;
  }

  state.habits.forEach((habit) => {
    const done    = habit.completedDates?.includes(today);
    const streak  = calcStreak(habit.completedDates || []);
    const last7   = getLast7Days();
    const weekDone = last7.filter(({ date }) => habit.completedDates?.includes(date)).length;
    const weekPct  = Math.round((weekDone / 7) * 100);

    const weekDots = last7.map(({ date }, i) => {
      const isToday  = i === 6;
      const isDone   = habit.completedDates?.includes(date);
      return `<div class="hc-dot${isDone ? ' done' : ''}${isToday ? ' today' : ''}" title="${date}"></div>`;
    }).join('');

    const xp   = habit.xp || 20;
    const cat  = habit.category || 'outros';
    const card = document.createElement('div');
    card.className      = `habit-card${done ? ' is-done' : ''}`;
    card.dataset.habitId = habit.id;

    card.innerHTML = `
      <div class="hc-top">
        <div class="hc-icon">${habit.icon || '🎯'}</div>
        <div class="hc-body">
          <h3 class="hc-name">${escHtml(habit.name)}</h3>
          <div class="hc-meta">
            <span class="tag tag-${cat}">${CATEGORY_LABELS[cat] || cat}</span>
            <span class="hc-xp-badge">+${xp} XP</span>
          </div>
        </div>
        <div class="hc-streak">
          <span class="hc-streak-icon">${streak > 0 ? '🔥' : '💤'}</span>
          <span class="hc-streak-num">${streak}</span>
          <span class="hc-streak-lbl">streak</span>
        </div>
      </div>

      <div class="hc-week" aria-label="Últimos 7 dias">${weekDots}</div>

      <div class="hc-progress-row">
        <div class="hc-progress-track">
          <div class="hc-progress-fill" style="width:${weekPct}%"></div>
        </div>
        <span class="hc-progress-txt">${weekDone}/7 semana</span>
      </div>

      <div class="hc-actions">
        <button class="hc-complete-btn${done ? ' is-done' : ''}" data-id="${habit.id}"
          aria-label="${done ? 'Desmarcar' : 'Concluir hoje'}">
          ${done
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Concluído`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>Concluir hoje<strong>+${xp} XP</strong>`
          }
        </button>
        <button class="hc-delete-btn" data-id="${habit.id}" aria-label="Remover hábito">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;

    container.appendChild(card);
  });

  container.querySelectorAll('.hc-complete-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleToggle(btn.dataset.id, btn.closest('.habit-card')))
  );
  container.querySelectorAll('.hc-delete-btn').forEach((btn) =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.id))
  );
}

// ── Handlers ──────────────────────────────────────────────────
async function handleToggle(habitId, cardEl) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  const btn = cardEl?.querySelector('.hc-complete-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

  try {
    const result = await toggleHabitToday(state.user.uid, habit);
    if (result.done && cardEl) spawnXpFloat(cardEl, result.xpAmount);
    showToast(result.done ? `✅ +${result.xpAmount} XP conquistados!` : '↩️ Hábito desmarcado');
  } catch (err) {
    console.error('Toggle error:', err);
    showToast('❌ Erro ao salvar. Tente novamente.');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
  // onSnapshot atualiza o card automaticamente após o write
}

async function handleDelete(habitId) {
  if (!confirm('Remover esta missão permanentemente?')) return;
  try {
    await deleteHabit(habitId);
    showToast('🗑️ Missão removida.');
  } catch {
    showToast('❌ Erro ao remover. Tente novamente.');
  }
}

// ── Modal ─────────────────────────────────────────────────────
const modal     = document.getElementById('habit-modal');
const modalForm = document.getElementById('habit-form');
const xpSlider  = document.getElementById('habit-xp');
const xpDisplay = document.getElementById('xp-display');
const xpSideVal = modalForm?.querySelector('.xp-slider-val');

document.getElementById('add-habit-btn').addEventListener('click', () => {
  modal.classList.add('open');
  document.getElementById('habit-name-input').focus();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

if (xpSlider) {
  xpSlider.addEventListener('input', () => {
    const v = xpSlider.value;
    if (xpDisplay) xpDisplay.textContent = v;
    if (xpSideVal) xpSideVal.textContent = v;
  });
}

function closeModal() {
  modal.classList.remove('open');
  modalForm.reset();
  if (xpDisplay) xpDisplay.textContent = '20';
  if (xpSideVal) xpSideVal.textContent = '20';
}

modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name     = document.getElementById('habit-name-input').value.trim();
  const icon     = document.getElementById('habit-icon-input').value.trim() || '🎯';
  const category = document.getElementById('habit-category').value;
  const xp       = parseInt(xpSlider?.value || '20', 10);
  if (!name) return;

  const submitBtn = modalForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    await addHabit(state.user.uid, { name, icon, category, xp });
    closeModal();
    showToast('🎯 Nova missão adicionada!');
  } finally {
    submitBtn.disabled = false;
  }
});

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  state.unsubHabits?.();
  state.unsubProfile?.();
  destroyCharts();
  await logout();
  window.location.replace('login.html');
});

// ── Celebrations ──────────────────────────────────────────────
function celebrateLevelUp(level) {
  showToast(`🎉 NÍVEL ${level} DESBLOQUEADO! Continue assim!`, 4500);
}

function spawnXpFloat(cardEl, amount) {
  const el = document.createElement('div');
  el.className  = 'xp-float';
  el.textContent = `+${amount} XP`;
  cardEl.style.position = 'relative';
  cardEl.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function showToast(message, duration = 2800) {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Utils ─────────────────────────────────────────────────────
function todayStr()      { return new Date().toISOString().split('T')[0]; }
function dateStr(ts)     { return new Date(ts).toISOString().split('T')[0]; }
function escHtml(str)    {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getLast7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { date: d.toISOString().split('T')[0] };
  });
}

function calcStreak(dates) {
  if (!dates.length) return 0;
  const sorted = [...dates].sort().reverse();
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (const d of sorted) {
    const day  = new Date(d + 'T00:00:00');
    const diff = Math.round((cursor - day) / 86400000);
    if (diff === 0 || diff === 1) { streak++; cursor = day; }
    else break;
  }
  return streak;
}
