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
  updateHabit,
  deleteHabit,
  toggleHabitToday,
  checkAndAwardBadges,
  BADGES,
  onForegroundMessage,
  requestNotificationPermission,
} from './firebase.js';
import { initCharts, updateCharts, destroyCharts } from './charts.js';

// ── State ─────────────────────────────────────────────────────
const state = {
  user:           null,
  profile:        null,
  habits:         [],
  unsubHabits:    null,
  unsubProfile:   null,
  profileReady:   false,
  habitsLoaded:   false,
  editingHabitId: null,
};

// ── Boot ──────────────────────────────────────────────────────
requireAuth(
  async (user) => {
    state.user    = user;
    state.profile = await getOrCreateProfile(user);
    await updateStreak();
    await seedDefaultHabits(user.uid);

    showSkeletons();

    window.addEventListener('offline', () => showToast('Você está offline', 'error', 0));
    window.addEventListener('online',  () => { showToast('Conexão restaurada', 'success'); });

    state.unsubProfile = subscribeToProfile(user.uid, async (profile) => {
      const { level: correctLevel } = calcLevel(profile.xp || 0);
      if (profile.level !== correctLevel) await updateProfile(user.uid, { level: correctLevel });
      const prevLevel  = state.profile?.level;
      state.profile    = { ...profile, level: correctLevel };
      renderHeader();
      renderStats();
      renderBadges();
      renderActivityLog();
      if (state.profileReady && prevLevel && correctLevel > prevLevel) celebrateLevelUp(correctLevel);
      state.profileReady = true;
    }, (err) => {
      console.error('Profile error:', err);
      showErrorBanner('Erro ao carregar perfil. Verifique sua conexão.');
    });

    state.unsubHabits = subscribeToHabits(user.uid, (habits) => {
      state.habits       = habits;
      state.habitsLoaded = true;
      renderHabits();
      renderStats();
      renderBadges();
      updateCharts(habits);
    }, (err) => {
      console.error('Habits error:', err);
      if (err.code === 'permission-denied') {
        showErrorBanner('Permissão negada. Verifique as regras do Firestore.');
      } else {
        showErrorBanner('Erro ao carregar missões. Verifique sua conexão.');
      }
    });

    hideAuthLoading();
    initCharts();
    initScrollReveal();
    setupNotifications(user.uid);

    onForegroundMessage((payload) => {
      showToast(payload.notification?.body || 'Nova notificação Kaisen', 'info');
    });
  },
  () => window.location.replace('login.html')
);

// ── Splash ────────────────────────────────────────────────────
function hideAuthLoading() {
  const el = document.getElementById('auth-loading');
  if (!el) return;
  const elapsed = Date.now() - (el._startTime || Date.now());
  const delay   = Math.max(0, 800 - elapsed);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, delay);
}
document.getElementById('auth-loading')._startTime = Date.now();

// ── Streak ────────────────────────────────────────────────────
async function updateStreak() {
  const p         = state.profile;
  const today     = todayStr();
  const yesterday = dateStr(Date.now() - 86400000);
  if (p.lastActiveDate === today) return;
  const newStreak = p.lastActiveDate === yesterday ? (p.streak || 0) + 1 : 1;
  await updateProfile(state.user.uid, { streak: newStreak, lastActiveDate: today });
  state.profile = { ...p, streak: newStreak, lastActiveDate: today };
}

