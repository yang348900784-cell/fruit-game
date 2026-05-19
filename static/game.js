/* ═══════════════════════════════════════════════════════════════════════════
   合成大西瓜 v2 — Game Engine (11-Level Fruit Chain)
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── 11-Level Fruit Definitions ─────────────────────────────────────────────
const FRUITS = [
  { type: 0,  name: '山竹',   color: '#7B1FA2', radius: 14, score: 2 },
  { type: 1,  name: '草莓',   color: '#EF5350', radius: 19, score: 4 },
  { type: 2,  name: '樱桃',   color: '#D81B60', radius: 24, score: 8 },
  { type: 3,  name: '猕猴桃', color: '#7CB342', radius: 30, score: 16 },
  { type: 4,  name: '番茄',   color: '#E65100', radius: 36, score: 32 },
  { type: 5,  name: '橙子',   color: '#FB8C00', radius: 42, score: 64 },
  { type: 6,  name: '苹果',   color: '#C62828', radius: 49, score: 128 },
  { type: 7,  name: '菠萝',   color: '#F9A825', radius: 56, score: 256 },
  { type: 8,  name: '椰子',   color: '#795548', radius: 63, score: 512 },
  { type: 9,  name: '半西瓜', color: '#43A047', radius: 70, score: 1024 },
  { type: 10, name: '大西瓜', color: '#2E7D32', radius: 78, score: 2048 },
];

// ─── Game Constants ────────────────────────────────────────────────────────
const CANVAS_W = 400;
const CANVAS_H = 680;
const CONTAINER_LEFT = 16;
const CONTAINER_RIGHT = CANVAS_W - 16;
const CONTAINER_BOTTOM = CANVAS_H - 8;
const DANGER_LINE_Y = 115;
const DROP_Y = 85;
const GAME_OVER_DELAY = 3000;

const FRUIT_OPTS = {
  restitution: 0.08,
  friction: 0.15,
  frictionAir: 0.004,
  density: 0.003,
};

// ─── DOM References ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');

const authScreen = $('authScreen');
const welcomeScreen = $('welcomeScreen');
const welcomeLbBody = $('welcomeLbBody');
const welcomeLeaderboard = $('welcomeLeaderboard');

const gameScreen = $('gameScreen');
const scoreDisplay = $('scoreDisplay');
const nextFruitDisplay = $('nextFruitDisplay');
const playerNameDisplay = $('playerNameDisplay');
const highScoreDisplay = $('highScoreDisplay');

const timerDisplay = $('timerDisplay');
const stopBtn = $('stopBtn');
const cheatModal = $('cheatModal');
const cheatScoreInput = $('cheatScoreInput');
const cheatTimeInput = $('cheatTimeInput');

const stopConfirmModal = $('stopConfirmModal');
const confirmEndBtn = $('confirmEndBtn');
const cancelStopBtn = $('cancelStopBtn');

const gameOverModal = $('gameOverModal');
const finalScore = $('finalScore');
const beatMsg = $('beatMsg');
const modalLbBody = $('modalLbBody');

// ─── Game State ────────────────────────────────────────────────────────────
let engine, world;
let fruits = [];
let score = 0;
let merges = 0;
let maxFruit = 0;
let gameRunning = false;
let gameOver = false;
let nextFruitType = 0;
let dropX = CANVAS_W / 2;
let aboveLineTimer = 0;
let anyAboveTimer = 0;
let particles = [];
let pendingMerges = [];
let pendingMergeIds = new Set();
let isDropping = false;
let playerName = '';
let submitted = false;
let gameStartTime = 0;
let timerStopped = false;
let stopHoldTimer = null;
let paused = false;

// Auth state
let authToken = localStorage.getItem('fruitgame_token') || '';
let authUser = localStorage.getItem('fruitgame_user') || '';

// Background color transition (follows next fruit color)
let bgGlowR = 248, bgGlowG = 246, bgGlowB = 240;
let targetGlowR = 248, targetGlowG = 246, targetGlowB = 240;

// ─── Helpers ───────────────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function randomFruitType() {
  const r = Math.random();
  if (r < 0.30) return 0;
  if (r < 0.53) return 1;
  if (r < 0.70) return 2;
  if (r < 0.82) return 3;
  if (r < 0.90) return 4;
  return 5;
}

function lighten(hex, amt) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amt);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amt);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amt);
  return `rgb(${r},${g},${b})`;
}

function darken(hex, amt) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amt);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amt);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amt);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ─── Matter.js Physics Setup ──────────────────────────────────────────────
function initPhysics() {
  engine = Matter.Engine.create({ gravity: { x: 0, y: 1.8 } });
  world = engine.world;

  const wallOpts = { isStatic: true, restitution: 0.05, friction: 0.08 };
  const walls = [
    Matter.Bodies.rectangle(CONTAINER_LEFT - 6, CANVAS_H / 2, 12, CANVAS_H * 2, wallOpts),
    Matter.Bodies.rectangle(CONTAINER_RIGHT + 6, CANVAS_H / 2, 12, CANVAS_H * 2, wallOpts),
    Matter.Bodies.rectangle(CANVAS_W / 2, CONTAINER_BOTTOM + 6, CANVAS_W, 12, wallOpts),
  ];
  Matter.Composite.add(world, walls);

  Matter.Events.on(engine, 'collisionStart', (event) => {
    if (!gameRunning || gameOver) return;
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;

      // Squash & stretch on fruit-fruit collision
      if (bodyA.label?.startsWith('fruit') && bodyB.label?.startsWith('fruit')) {
        const relSpeed = Math.sqrt(
          (bodyA.velocity.x - bodyB.velocity.x) ** 2 +
          (bodyA.velocity.y - bodyB.velocity.y) ** 2
        );
        if (relSpeed > 0.5) {
          const squash = Math.min(0.15, relSpeed * 0.03);
          for (const f of fruits) {
            if (f.body === bodyA) { f.sx = 1 - squash; f.sy = 1 + squash; }
            if (f.body === bodyB) { f.sx = 1 - squash; f.sy = 1 + squash; }
          }
        }
      }
      // Squash on fruit hitting floor/wall
      if (bodyA.label?.startsWith('fruit') && bodyB.isStatic) {
        const sq = Math.min(0.12, bodyA.speed * 0.015);
        const t = fruits.find(f => f.body === bodyA);
        if (t && sq > 0.03) { t.sx = 1 + sq; t.sy = 1 - sq; }
      }
      if (bodyB.label?.startsWith('fruit') && bodyA.isStatic) {
        const sq = Math.min(0.12, bodyB.speed * 0.015);
        const t = fruits.find(f => f.body === bodyB);
        if (t && sq > 0.03) { t.sx = 1 + sq; t.sy = 1 - sq; }
      }

      if (!bodyA.label?.startsWith('fruit') || !bodyB.label?.startsWith('fruit')) continue;
      const typeA = parseInt(bodyA.label.split('-')[1]);
      const typeB = parseInt(bodyB.label.split('-')[1]);
      if (typeA !== typeB || typeA >= FRUITS.length - 1) continue;
      if (pendingMergeIds.has(bodyA.id) || pendingMergeIds.has(bodyB.id)) continue;
      pendingMergeIds.add(bodyA.id);
      pendingMergeIds.add(bodyB.id);
      pendingMerges.push({ bodyA, bodyB, type: typeA });
    }
  });
}

// ─── Fruit Management ─────────────────────────────────────────────────────
function createFruitBody(x, y, type) {
  const body = Matter.Bodies.circle(x, y, FRUITS[type].radius, FRUIT_OPTS);
  body.label = `fruit-${type}`;
  return body;
}

function addFruit(x, y, type) {
  const body = createFruitBody(x, y, type);
  Matter.Composite.add(world, body);
  fruits.push({ body, type, sx: 1, sy: 1 });
}

function removeFruit(body) {
  Matter.Composite.remove(world, body);
  fruits = fruits.filter(f => f.body !== body);
}

function processMerges() {
  for (const m of pendingMerges) {
    const newType = m.type + 1;
    const mx = (m.bodyA.position.x + m.bodyB.position.x) / 2;
    const my = (m.bodyA.position.y + m.bodyB.position.y) / 2;
    removeFruit(m.bodyA);
    removeFruit(m.bodyB);
    const nb = createFruitBody(mx, my, newType);
    Matter.Composite.add(world, nb);
    fruits.push({ body: nb, type: newType, sx: 1, sy: 1 });
    score += FRUITS[newType].score;
    merges++;
    if (newType > maxFruit) maxFruit = newType;

    // Particle burst — sparks in the merged fruit's color
    const pColor = FRUITS[newType].color;
    const pCount = 6 + newType * 2;
    for (let i = 0; i < pCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      particles.push({
        x: mx, y: my,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 25 + Math.random() * 20,
        maxLife: 45,
        color: pColor,
        size: 1.5 + Math.random() * 3.5,
      });
    }
    // Floating score text
    particles.push({
      x: mx, y: my - 12,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -2,
      life: 45,
      maxLife: 45,
      text: `+${FRUITS[newType].score}`,
      isText: true,
    });

    // Explosion impulse — push nearby fruits outward for combo feel
    const blastRadius = FRUITS[newType].radius * 3.5;
    const blastPower = 0.025;
    for (const f of fruits) {
      if (f.body === nb) continue;
      const dx = f.body.position.x - mx;
      const dy = f.body.position.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < blastRadius && dist > 1) {
        const force = blastPower * (1 - dist / blastRadius);
        Matter.Body.applyForce(f.body, f.body.position, {
          x: (dx / dist) * force,
          y: (dy / dist) * force,
        });
      }
    }
  }
  pendingMerges.length = 0;
  pendingMergeIds.clear();
}

// ─── Drop ─────────────────────────────────────────────────────────────────
function doDrop() {
  if (!gameRunning || gameOver || isDropping) return;
  isDropping = true;
  const r = FRUITS[nextFruitType].radius;
  const cx = Math.max(CONTAINER_LEFT + r + 2, Math.min(CONTAINER_RIGHT - r - 2, dropX));
  addFruit(cx, DROP_Y, nextFruitType);
  nextFruitType = randomFruitType();
  updateNextFruit();
  setTimeout(() => { isDropping = false; }, 400);
}

// ─── Game Over Detection ──────────────────────────────────────────────────
function checkGameOver() {
  let anyAbove = false, allSlow = true;
  for (const f of fruits) {
    if (f.body.position.y - FRUITS[f.type].radius < DANGER_LINE_Y) {
      anyAbove = true;
      if (f.body.speed > 0.4) allSlow = false;
    }
  }

  if (anyAbove) {
    anyAboveTimer += 16;
    // Hard cap: force game over after 8s regardless of speed
    // (prevents exploit where constant tapping resets the 3s timer)
    if (anyAboveTimer > 8000) { endGame(); return; }
  } else {
    anyAboveTimer = 0;
  }

  // Normal: all fruits still for 3 consecutive seconds
  if (anyAbove && allSlow) {
    aboveLineTimer += 16;
    if (aboveLineTimer > GAME_OVER_DELAY) endGame();
  } else {
    aboveLineTimer = 0;
  }
}

// ─── Score Submission ─────────────────────────────────────────────────────
async function submitScore() {
  if (score <= 0 || submitted) return;
  submitted = true;
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({
        player_name: playerName,
        score: score,
        duration: Math.max(elapsed, 1),
        max_fruit: maxFruit,
        merges: merges,
      }),
    });
    const data = await res.json();
    if (data.beaten_pct !== undefined) {
      beatMsg.textContent = `恭喜你击败了全球 ${data.beaten_pct}% 的玩家！`;
    }
    if (data.personal_best > 0) {
      highScoreDisplay.textContent = data.personal_best;
    }
  } catch {
    beatMsg.textContent = '排行榜连接失败';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// ─── Leaderboard Rendering ────────────────────────────────────────────────
function maskName(name) {
  if (!name || name.length <= 1) return name || '';
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

function renderLeaderboardTable(tbody, scores, highlightName) {
  if (!scores || scores.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:16px;">暂无记录</td></tr>';
    return;
  }
  tbody.innerHTML = scores.map((entry, i) => {
    const rank = entry.rank || i + 1;
    const isMe = highlightName && entry.player_name === highlightName;
    const rowClass = isMe ? 'lb-highlight' : '';

    let rankDisplay;
    if (rank === 1) rankDisplay = '<span class="medal-gold">&#x1F947;</span>';
    else if (rank === 2) rankDisplay = '<span class="medal-silver">&#x1F948;</span>';
    else if (rank === 3) rankDisplay = '<span class="medal-bronze">&#x1F949;</span>';
    else rankDisplay = rank;

    return `<tr class="${rowClass}">
      <td class="lb-rank">${rankDisplay}</td>
      <td class="lb-player">${esc(maskName(entry.player_name))}</td>
      <td class="lb-score-col">${entry.score.toLocaleString()}</td>
      <td class="lb-duration">${formatTime(entry.duration)}</td>
      <td class="lb-date">${entry.date || '-'}</td>
    </tr>`;
  }).join('');
}

async function loadWelcomeLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard?limit=10');
    const json = await res.json();
    if (json.scores) renderLeaderboardTable(welcomeLbBody, json.scores);
  } catch { /* silent */ }
}

