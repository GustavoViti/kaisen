/**
 * charts.js — gráficos do dashboard
 * Depende de window.Chart (Chart.js 4.x carregado via <script> CDN)
 * Todos os dados derivam dos hábitos e perfil vindos do Firestore.
 */

// ── Paleta ────────────────────────────────────────────────────
const C = {
  orange:  '#ff6b00',
  orangeL: '#ff8c33',
  gold:    '#ffc857',
  green:   '#4ade80',
  red:     '#ff3d00',
  grid:    'rgba(255,255,255,0.05)',
  muted:   '#666666',
  tooltip: '#1a1a1a',
};

const CAT_COLOR = {
  conteudo: C.orange,
  estudo:   C.gold,
  fitness:  C.red,
  financas: C.gold,
  saude:    C.green,
  lazer:    C.orangeL,
  outros:   C.muted,
};

// ── Instâncias (singleton por página) ─────────────────────────
const inst = {};

// ── API pública ───────────────────────────────────────────────

export function initCharts() {
  applyDefaults();
  inst.weekly      = buildWeeklyChart();
  inst.xp          = buildXpChart();
  inst.consistency = buildConsistencyChart();
}

/** Atualiza os 3 gráficos com os dados mais recentes do Firestore. */
export function updateCharts(habits) {
  if (!window.Chart) return;
  patchWeekly(habits);
  patchXp(habits);
  patchConsistency(habits);
}

export function destroyCharts() {
  Object.values(inst).forEach((c) => c?.destroy());
}

// ── Defaults globais do Chart.js ──────────────────────────────
function applyDefaults() {
  const Chart = window.Chart;
  if (!Chart) return;

  Chart.defaults.color       = C.muted;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = "'Inter','Segoe UI',system-ui,sans-serif";
  Chart.defaults.font.size   = 12;

  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor:  C.tooltip,
    borderColor:      'rgba(255,255,255,0.1)',
    borderWidth:      1,
    titleColor:       '#f5f5f5',
    bodyColor:        C.muted,
    padding:          12,
    cornerRadius:     10,
    displayColors:    false,
  });
}

// ══════════════════════════════════════════════════════════════
//  CHART 1 — Hábitos concluídos por dia (barras, última semana)
// ══════════════════════════════════════════════════════════════

function buildWeeklyChart() {
  const ctx = getCtx('chart-weekly');
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 0, 240);
  grad.addColorStop(0, 'rgba(255,107,0,0.90)');
  grad.addColorStop(1, 'rgba(255,107,0,0.12)');

  return new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: grad,
        hoverBackgroundColor: 'rgba(255,140,51,0.92)',
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 550, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ([i]) => i.label,
            label: (i) => `  ${i.raw} hábito${i.raw !== 1 ? 's' : ''} concluído${i.raw !== 1 ? 's' : ''}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0, color: C.muted },
          grid: { color: C.grid },
          border: { display: false },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: C.muted },
        },
      },
    },
  });
}

function patchWeekly(habits) {
  const c = inst.weekly;
  if (!c) return;
  const days = last7();
  c.data.labels           = days.map((d) => d.label);
  c.data.datasets[0].data = days.map(({ date }) =>
    habits.filter((h) => h.completedDates?.includes(date)).length
  );
  c.update();
}

// ══════════════════════════════════════════════════════════════
//  CHART 2 — Evolução de XP (linha com área, últimos 30 dias)
// ══════════════════════════════════════════════════════════════

function buildXpChart() {
  const ctx = getCtx('chart-xp');
  if (!ctx) return null;

  const fill = ctx.createLinearGradient(0, 0, 0, 210);
  fill.addColorStop(0, 'rgba(255,200,87,0.35)');
  fill.addColorStop(1, 'rgba(255,200,87,0.01)');

  return new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: C.gold,
        backgroundColor: fill,
        borderWidth: 2.5,
        fill: true,
        tension: 0.45,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: C.gold,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ([i]) => i.label,
            label: (i) => `  ${i.raw} XP acumulado nos últimos 30 dias`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: C.grid },
          border: { display: false },
          ticks: { color: C.muted, callback: (v) => v + ' XP' },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: C.muted, maxTicksLimit: 6, maxRotation: 0 },
        },
      },
    },
  });
}

function patchXp(habits) {
  const c = inst.xp;
  if (!c) return;
  const days = last30();
  let cum = 0;
  c.data.labels           = days.map((d) => d.label);
  c.data.datasets[0].data = days.map(({ date }) => {
    cum += habits.reduce(
      (s, h) => (h.completedDates?.includes(date) ? s + (h.xp || 20) : s), 0
    );
    return cum;
  });
  c.update();
}

// ══════════════════════════════════════════════════════════════
//  CHART 3 — Consistência por hábito (barras horizontais, 30d)
// ══════════════════════════════════════════════════════════════

function buildConsistencyChart() {
  const ctx = getCtx('chart-consistency');
  if (!ctx) return null;

  return new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ([i]) => i.label,
            label: (i) => `  ${i.raw}% de consistência (últimos 30 dias)`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          grid: { color: C.grid },
          border: { display: false },
          ticks: { color: C.muted, callback: (v) => v + '%' },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: C.muted },
        },
      },
    },
  });
}

function patchConsistency(habits) {
  const c = inst.consistency;
  if (!c) return;
  const days = last30();
  c.data.labels = habits.map((h) =>
    (h.icon ? h.icon + '  ' : '') + h.name
  );
  c.data.datasets[0].data = habits.map((h) => {
    const done = days.filter(({ date }) => h.completedDates?.includes(date)).length;
    return Math.round((done / 30) * 100);
  });
  c.data.datasets[0].backgroundColor = habits.map(
    (h) => (CAT_COLOR[h.category] || C.muted) + 'bb'
  );
  c.update();
}

// ── Helpers de data ───────────────────────────────────────────

const DAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function last7() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { date: d.toISOString().split('T')[0], label: DAY_PT[d.getDay()] };
  });
}

function last30() {
  return Array.from({ length: 30 }, (_, i) => {
    const d     = new Date(Date.now() - (29 - i) * 86400000);
    const date  = d.toISOString().split('T')[0];
    const label = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    return { date, label };
  });
}

function pad(n) { return String(n).padStart(2, '0'); }
function getCtx(id) { return document.getElementById(id)?.getContext('2d') ?? null; }