// ── Skeleton loading ───────────────────────────────────────────
function showSkeletons(count = 4) {
  const container = document.getElementById('habits-list');
  if (!container || state.habitsLoaded) return;
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="habit-card sk-card" aria-hidden="true">
      <div class="hc-top">
        <div class="sk-block" style="width:46px;height:46px;border-radius:12px;flex-shrink:0"></div>
        <div class="hc-body">
          <div class="sk-line" style="width:65%;height:14px"></div>
          <div class="sk-line" style="width:40%;height:10px;margin-top:8px"></div>
        </div>
        <div class="sk-block" style="width:42px;height:60px;border-radius:10px;flex-shrink:0"></div>
      </div>
      <div class="sk-line" style="height:8px;width:100%"></div>
      <div class="sk-block" style="height:36px;border-radius:10px;width:100%"></div>
    </div>`).join('');
}

// ── Error banner ───────────────────────────────────────────────
function showErrorBanner(message) {
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id        = 'error-banner';
    banner.className = 'error-banner';
    document.querySelector('.app-main')?.prepend(banner);
  }
  banner.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>${message}</span>
    <button onclick="this.closest('.error-banner').remove()" aria-label="Fechar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
}

// ── Notifications ──────────────────────────────────────────────
async function setupNotifications(uid) {
  const btn = document.getElementById('notify-btn');
  if (!btn) return;

  const isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true ||
                       window.matchMedia('(display-mode: standalone)').matches;

  // iOS em Safari (não standalone): o botão orienta a instalar o app primeiro
  if (isIOS && !isStandalone) {
    btn.addEventListener('click', () => {
      showToast('Para ativar notificações no iOS, adicione o Kaisen à Tela de Início.', 'info', 6000);
    });
    return;
  }

  // Plataforma não suporta a Notification API (ex: Android WebView antigo)
  if (!('Notification' in window)) { btn.remove(); return; }

  const updateBtn = () => {
    const granted = Notification.permission === 'granted';
    btn.title = granted ? 'Notificações ativas' : 'Ativar notificações';
    btn.classList.toggle('notify-active', granted);
    btn.setAttribute('aria-pressed', String(granted));
  };
  updateBtn();

  btn.addEventListener('click', async () => {
    if (Notification.permission === 'granted') return;
    const token = await requestNotificationPermission(uid);
    if (token) { updateBtn(); showToast('Notificações ativadas!', 'success'); }
    else        { showToast('Notificações não autorizadas.', 'warn'); }
  });
}

// ── Render: header ────────────────────────────────────────────
function renderHeader() {
  const p        = state.profile;
  const nameEl   = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl)   nameEl.textContent = p.displayName?.split(' ')[0] || 'Player';
  if (avatarEl) avatarEl.src       = p.photoURL || 'assets/icone.png';
}

// ── Render: stats ──────────────────────────────────────────────
const _prev = {};
function renderStats() {
  const p                              = state.profile || {};
  const totalXp                        = p.xp || 0;
  const { level, xpInLevel, xpNeeded } = calcLevel(totalXp);
  const pct                            = Math.round((xpInLevel / xpNeeded) * 100);
  const today                          = todayStr();
  const doneToday                      = state.habits.filter((h) => h.completedDates?.includes(today)).length;

  animateEl('stat-level',  _prev.level  ?? level,       level);
  animateEl('stat-xp',     _prev.xp     ?? totalXp,     totalXp, true);
  animateEl('stat-streak', _prev.streak ?? (p.streak || 0), p.streak || 0);
  setEl('stat-done', `${doneToday}/${state.habits.length}`);
  _prev.level = level; _prev.xp = totalXp; _prev.streak = p.streak || 0;

  const bar = document.getElementById('xp-bar');
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.closest('[role="progressbar"]')?.setAttribute('aria-valuenow', pct);
  }
  setEl('xp-level-num',  level);
  setEl('level-title',   getLevelTitle(level));
  setEl('xp-total-val',  fmtNum(totalXp));
  setEl('xp-label',      `${fmtNum(xpInLevel)} / ${fmtNum(xpNeeded)} XP`);
  setEl('xp-pct',        `${pct}%`);
  setEl('xp-remaining',  fmtNum(xpNeeded - xpInLevel));
  setEl('xp-next-level', level + 1);
}

const LEVEL_TITLES = [
  [2, 'Iniciante'], [5, 'Aventureiro'], [10, 'Guerreiro'], [15, 'Herói'], [20, 'Lendário'],
];
function getLevelTitle(level) {
  for (const [max, title] of LEVEL_TITLES) { if (level <= max) return title; }
  return 'Mestre';
}

// ── Render: badges ─────────────────────────────────────────────
function renderBadges() {
  const grid = document.getElementById('badges-grid');
  if (!grid) return;
  const earned = state.profile?.badges || [];
  setEl('badge-count', `${earned.length}/${BADGES.length}`);
  grid.innerHTML = BADGES.map((b) => {
    const has = earned.includes(b.id);
    return `
      <div class="badge-item${has ? ' badge-earned' : ' badge-locked'}" title="${b.desc}">
        <span class="badge-icon">${b.icon}</span>
        <span class="badge-name">${b.name}</span>
        <span class="badge-desc">${b.desc}</span>
      </div>`;
  }).join('');
}

// ── Render: activity log ───────────────────────────────────────
function renderActivityLog() {
  const list = document.getElementById('activity-list');
  if (!list) return;
  const log = state.profile?.activityLog || [];
  if (!log.length) {
    list.innerHTML = '<p class="activity-empty">Nenhuma atividade ainda.</p>';
    return;
  }
  list.innerHTML = log.slice(0, 10).map((e) => {
    const gain = e.xp > 0;
    const time = new Date(e.ts).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    return `
      <div class="activity-entry">
        <span class="activity-icon">${e.habitIcon || '⚡'}</span>
        <div class="activity-info">
          <span class="activity-name">${escHtml(e.habitName)}</span>
          <span class="activity-time">${time}</span>
        </div>
        <span class="activity-xp ${gain ? 'xp-gain' : 'xp-loss'}">${gain ? '+' : ''}${e.xp} XP</span>
      </div>`;
  }).join('');
}

// ── Render: habit cards ────────────────────────────────────────
const CATEGORY_LABELS = {
  conteudo: 'Conteúdo', estudo: 'Estudo', fitness: 'Fitness',
  financas: 'Finanças', saude: 'Saúde',   lazer: 'Lazer', outros: 'Outros',
};
const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function isDueToday(habit) {
  const freq = habit.frequency;
  if (!freq || freq === 'daily') return true;
  if (Array.isArray(freq) && freq.length) return freq.includes(new Date().getDay());
  return true;
}

function getFreqLabel(freq) {
  if (!freq || freq === 'daily') return null;
  if (Array.isArray(freq) && freq.length) return freq.map((d) => DAY_LABELS[d]).join(', ');
  return null;
}

function renderHabits() {
  const container = document.getElementById('habits-list');
  if (!container) return;
  const today     = todayStr();
  container.innerHTML = '';

  if (!state.habits.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
        </span>
        <p>Nenhuma missão ainda.<br>Adicione seu primeiro desafio!</p>
      </div>`;
    return;
  }

  state.habits.forEach((habit, idx) => {
    const done     = habit.completedDates?.includes(today);
    const dueToday = isDueToday(habit);
    const streak   = calcStreak(habit.completedDates || []);
    const last7    = getLast7Days();
    const weekDone = last7.filter(({ date }) => habit.completedDates?.includes(date)).length;
    const weekPct  = Math.round((weekDone / 7) * 100);

    const weekDots = last7.map(({ date }, i) => {
      const isToday = i === 6;
      const isDone  = habit.completedDates?.includes(date);
      return `<div class="hc-dot${isDone ? ' done' : ''}${isToday ? ' today' : ''}" title="${date}"></div>`;
    }).join('');

    const xp      = habit.xp || 20;
    const cat     = habit.category || 'outros';
    const freqLbl = getFreqLabel(habit.frequency);
    const card    = document.createElement('div');
    card.className       = `habit-card${done ? ' is-done' : ''}${!dueToday ? ' not-due' : ''}`;
    card.dataset.habitId = habit.id;
    card.style.animationDelay = `${idx * 60}ms`;

    card.innerHTML = `
      <div class="hc-top">
        <div class="hc-icon">${habit.icon ||
          `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`
        }</div>
        <div class="hc-body">
          <h3 class="hc-name">${escHtml(habit.name)}</h3>
          <div class="hc-meta">
            <span class="tag tag-${cat}">${CATEGORY_LABELS[cat] || cat}</span>
            <span class="hc-xp-badge">+${xp} XP</span>
            ${freqLbl ? `<span class="hc-freq-badge">${freqLbl}</span>` : ''}
          </div>
        </div>
        <div class="hc-streak">
          <span class="hc-streak-icon">${streak > 0
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 3z"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`
          }</span>
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
        <button class="hc-complete-btn${done ? ' is-done' : ''}${!dueToday && !done ? ' not-due-btn' : ''}"
          data-id="${habit.id}"
          aria-label="${done ? 'Desmarcar' : dueToday ? 'Concluir hoje' : 'Não previsto hoje'}"
          ${!dueToday && !done ? 'disabled' : ''}>
          ${done
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Concluído`
            : dueToday
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>Concluir hoje<strong>+${xp} XP</strong>`
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Não previsto hoje`
          }
        </button>
        <button class="hc-edit-btn" data-id="${habit.id}" aria-label="Editar hábito">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="hc-delete-btn" data-id="${habit.id}" aria-label="Remover hábito">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;

    container.appendChild(card);
  });

  container.querySelectorAll('.hc-complete-btn:not(:disabled)').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      spawnRipple(e, btn);
      handleToggle(btn.dataset.id, btn.closest('.habit-card'));
    })
  );
  container.querySelectorAll('.hc-edit-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      const habit = state.habits.find((h) => h.id === btn.dataset.id);
      if (habit) openEditModal(habit);
    })
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

    const updatedHabit  = { ...habit, completedDates: result.completedDates };
    const updatedHabits = state.habits.map((h) => h.id === habitId ? updatedHabit : h);
    const newBadges = await checkAndAwardBadges(state.user.uid, state.profile, updatedHabits);
    for (const b of newBadges) {
      setTimeout(() => showToast(`Conquista: ${b.icon} ${b.name}!`, 'level', 4000), 500);
    }

    showToastWithUndo(
      result.done ? `+${result.xpAmount} XP conquistados` : 'Hábito desmarcado',
      result.done ? 'success' : 'warn',
      () => {
        const current = state.habits.find((h) => h.id === habitId);
        if (current) handleToggle(habitId, document.querySelector(`[data-habit-id="${habitId}"]`));
      }
    );
  } catch (err) {
    console.error('Toggle error:', err);
    showToast('Erro ao salvar. Tente novamente.', 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function handleDelete(habitId) {
  if (!confirm('Remover esta missão permanentemente?')) return;
  try {
    await deleteHabit(habitId);
    showToast('Missão removida', 'warn');
  } catch {
    showToast('Erro ao remover. Tente novamente.', 'error');
  }
}

// ── Modal ─────────────────────────────────────────────────────
const modal     = document.getElementById('habit-modal');
const modalForm = document.getElementById('habit-form');
const xpSlider  = document.getElementById('habit-xp');
const xpDisplay = document.getElementById('xp-display');
const xpSideVal = modalForm?.querySelector('.xp-slider-val');

document.getElementById('add-habit-btn').addEventListener('click', openAddModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

if (xpSlider) {
  xpSlider.addEventListener('input', () => {
    const v = xpSlider.value;
    if (xpDisplay) xpDisplay.textContent = v;
    if (xpSideVal) xpSideVal.textContent = v;
  });
}

// Frequency picker
let selectedFrequency = 'daily';

document.querySelectorAll('.freq-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.freq-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const isWeekly = btn.dataset.freq === 'weekly';
    document.getElementById('freq-days-picker').hidden = !isWeekly;
    selectedFrequency = isWeekly
      ? [...document.querySelectorAll('.freq-day-btn.active')].map((b) => parseInt(b.dataset.day))
      : 'daily';
  });
});

document.querySelectorAll('.freq-day-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    selectedFrequency = [...document.querySelectorAll('.freq-day-btn.active')].map((b) => parseInt(b.dataset.day));
  });
});

function openAddModal() {
  state.editingHabitId = null;
  setEl('modal-heading', 'Nova Missão');
  const sub = modalForm.querySelector('[type="submit"]');
  if (sub) sub.textContent = 'Adicionar Missão';
  modal.classList.add('open');
  document.getElementById('habit-name-input')?.focus();
}

function openEditModal(habit) {
  state.editingHabitId = habit.id;
  setEl('modal-heading', 'Editar Missão');
  const sub = modalForm.querySelector('[type="submit"]');
  if (sub) sub.textContent = 'Salvar Alterações';

  document.getElementById('habit-name-input').value = habit.name;
  document.getElementById('habit-icon-input').value = habit.icon || '';
  document.getElementById('habit-category').value   = habit.category || 'outros';
  const xp = habit.xp || 20;
  if (xpSlider)  xpSlider.value           = xp;
  if (xpDisplay) xpDisplay.textContent    = xp;
  if (xpSideVal) xpSideVal.textContent    = xp;

  const freq    = habit.frequency;
  const isDaily = !freq || freq === 'daily';
  document.querySelectorAll('.freq-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.freq === (isDaily ? 'daily' : 'weekly'))
  );
  document.getElementById('freq-days-picker').hidden = isDaily;
  selectedFrequency = isDaily ? 'daily' : (Array.isArray(freq) ? freq : 'daily');
  document.querySelectorAll('.freq-day-btn').forEach((b) => {
    b.classList.toggle('active',
      Array.isArray(selectedFrequency) && selectedFrequency.includes(parseInt(b.dataset.day))
    );
  });

  modal.classList.add('open');
  document.getElementById('habit-name-input')?.focus();
}

function closeModal() {
  modal.classList.remove('open');
  modalForm.reset();
  state.editingHabitId = null;
  selectedFrequency    = 'daily';
  if (xpDisplay) xpDisplay.textContent = '20';
  if (xpSideVal) xpSideVal.textContent = '20';
  document.querySelectorAll('.freq-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.freq === 'daily')
  );
  document.querySelectorAll('.freq-day-btn').forEach((b) => b.classList.remove('active'));
  const picker = document.getElementById('freq-days-picker');
  if (picker) picker.hidden = true;
}

modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name     = document.getElementById('habit-name-input').value.trim();
  const icon     = document.getElementById('habit-icon-input').value.trim();
  const category = document.getElementById('habit-category').value;
  const xp       = parseInt(xpSlider?.value || '20', 10);
  if (!name) return;

  const frequency = (selectedFrequency === 'daily' || (Array.isArray(selectedFrequency) && !selectedFrequency.length))
    ? 'daily' : selectedFrequency;

  const submitBtn = modalForm.querySelector('[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (state.editingHabitId) {
      await updateHabit(state.editingHabitId, { name, icon, category, xp, frequency });
      showToast('Missão atualizada', 'success');
    } else {
      await addHabit(state.user.uid, { name, icon, category, xp, frequency });
      showToast('Nova missão adicionada', 'success');
    }
    closeModal();
  } catch {
    showToast('Erro ao salvar. Tente novamente.', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
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
  showToast(`Nível ${level} desbloqueado!`, 'level', 4000);
  spawnParticles(40);
  const overlay = document.createElement('div');
  overlay.className = 'levelup-overlay';
  overlay.innerHTML = `
    <div class="levelup-inner">
      <div class="levelup-badge">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <span>Nível</span><strong>${level}</strong>
      </div>
      <p class="levelup-title">Nível desbloqueado!</p>
      <p class="levelup-sub">Melhoria diária. Evolução constante.</p>
      <button class="levelup-close" aria-label="Fechar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        Continuar
      </button>
    </div>`;
  document.body.appendChild(overlay);
  const dismiss = () => {
    overlay.classList.add('out');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  };
  overlay.addEventListener('click', dismiss);
  overlay.querySelector('.levelup-close').addEventListener('click', (ev) => { ev.stopPropagation(); dismiss(); });
  setTimeout(dismiss, 5000);
}

function spawnParticles(count = 30) {
  const colors = ['#ff6b00', '#ffc857', '#ff8c33', '#ffffff', '#ff4500'];
  for (let i = 0; i < count; i++) {
    const p    = document.createElement('div');
    p.className = 'particle';
    const size  = 4 + Math.random() * 7;
    p.style.cssText = [
      `left:${Math.random() * 100}vw`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `animation-duration:${0.9 + Math.random() * 1.6}s`,
      `animation-delay:${Math.random() * 0.6}s`,
      `width:${size}px`, `height:${size}px`,
      `border-radius:${Math.random() > .4 ? '50%' : '2px'}`,
    ].join(';');
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }
}

function spawnXpFloat(cardEl, amount) {
  const el       = document.createElement('div');
  el.className   = 'xp-float';
  el.textContent = `+${amount} XP`;
  cardEl.style.position = 'relative';
  cardEl.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function spawnRipple(e, btn) {
  const r     = document.createElement('span');
  r.className = 'ripple';
  const rect  = btn.getBoundingClientRect();
  const size  = Math.max(rect.width, rect.height);
  r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(r);
  r.addEventListener('animationend', () => r.remove(), { once: true });
}

// ── Scroll reveal ─────────────────────────────────────────────
function initScrollReveal() {
  const targets = document.querySelectorAll('.chart-card, .xp-card, .stats-grid, .badges-section, .activity-section');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('visible'), i * 80);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  targets.forEach((el) => { el.classList.add('reveal'); obs.observe(el); });
}

// ── Toast ─────────────────────────────────────────────────────
const TOAST_ICONS = {
  success: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  error:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  warn:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  level:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  info:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

let toastTimer;

function showToastWithUndo(message, type = 'success', onUndo = null, duration = 5000) {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.className = `toast-${type}`;
  const undoHtml = onUndo ? `<button class="toast-undo-btn">Desfazer</button>` : '';
  toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || ''}</span><span>${message}</span>${undoHtml}`;
  toast.classList.add('show');
  if (onUndo) {
    toast.querySelector('.toast-undo-btn')?.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toast.classList.remove('show');
      onUndo();
    }, { once: true });
  }
  if (duration > 0) toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showToast(message, type = 'success', duration = 2800) {
  showToastWithUndo(message, type, null, duration);
}

// ── Utils ─────────────────────────────────────────────────────
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function fmtNum(n) { return Number(n).toLocaleString('pt-BR'); }

function animateEl(id, from, to, format = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (from === to) {
    el.textContent = format ? fmtNum(to) : to;
    return;
  }
  const card = el.closest('.stat-card');
  if (card) {
    card.classList.remove('popping');
    void card.offsetWidth;
    card.classList.add('popping');
    card.addEventListener('animationend', () => card.classList.remove('popping'), { once: true });
  }
  const start    = performance.now();
  const duration = Math.min(600, Math.abs(to - from) * 10 + 200);
  const update   = (now) => {
    const t    = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = format ? fmtNum(Math.round(from + (to - from) * ease)) : Math.round(from + (to - from) * ease);
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function todayStr()   { return new Date().toISOString().split('T')[0]; }
function dateStr(ts)  { return new Date(ts).toISOString().split('T')[0]; }
function escHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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