async function loadModalLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard?limit=10');
    const json = await res.json();
    if (json.scores) renderLeaderboardTable(modalLbBody, json.scores, playerName);
  } catch {
    modalLbBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:16px;">加载失败</td></tr>';
  }
}

async function loadPersonalBest(name) {
  try {
    const res = await fetch(`/api/player-best?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    highScoreDisplay.textContent = data.best_score || 0;
  } catch {
    highScoreDisplay.textContent = '0';
  }
}

// ─── Game Control ─────────────────────────────────────────────────────────
function startGame() {
  playerName = authUser;
  if (!playerName) {
    showAuthScreen();
    return;
  }

  if (engine) Matter.Engine.clear(engine);
  fruits = [];
  particles = [];
  score = 0;
  merges = 0;
  maxFruit = 0;
  submitted = false;
  timerStopped = false;
  paused = false;
  gameOver = false;
  gameRunning = true;
  bgGlowR = 248; bgGlowG = 246; bgGlowB = 240;
  targetGlowR = 248; targetGlowG = 246; targetGlowB = 240;
  aboveLineTimer = 0;
  anyAboveTimer = 0;
  pendingMerges = [];
  pendingMergeIds.clear();
  isDropping = false;
  nextFruitType = randomFruitType();
  gameStartTime = Date.now();
  timerDisplay.textContent = '00:00';

  welcomeScreen.style.display = 'none';
  gameOverModal.style.display = 'none';
  gameScreen.style.display = '';
  sizeCanvas();

  playerNameDisplay.textContent = playerName;
  highScoreDisplay.textContent = '0';
  updateScore();
  updateNextFruit();

  loadPersonalBest(playerName);
  initPhysics();
  dropX = CANVAS_W / 2;
  gameLoop();
}

function endGame() {
  gameRunning = false;
  gameOver = true;
  paused = false;
  stopConfirmModal.style.display = 'none';
  finalScore.textContent = score.toLocaleString();
  submitScore();
  loadModalLeaderboard();
  gameOverModal.style.display = '';
}

function backToMenu() {
  gameOver = false;
  gameRunning = false;
  gameOverModal.style.display = 'none';
  gameScreen.style.display = 'none';
  welcomeScreen.style.display = '';
  document.getElementById('authUserBar').style.display = authUser ? '' : 'none';
  document.getElementById('guestBar').style.display = authUser ? 'none' : '';
  document.getElementById('changePwdBtn').style.display = authUser ? '' : 'none';
  document.getElementById('welcomeDesc').textContent = authUser ? '点击落水果，相同水果合成升级！' : '登录后可开始游戏';
  loadWelcomeLeaderboard();
}


// ─── UI Updates ───────────────────────────────────────────────────────────
function updateScore() { scoreDisplay.textContent = score; }
function updateNextFruit() { nextFruitDisplay.textContent = FRUITS[nextFruitType].name; }
function updateTimer() {
  if (timerStopped) return;
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerDisplay.textContent = `${m}:${s}`;
}

function stopTimer() {
  if (timerStopped) return;
  timerStopped = true;
  endGame();
}

function showCheatEditor() {
  if (!gameRunning || gameOver) return;
  gameRunning = false;
  timerStopped = true;
  stopBtn.classList.remove('held');
  cheatScoreInput.value = score;
  cheatTimeInput.value = Math.floor((Date.now() - gameStartTime) / 1000);
  cheatModal.style.display = '';
}

function submitCheat() {
  const newScore = parseInt(cheatScoreInput.value) || 0;
  const newTime = parseInt(cheatTimeInput.value) || 0;
  if (newScore < 0) return;
  score = newScore;
  timerDisplay.textContent = String(Math.floor(newTime / 60)).padStart(2, '0') + ':' + String(newTime % 60).padStart(2, '0');
  cheatModal.style.display = 'none';
  endGame();
}

// ─── Rendering ────────────────────────────────────────────────────────────
function render() {
  // DPR transform
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / CANVAS_W;
  const sy = canvas.height / CANVAS_H;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);

  // ── Background with fruit-tinted ambient glow ──────────────────────────
  if (gameRunning && !gameOver) {
    const targetFruit = FRUITS[nextFruitType];
    if (targetFruit) {
      const tc = hexToRgb(targetFruit.color);
      targetGlowR = tc.r; targetGlowG = tc.g; targetGlowB = tc.b;
    }
  }
  bgGlowR += (targetGlowR - bgGlowR) * 0.02;
  bgGlowG += (targetGlowG - bgGlowG) * 0.02;
  bgGlowB += (targetGlowB - bgGlowB) * 0.02;

  ctx.fillStyle = '#F8F6F0';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const ambientGrad = ctx.createRadialGradient(
    CANVAS_W / 2, DROP_Y, 10,
    CANVAS_W / 2, DROP_Y + 40, CANVAS_W * 0.65
  );
  ambientGrad.addColorStop(0, `rgba(${Math.round(bgGlowR)}, ${Math.round(bgGlowG)}, ${Math.round(bgGlowB)}, 0.18)`);
  ambientGrad.addColorStop(0.5, `rgba(${Math.round(bgGlowR)}, ${Math.round(bgGlowG)}, ${Math.round(bgGlowB)}, 0.06)`);
  ambientGrad.addColorStop(1, 'rgba(248, 246, 240, 0)');
  ctx.fillStyle = ambientGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Floor shadow
  const floorGrad = ctx.createLinearGradient(0, CONTAINER_BOTTOM - 60, 0, CONTAINER_BOTTOM);
  floorGrad.addColorStop(0, 'rgba(0,0,0,0)');
  floorGrad.addColorStop(1, 'rgba(0,0,0,0.04)');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(CONTAINER_LEFT, CONTAINER_BOTTOM - 60, CANVAS_W - CONTAINER_LEFT * 2, 60);

  // ── Squash lerp — smooth squash/stretch decay ──────────────────────────
  for (const f of fruits) {
    f.sx += (1 - f.sx) * 0.18;
    f.sy += (1 - f.sy) * 0.10;
  }

  // ── Danger line — evolves when fruits are near ─────────────────────────
  const anyAboveDanger = fruits.some(
    f => f.body.position.y - FRUITS[f.type].radius < DANGER_LINE_Y
  );
  if (anyAboveDanger) {
    // Solid pulsing line with glow
    const da = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() * 0.008));
    ctx.save();
    ctx.shadowColor = `rgba(239, 68, 68, ${da * 0.5})`;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(239, 68, 68, ${da})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CONTAINER_LEFT + 4, DANGER_LINE_Y);
    ctx.lineTo(CONTAINER_RIGHT - 4, DANGER_LINE_Y);
    ctx.stroke();
    ctx.restore();
  } else {
    // Dashed line (normal)
    const da = 0.35 + 0.65 * Math.abs(Math.sin(Date.now() * 0.004));
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = `rgba(239, 68, 68, ${da})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CONTAINER_LEFT + 4, DANGER_LINE_Y);
    ctx.lineTo(CONTAINER_RIGHT - 4, DANGER_LINE_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Danger label
  const dAlpha = 0.35 + 0.65 * Math.abs(Math.sin(Date.now() * 0.004));
  ctx.fillStyle = `rgba(239, 68, 68, ${anyAboveDanger ? 0.9 : dAlpha * 0.75})`;
  ctx.font = anyAboveDanger ? 'bold 11px sans-serif' : '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('警戒线', CONTAINER_RIGHT - 8, DANGER_LINE_Y - 4);

  // ── Fruits with shake near danger line ─────────────────────────────────
  const now = Date.now();
  for (const f of fruits) {
    let shakeX = 0, shakeY = 0;
    const fruitTop = f.body.position.y - FRUITS[f.type].radius;
    if (fruitTop < DANGER_LINE_Y + 15) {
      const intensity = Math.max(0, (DANGER_LINE_Y + 15 - fruitTop) / 30);
      shakeX = Math.sin(now * 0.015 + f.body.id) * intensity * 2;
      shakeY = Math.cos(now * 0.02 + f.body.id * 1.3) * intensity * 1.2;
    }
    drawFruit(f.body.position.x + shakeX, f.body.position.y + shakeY, f.type, f.sx, f.sy);
  }

  // ── Drop preview ───────────────────────────────────────────────────────
  if (gameRunning && !gameOver && !isDropping) {
    const ft = FRUITS[nextFruitType];
    const r = ft.radius;
    const cx = Math.max(CONTAINER_LEFT + r + 2, Math.min(CONTAINER_RIGHT - r - 2, dropX));

    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(74, 55, 40, 0.30)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, DROP_Y + r);
    ctx.lineTo(cx, CANVAS_H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(74, 55, 40, 0.15)';
    ctx.beginPath();
    ctx.arc(cx, CANVAS_H - 6, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawFruit(cx, DROP_Y, nextFruitType);
  }

  // ── Particles (sparks + floating score text) ────────────────────────────
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    const alpha = p.life / p.maxLife;
    if (p.isText) {
      // Floating score text
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 18px sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 4;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    } else {
      // Spark particle
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.3 + 0.7 * alpha), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawFruit(x, y, type, sx = 1, sy = 1) {
  const f = FRUITS[type];
  const r = f.radius;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);

  // Drop shadow
  ctx.save();
  ctx.beginPath();
  ctx.arc(2, 3, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fill();
  ctx.restore();

  // Main body — 3-layer radial gradient
  const grad = ctx.createRadialGradient(
    -r * 0.3, -r * 0.35, r * 0.05,
    r * 0.1, r * 0.1, r * 1.1
  );
  grad.addColorStop(0, lighten(f.color, 65));
  grad.addColorStop(0.35, f.color);
  grad.addColorStop(0.75, darken(f.color, 15));
  grad.addColorStop(1, darken(f.color, 50));

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = darken(f.color, 45);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Main specular highlight (top-left)
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, -r * 0.32, r * 0.42, r * 0.20, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();

  // Secondary highlight (smaller, higher)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(r * 0.12, -r * 0.48, r * 0.16, r * 0.08, 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();

  // Bottom rim light
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.beginPath();
  ctx.ellipse(r * 0.1, r * 0.5, r * 0.3, r * 0.07, 0, 0, Math.PI * 2);
  ctx.fillStyle = lighten(f.color, 40);
  ctx.fill();
  ctx.restore();

  // Fruit name label
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(10, Math.min(20, r * 0.35))}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.shadowColor = 'rgba(0,0,0,0.40)';
  ctx.shadowBlur = 3;
  ctx.fillText(f.name, 0, 1);
  ctx.restore();

  ctx.restore();
}

// ─── Canvas Sizing (mobile-responsive) ─────────────────────────────────────
function sizeCanvas() {
  const wrapper = canvas.parentElement;
  const maxW = wrapper.clientWidth;
  if (maxW <= 0) return;
  const maxH = wrapper.clientHeight - 4;
  if (maxH <= 0) return;
  let displayW = Math.floor(Math.min(maxW, 600));
  let displayH = Math.floor(displayW * (CANVAS_H / CANVAS_W));
  if (displayH > maxH) {
    displayH = Math.floor(maxH);
    displayW = Math.floor(displayH * (CANVAS_W / CANVAS_H));
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = displayW + 'px';
  canvas.style.height = displayH + 'px';
  canvas.width = Math.round(displayW * dpr);
  canvas.height = Math.round(displayH * dpr);
}

// ─── Game Loop ────────────────────────────────────────────────────────────
function gameLoop() {
  if (gameOver) return;
  if (!paused) {
    Matter.Engine.update(engine, 1000 / 60);
    processMerges();
    checkGameOver();
  }
  render();
  updateScore();
  updateTimer();
  requestAnimationFrame(gameLoop);
}

// ─── Event Handlers ──────────────────────────────────────────────────────
function getCanvasX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * CANVAS_W;
}

canvas.addEventListener('mousemove', (e) => { dropX = getCanvasX(e.clientX); });
canvas.addEventListener('click', (e) => {
  if (!gameRunning || gameOver) return;
  dropX = getCanvasX(e.clientX);
  doDrop();
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  dropX = getCanvasX(e.touches[0].clientX);
}, { passive: false });
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  dropX = getCanvasX(e.touches[0].clientX);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (!gameRunning || gameOver) return;
  doDrop();
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && gameRunning && !gameOver) { e.preventDefault(); doDrop(); }
});

// Enter key triggers login/register on auth forms
document.getElementById('loginUsername').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('registerUsername').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') register();
});
document.getElementById('registerPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') register();
});
document.getElementById('registerConfirm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') register();
});

// Resize canvas on window resize (only when game is visible)
window.addEventListener('resize', () => { if (gameRunning) sizeCanvas(); });

// ─── Stop Button (Long-press cheat) ───────────────────────────────────────
stopBtn.addEventListener('pointerdown', () => {
  if (!gameRunning || gameOver || paused) return;
  stopHoldTimer = setTimeout(() => {
    stopHoldTimer = null;
    stopBtn.classList.add('held');
    paused = true;
    showCheatEditor();
  }, 10000);
});
stopBtn.addEventListener('pointerup', () => {
  if (stopHoldTimer) {
    clearTimeout(stopHoldTimer);
    stopHoldTimer = null;
    showStopConfirm();
  }
  stopBtn.classList.remove('held');
});
stopBtn.addEventListener('pointerleave', () => {
  if (stopHoldTimer) {
    clearTimeout(stopHoldTimer);
    stopHoldTimer = null;
  }
  stopBtn.classList.remove('held');
});

function showStopConfirm() {
  paused = true;
  stopConfirmModal.style.display = '';
}

function resumeFromStop() {
  paused = false;
  stopConfirmModal.style.display = 'none';
}

// ─── Cheat Modal Buttons ─────────────────────────────────────────────────
document.getElementById('cheatSubmitBtn').addEventListener('click', submitCheat);
document.getElementById('cheatCancelBtn').addEventListener('click', () => {
  cheatModal.style.display = 'none';
  endGame();
});

// ─── Stop Confirmation Buttons ──────────────────────────────────────────
confirmEndBtn.addEventListener('click', () => {
  stopConfirmModal.style.display = 'none';
  timerStopped = true;
  endGame();
});
cancelStopBtn.addEventListener('click', resumeFromStop);

// ─── Polyfill roundRect ──────────────────────────────────────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
    const r = typeof radii === 'number' ? radii : (radii || 0);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
  };
}

// ─── Auth Functions ──────────────────────────────────────────────────────

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.auth-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById('authLogin').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('authRegister').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('loginError').textContent = '';
  document.getElementById('registerError').textContent = '';
}

async function login() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!username) { errEl.textContent = '请输入用户名'; return; }
  if (!password) { errEl.textContent = '请输入密码'; return; }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || '登录失败'; return; }
    authToken = data.token;
    authUser = data.username;
    localStorage.setItem('fruitgame_token', authToken);
    localStorage.setItem('fruitgame_user', authUser);
    showWelcomeAfterAuth(authUser);
  } catch { errEl.textContent = '网络连接失败'; }
}

async function register() {
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirm = document.getElementById('registerConfirm').value;
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  if (!username) { errEl.textContent = '请输入用户名'; return; }
  if (password.length < 6 || password.length > 15) { errEl.textContent = '密码需6-15位'; return; }
  if (password !== confirm) { errEl.textContent = '两次密码不一致'; return; }
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || '注册失败'; return; }
    authToken = data.token;
    authUser = data.username;
    localStorage.setItem('fruitgame_token', authToken);
    localStorage.setItem('fruitgame_user', authUser);
    showWelcomeAfterAuth(authUser);
  } catch { errEl.textContent = '网络连接失败'; }
}

function logout() {
  authToken = '';
  authUser = '';
  localStorage.removeItem('fruitgame_token');
  localStorage.removeItem('fruitgame_user');
  welcomeScreen.style.display = 'none';
  gameOverModal.style.display = 'none';
  gameScreen.style.display = 'none';
  authScreen.style.display = '';
}

function showWelcomeAfterAuth(username) {
  document.getElementById('welcomeUsername').textContent = username;
  document.getElementById('authUserBar').style.display = '';
  document.getElementById('guestBar').style.display = 'none';
  document.getElementById('changePwdBtn').style.display = '';
  document.getElementById('welcomeDesc').textContent = '点击落水果，相同水果合成升级！';
  authScreen.style.display = 'none';
  welcomeScreen.style.display = '';
  gameOverModal.style.display = 'none';
  gameScreen.style.display = 'none';
  loadWelcomeLeaderboard();
}

function showLeaderboardAsGuest() {
  document.getElementById('authUserBar').style.display = 'none';
  document.getElementById('guestBar').style.display = '';
  document.getElementById('changePwdBtn').style.display = 'none';
  document.getElementById('welcomeDesc').textContent = '登录后可开始游戏';
  authScreen.style.display = 'none';
  welcomeScreen.style.display = '';
  gameOverModal.style.display = 'none';
  gameScreen.style.display = 'none';
  // Ensure leaderboard is visible and load data
  welcomeLeaderboard.style.display = '';
  loadWelcomeLeaderboard();
}

function showAuthScreen() {
  welcomeScreen.style.display = 'none';
  gameOverModal.style.display = 'none';
  gameScreen.style.display = 'none';
  authScreen.style.display = '';
  switchAuthTab('login');
}

function openPasswordModal() {
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmNewPassword').value = '';
  document.getElementById('passwordError').textContent = '';
  document.getElementById('passwordModal').style.display = '';
}

function closePasswordModal() {
  document.getElementById('passwordModal').style.display = 'none';
}

async function changePassword() {
  const oldPwd = document.getElementById('oldPassword').value;
  const newPwd = document.getElementById('newPassword').value;
  const confirmPwd = document.getElementById('confirmNewPassword').value;
  const errEl = document.getElementById('passwordError');
  errEl.textContent = '';
  if (!oldPwd) { errEl.textContent = '请输入当前密码'; return; }
  if (newPwd.length < 6 || newPwd.length > 15) { errEl.textContent = '新密码需6-15位'; return; }
  if (newPwd !== confirmPwd) { errEl.textContent = '两次密码不一致'; return; }
  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.detail || '修改失败'; return; }
    errEl.style.color = '#7CB342';
    errEl.textContent = '密码修改成功！';
    setTimeout(closePasswordModal, 1200);
  } catch { errEl.textContent = '网络连接失败'; }
}

// ─── Init ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (authToken && authUser) {
    try {
      const res = await fetch(`/api/verify?token=${encodeURIComponent(authToken)}`);
      if (res.ok) { showWelcomeAfterAuth(authUser); return; }
    } catch {}
  }
  authToken = '';
  authUser = '';
  localStorage.removeItem('fruitgame_token');
  localStorage.removeItem('fruitgame_user');
  authScreen.style.display = '';
});
