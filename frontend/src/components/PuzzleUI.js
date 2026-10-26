import React, { useEffect, useRef, useState } from 'react';
import { useEspFrame } from '../hooks/useEspFrame';
import AngleFilter from '../lib/angleFilter';
import { Pointer, clamp } from '../lib/pointer';

const W = 800;
const H = 520;
const BOARD = 340;                 // longest board side, px
const SNAP = 0.42;                 // snap radius as a fraction of a cell
const GRAB = 0.62;                 // pick radius as a fraction of a cell
const TRAY = { x0: 40, x1: 360, y0: 80, y1: H - 70 };
const DIFFS = {
  easy: { cols: 3, rows: 2, label: 'Easy · 6 pieces' },
  medium: { cols: 3, rows: 3, label: 'Medium · 9 pieces' },
  hard: { cols: 4, rows: 4, label: 'Hard · 16 pieces' },
};
const SCENES = { dusk: 'Dusk valley', galaxy: 'Ringed planet', city: 'Night city' };

// ---------------------------------------------------------------- artwork
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Procedural picture, so the puzzle needs no image assets. */
function paintScene(kind, w, h, seed) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const rand = rng(seed);

  if (kind === 'galaxy') {
    const bg = g.createRadialGradient(w * 0.4, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.8);
    bg.addColorStop(0, '#2a1650'); bg.addColorStop(0.6, '#0e0b2a'); bg.addColorStop(1, '#04030f');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.globalAlpha = 0.3 + rand() * 0.7;
      g.fillStyle = rand() < 0.2 ? '#fcd34d' : '#e0e7ff';
      g.beginPath(); g.arc(rand() * w, rand() * h, 0.4 + rand() * 1.4, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    const cx = w * 0.52; const cy = h * 0.5; const pr = h * 0.27;
    const body = g.createLinearGradient(cx - pr, cy - pr, cx + pr, cy + pr);
    body.addColorStop(0, '#f59e0b'); body.addColorStop(0.5, '#c2410c'); body.addColorStop(1, '#4c1d95');
    // ring behind
    g.strokeStyle = 'rgba(253,230,138,0.65)'; g.lineWidth = 10;
    g.beginPath(); g.ellipse(cx, cy, pr * 1.9, pr * 0.5, -0.35, Math.PI, Math.PI * 2); g.stroke();
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, pr, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, pr, 0, 7); g.clip();
    for (let i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(255,255,255,' + (0.05 + rand() * 0.12) + ')';
      g.fillRect(cx - pr, cy - pr + i * pr * 0.3 + rand() * 8, pr * 2, pr * 0.13);
    }
    const shade = g.createRadialGradient(cx - pr * 0.4, cy - pr * 0.4, pr * 0.2, cx, cy, pr * 1.2);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,10,0.75)');
    g.fillStyle = shade; g.fillRect(cx - pr, cy - pr, pr * 2, pr * 2);
    g.restore();
    g.strokeStyle = 'rgba(253,230,138,0.9)'; g.lineWidth = 10;
    g.beginPath(); g.ellipse(cx, cy, pr * 1.9, pr * 0.5, -0.35, 0, Math.PI); g.stroke();
    g.fillStyle = '#93c5fd'; g.beginPath(); g.arc(w * 0.16, h * 0.78, h * 0.07, 0, 7); g.fill();
  } else if (kind === 'city') {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b1030'); sky.addColorStop(0.7, '#5b2a6e'); sky.addColorStop(1, '#f472b6');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fef3c7'; g.beginPath(); g.arc(w * 0.78, h * 0.22, h * 0.09, 0, 7); g.fill();
    g.fillStyle = 'rgba(11,16,48,0.9)'; g.beginPath(); g.arc(w * 0.8, h * 0.2, h * 0.085, 0, 7); g.fill();
    for (let layer = 0; layer < 2; layer++) {
      let x = -10;
      while (x < w) {
        const bw = 26 + rand() * 40;
        const bh = h * (layer ? 0.25 : 0.4) + rand() * h * 0.3;
        g.fillStyle = layer ? '#1b1038' : '#0b0720';
        g.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 8; wy < h - 8; wy += 12) {
          for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
            if (rand() < 0.45) {
              g.fillStyle = rand() < 0.7 ? '#fde68a' : '#67e8f9';
              g.globalAlpha = layer ? 0.55 : 0.95;
              g.fillRect(wx, wy, 4, 6);
            }
          }
        }
        g.globalAlpha = 1;
        x += bw + 2 + rand() * 4;
      }
    }
  } else {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, '#1d2b64'); sky.addColorStop(0.6, '#f8b195'); sky.addColorStop(1, '#fde68a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff7d6'; g.beginPath(); g.arc(w * 0.68, h * 0.5, h * 0.11, 0, 7); g.fill();
    const ridge = (base, amp, f, col) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        g.lineTo(x, base - amp * (0.6 * Math.sin(x * f + seed) + 0.4 * Math.sin(x * f * 2.7 + 1)));
      }
      g.lineTo(w, h); g.fill();
    };
    ridge(h * 0.62, h * 0.16, 0.014, '#6d4c7d');
    ridge(h * 0.72, h * 0.11, 0.02, '#3e3563');
    const lake = g.createLinearGradient(0, h * 0.78, 0, h);
    lake.addColorStop(0, '#f9a88a'); lake.addColorStop(1, '#2a3166');
    g.fillStyle = lake; g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = 'rgba(255,247,214,0.5)';
    for (let i = 0; i < 9; i++) g.fillRect(w * 0.68 - 40 + rand() * 80, h * 0.8 + i * (h * 0.02), 20 + rand() * 40, 2);
    g.fillStyle = '#1a1a2e';
    for (let i = 0; i < 20; i++) {
      const tx = w * (i / 20) + rand() * 20; const th = 18 + rand() * 24;
      g.beginPath(); g.moveTo(tx, h * 0.78); g.lineTo(tx - 8, h * 0.78 + th); g.lineTo(tx + 8, h * 0.78 + th); g.fill();
    }
  }
  // thin frame so the edge pieces read as edges
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  return cv;
}

// ---------------------------------------------------------------- jigsaw cut
/** One edge with an optional tab (sign +1) or slot (-1), clockwise traversal. */
function edgeTo(ctx, x0, y0, x1, y1, sign) {
  if (!sign) { ctx.lineTo(x1, y1); return; }
  const dx = x1 - x0; const dy = y1 - y0;
  const L = Math.hypot(dx, dy);
  const ux = dx / L; const uy = dy / L;
  const nx = uy; const ny = -ux;              // outward normal when clockwise
  const P = (t, hgt) => [x0 + ux * L * t + nx * L * hgt * sign, y0 + uy * L * t + ny * L * hgt * sign];
  ctx.lineTo(...P(0.38, 0));
  ctx.bezierCurveTo(...P(0.38, 0.10), ...P(0.30, 0.21), ...P(0.5, 0.21));
  ctx.bezierCurveTo(...P(0.70, 0.21), ...P(0.62, 0.10), ...P(0.62, 0));
  ctx.lineTo(x1, y1);
}

function piecePath(ctx, x, y, s, e) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  edgeTo(ctx, x, y, x + s, y, e.t);
  edgeTo(ctx, x + s, y, x + s, y + s, e.r);
  edgeTo(ctx, x + s, y + s, x, y + s, e.b);
  edgeTo(ctx, x, y + s, x, y, e.l);
  ctx.closePath();
}

function buildPuzzle(kind, diff, seed) {
  const { cols, rows } = DIFFS[diff];
  const cell = Math.floor(BOARD / Math.max(cols, rows));
  const bw = cols * cell;
  const bh = rows * cell;
  const bx = Math.round(400 + (380 - bw) / 2);
  const by = Math.round((H - bh) / 2 + 12);
  const img = paintScene(kind, bw, bh, seed);
  const rand = rng(seed * 7 + 3);

  // Shared edges: one random in/out choice per internal edge.
  const hE = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rand() < 0.5 ? 1 : -1)));
  const vE = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rand() < 0.5 ? 1 : -1)));

  const pad = Math.ceil(cell * 0.26) + 3;
  const size = cell + pad * 2;
  const pieces = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = {
        r: c < cols - 1 ? hE[r][c] : 0,
        l: c > 0 ? -hE[r][c - 1] : 0,
        b: r < rows - 1 ? vE[r][c] : 0,
        t: r > 0 ? -vE[r - 1][c] : 0,
      };
      const sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const g = sprite.getContext('2d');
      g.save();
      piecePath(g, pad, pad, cell, e);
      g.clip();
      g.drawImage(img, pad - c * cell, pad - r * cell);
      // soft inner bevel
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = 5;
      g.stroke();
      g.restore();
      piecePath(g, pad, pad, cell, e);
      g.strokeStyle = 'rgba(8,10,24,0.75)';
      g.lineWidth = 1.6;
      g.stroke();

      const tx = bx + c * cell + cell / 2;
      const ty = by + r * cell + cell / 2;
      pieces.push({
        id: r * cols + c, c, r, sprite, tx, ty, x: tx, y: ty, placed: false, e,
      });
    }
  }
  return { kind, diff, cols, rows, cell, bx, by, bw, bh, img, pad, size, pieces };
}

function scatter(pz, seed) {
  const rand = rng(seed * 13 + 5);
  const order = pz.pieces.slice().sort(() => rand() - 0.5);
  const m = pz.size / 2 - 6;
  order.forEach((p, i) => {
    p.placed = false;
    p.x = clamp(TRAY.x0 + rand() * (TRAY.x1 - TRAY.x0), m, W / 2 - m);
    p.y = clamp(TRAY.y0 + rand() * (TRAY.y1 - TRAY.y0), m, H - m);
    p.z = i;
  });
  pz.pieces = order;
}

// ---------------------------------------------------------------- component
function PuzzleUI() {
  const canvasRef = useRef(null);
  const [kind, setKind] = useState('dusk');
  const [diff, setDiff] = useState('easy');
  const [running, setRunning] = useState(false);
  const [hud, setHud] = useState({ placed: 0, total: 6, moves: 0, time: 0, done: false });
  const [useGlove, setUseGlove] = useState(true);
  const [maxAngle, setMaxAngle] = useState(24);
  const [smoothing, setSmoothing] = useState(3);
  const [yawGate, setYawGate] = useState(1.5);
  const [invertX, setInvertX] = useState(false);
  const [invertY, setInvertY] = useState(false);
  const [flexChannel, setFlexChannel] = useState(1);
  const [flexMode, setFlexMode] = useState('above');
  const [flexThreshold, setFlexThreshold] = useState(100);
  const [peek, setPeek] = useState(false);
  const [muted, setMuted] = useState(false);

  const { frame, connected } = useEspFrame(useGlove);

  const frameRef = useRef(null);
  const runningRef = useRef(false);
  const settingsRef = useRef({});
  const pzRef = useRef(null);
  const pointerRef = useRef(new Pointer());
  const xFilterRef = useRef(new AngleFilter());
  const yFilterRef = useRef(new AngleFilter());
  const mouseRef = useRef({ x: W / 2, y: H / 2, down: false, active: false });
  const keyDownRef = useRef(false);
  const audioRef = useRef(null);
  const hudRef = useRef(null);
  const dirtyRef = useRef(true);

  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => {
    settingsRef.current = {
      useGlove, maxAngle, smoothing, yawGate, invertX, invertY,
      flexChannel, flexMode, flexThreshold, peek, muted,
    };
    dirtyRef.current = true;
  }, [useGlove, maxAngle, smoothing, yawGate, invertX, invertY, flexChannel, flexMode, flexThreshold, peek, muted]);

  // Short synthesised sounds: no assets, and the context is created lazily on
  // the first user gesture so autoplay policy never blocks it.
  const tone = (freq, dur, type = 'sine', gain = 0.12, slideTo = null) => {
    if (settingsRef.current.muted) return;
    try {
      let ac = audioRef.current;
      if (!ac) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        ac = new Ctx();
        audioRef.current = ac;
      }
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      const o = ac.createOscillator();
      const gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, now);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
      gn.gain.setValueAtTime(gain, now);
      gn.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.connect(gn).connect(ac.destination);
      o.start(now);
      o.stop(now + dur + 0.02);
    } catch (err) { /* ignore */ }
  };

  const newPuzzle = (k = kind, d = diff) => {
    const seed = Math.floor(Math.random() * 1e6) + 1;
    const pz = buildPuzzle(k, d, seed);
    scatter(pz, seed);
    Object.assign(pz, {
      held: null, off: { x: 0, y: 0 }, hover: null, moves: 0, placed: 0,
      time: 0, started: false, done: false, confetti: [], flashes: [],
      cursor: { x: W / 2, y: H / 2 }, wasGrab: false, clock: 0, lastTs: 0,
    });
    pzRef.current = pz;
    pointerRef.current.reseed();
    xFilterRef.current.reset(W / 2);
    yFilterRef.current.reset(H / 2);
    hudRef.current = null;
    setHud({ placed: 0, total: pz.pieces.length, moves: 0, time: 0, done: false });
    dirtyRef.current = true;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { newPuzzle('dusk', 'easy'); }, []);

  const start = () => {
    if (!pzRef.current || pzRef.current.done) newPuzzle();
    pzRef.current.lastTs = 0;
    setRunning(true);
  };
  const stop = () => { setRunning(false); dirtyRef.current = true; };

  const setNeutral = () => {
    if (!frame) return;
    pointerRef.current.calibrate(frame);
    xFilterRef.current.reset(W / 2);
    yFilterRef.current.reset(H / 2);
  };
  const recenter = () => {
    pointerRef.current.recenterYaw();
    xFilterRef.current.reset(W / 2);
    yFilterRef.current.reset(H / 2);
  };

  // Keyboard: hold Space to grab, C recenters, R reshuffles.
  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); keyDownRef.current = true; }
      else if (e.key === 'c' || e.key === 'C') {
        pointerRef.current.recenterYaw();
        xFilterRef.current.reset(W / 2);
        yFilterRef.current.reset(H / 2);
      }
    };
    const up = (e) => {
      if (e.code === 'Space' || e.key === ' ') keyDownRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ------------------------------------------------------------ game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let flexHeld = false;   // hysteresis state of the flex trigger

    // Topmost loose piece whose centre is within pick radius of (x, y).
    const topPieceAt = (pz, x, y) => {
      let best = null;
      for (const p of pz.pieces) {
        if (p.placed || Math.hypot(x - p.x, y - p.y) > pz.cell * GRAB) continue;
        if (!best || p.z > best.z) best = p;
      }
      return best;
    };

    const confetti = (pz) => {
      const cols = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc'];
      for (let i = 0; i < 120; i++) {
        pz.confetti.push({
          x: W / 2 + (Math.random() - 0.5) * 200, y: H * 0.35,
          vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 380,
          life: 2200 + Math.random() * 1200, max: 3400,
          c: cols[i % cols.length], s: 4 + Math.random() * 5,
        });
      }
    };

    const drop = (pz) => {
      const p = pz.held;
      pz.held = null;
      if (!p) return;
      pz.moves += 1;
      if (Math.hypot(p.x - p.tx, p.y - p.ty) < pz.cell * SNAP) {
        p.placed = true;
        pz.placed += 1;
        pz.flashes.push({ x: p.tx, y: p.ty, life: 500, max: 500 });
        tone(660, 0.09, 'triangle', 0.14);
        setTimeout(() => tone(990, 0.12, 'triangle', 0.12), 70);
        if (pz.placed === pz.pieces.length) {
          pz.done = true;
          confetti(pz);
          [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.14), i * 110));
        }
      } else {
        tone(220, 0.08, 'sine', 0.1, 140);
      }
    };

    const drawPiece = (p, scale, glow) => {
      const pz = pzRef.current;
      const s = pz.size * scale;
      ctx.save();
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 20;
      } else if (!p.placed) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
      }
      ctx.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
      ctx.restore();
    };

    const draw = (pz) => {
      const st = settingsRef.current;
      // desk
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#141a2e'); bg.addColorStop(1, '#0a0e1c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(165,180,252,0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // tray
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = 'rgba(165,180,252,0.18)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.roundRect(16, 56, 368, H - 86, 14); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(199,210,254,0.55)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText('PIECES', 30, 78);

      // board frame
      ctx.fillStyle = '#10152b';
      ctx.strokeStyle = 'rgba(165,180,252,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(pz.bx - 14, pz.by - 14, pz.bw + 28, pz.bh + 28, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(199,210,254,0.55)';
      ctx.fillText('BOARD', pz.bx - 14, pz.by - 22);

      // ghost image + slot outlines
      ctx.globalAlpha = st.peek ? 0.95 : 0.13;
      ctx.drawImage(pz.img, pz.bx, pz.by);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(165,180,252,0.28)';
      ctx.lineWidth = 1;
      for (const p of pz.pieces) {
        ctx.save();
        ctx.translate(p.tx - pz.cell / 2 - pz.pad, p.ty - pz.cell / 2 - pz.pad);
        piecePath(ctx, pz.pad, pz.pad, pz.cell, p.e);
        ctx.stroke();
        ctx.restore();
      }

      // snap-radius hint while carrying
      if (pz.held) {
        ctx.strokeStyle = 'rgba(125,211,252,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(pz.held.tx, pz.held.ty, pz.cell * SNAP, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // pieces: locked first, then loose by z, carried one on top
      for (const p of pz.pieces) if (p.placed) drawPiece(p, 1, null);
      for (const f of pz.flashes) {
        const a = clamp(f.life / f.max, 0, 1);
        ctx.strokeStyle = 'rgba(134,239,172,' + a + ')';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x, f.y, pz.cell * (0.4 + (1 - a) * 0.5), 0, Math.PI * 2); ctx.stroke();
      }
      const loose = pz.pieces.filter((p) => !p.placed && p !== pz.held).sort((a, b) => a.z - b.z);
      for (const p of loose) drawPiece(p, 1, p === pz.hover ? '#a5b4fc' : null);
      if (pz.held) drawPiece(pz.held, 1.08, '#7dd3fc');

      // confetti
      for (const c of pz.confetti) {
        ctx.globalAlpha = clamp(c.life / c.max, 0, 1);
        ctx.fillStyle = c.c;
        ctx.fillRect(c.x, c.y, c.s, c.s * 0.6);
      }
      ctx.globalAlpha = 1;

      // cursor: open ring when free, filled when gripping
      const { x, y } = pz.cursor;
      const gripping = !!pz.held;
      ctx.strokeStyle = gripping ? '#7dd3fc' : pz.hover ? '#a5b4fc' : 'rgba(226,232,240,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, gripping ? 9 : 14, 0, Math.PI * 2); ctx.stroke();
      if (gripping) {
        ctx.fillStyle = 'rgba(125,211,252,0.35)';
        ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill();

      if (pz.done) {
        ctx.fillStyle = 'rgba(6,10,24,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.font = '700 38px system-ui, sans-serif';
        ctx.fillText('Puzzle complete!', W / 2, H / 2 - 12);
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillStyle = '#c7d2fe';
        ctx.fillText(pz.time.toFixed(1) + ' s · ' + pz.moves + ' moves', W / 2, H / 2 + 20);
        ctx.textAlign = 'start';
      }
    };

    const step = (ts) => {
      raf = requestAnimationFrame(step);
      try {
        const pz = pzRef.current;
        if (!pz) return;
        const dt = Math.min(50, ts - (pz.lastTs || ts)) / 1000;
        pz.lastTs = ts;
        const st = settingsRef.current;

        if (!runningRef.current) {
          if (dirtyRef.current) { draw(pz); dirtyRef.current = false; }
          return;
        }

        // ---- cursor: glove pointer, or the mouse when glove input is off
        const f = frameRef.current;
        let grab = keyDownRef.current || mouseRef.current.down;
        if (st.useGlove && f) {
          const pos = pointerRef.current.update(f, dt, { yawGate: st.yawGate, yawLimit: st.maxAngle * 1.6 });
          if (pos) {
            const yawDeg = pos.yaw * (st.invertX ? -1 : 1);
            const pitchDeg = pos.pitch * (st.invertY ? -1 : 1);
            const pxPerDeg = (W / 2 - 24) / st.maxAngle;
            const tx = W / 2 + clamp(yawDeg * pxPerDeg, -(W / 2 - 14), W / 2 - 14);
            const ty = H / 2 - clamp(pitchDeg * pxPerDeg, -(H / 2 - 14), H / 2 - 14);
            pz.cursor.x = clamp(xFilterRef.current.update(tx, dt, st.smoothing * 4), 4, W - 4);
            pz.cursor.y = clamp(yFilterRef.current.update(ty, dt, st.smoothing * 4), 4, H - 4);
          }
          // Flex grab with hysteresis so a wobbling value cannot chatter.
          const v = Number(f[`flex_${st.flexChannel}`]);
          if (Number.isFinite(v)) {
            const sign = st.flexMode === 'above' ? 1 : -1;
            const margin = 30;
            if (!flexHeld && sign * (v - st.flexThreshold) > margin) flexHeld = true;
            else if (flexHeld && sign * (v - st.flexThreshold) < -margin) flexHeld = false;
            if (flexHeld) grab = true;
          }
        } else if (!st.useGlove && mouseRef.current.active) {
          pz.cursor.x = mouseRef.current.x;
          pz.cursor.y = mouseRef.current.y;
        }

        // ---- grab / carry / drop
        if (pz.done) {
          grab = false;
        }
        if (grab && !pz.wasGrab && !pz.held) {
          const hit = topPieceAt(pz, pz.cursor.x, pz.cursor.y);
          if (hit) {
            pz.held = hit;
            pz.off = { x: hit.x - pz.cursor.x, y: hit.y - pz.cursor.y };
            hit.z = Math.max(...pz.pieces.map((q) => q.z)) + 1;
            pz.started = true;
            tone(420, 0.05, 'square', 0.05);
          }
        } else if (!grab && pz.held) {
          drop(pz);
        }
        pz.wasGrab = grab;

        if (pz.held) {
          const k = Math.min(1, dt * 22);
          pz.held.x += (pz.cursor.x + pz.off.x - pz.held.x) * k;
          pz.held.y += (pz.cursor.y + pz.off.y - pz.held.y) * k;
        }
        pz.hover = pz.held ? null : topPieceAt(pz, pz.cursor.x, pz.cursor.y);

        // placed pieces glide into their slot
        for (const p of pz.pieces) {
          if (p.placed) {
            const k = Math.min(1, dt * 18);
            p.x += (p.tx - p.x) * k;
            p.y += (p.ty - p.y) * k;
          }
        }

        if (pz.started && !pz.done) pz.time += dt;
        pz.clock += dt * 1000;
        for (const c of pz.confetti) {
          c.life -= dt * 1000;
          c.vy += 700 * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
        }
        pz.confetti = pz.confetti.filter((c) => c.life > 0);
        for (const fl of pz.flashes) fl.life -= dt * 1000;
        pz.flashes = pz.flashes.filter((fl) => fl.life > 0);

        const next = {
          placed: pz.placed, total: pz.pieces.length, moves: pz.moves,
          time: Math.floor(pz.time), done: pz.done,
        };
        const prev = hudRef.current;
        if (!prev || prev.placed !== next.placed || prev.moves !== next.moves
            || prev.time !== next.time || prev.done !== next.done) {
          hudRef.current = next;
          setHud(next);
        }

        draw(pz);
      } catch (err) {
        console.error('puzzle frame error', err);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, []);

  const canvasPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  const flexNow = frame ? Math.round(Number(frame[`flex_${flexChannel}`])) : null;
  const ptr = pointerRef.current;
  const pitchNow = ptr.ready ? Math.round(ptr.pitch) : null;
  const yawNow = ptr.ready ? Math.round(ptr.yaw) : null;

  return (
    <div className='arc-wrap'>
      <div className='card arc-card'>
        <div className='arc-head'>
          <div>
            <h2>Puzzle</h2>
            <p>Point your index finger at a piece, bend it to pick the piece up, then carry it to its slot and straighten the finger to drop it.</p>
            <p className='arc-sub'>
              Space also grabs (hold). C recenters the pointer. A piece snaps in when it is dropped close to its slot.
            </p>
          </div>
          <div className='arc-hud'>
            <div className='arc-stat'><label>Placed</label><b className={hud.done ? 'ok' : ''}>{hud.placed}/{hud.total}</b></div>
            <div className='arc-stat'><label>Moves</label><b>{hud.moves}</b></div>
            <div className='arc-stat'><label>Time</label><b>{hud.time}s</b></div>
          </div>
        </div>

        <div className='arc-stage'>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className='arc-canvas'
            onMouseMove={(e) => { mouseRef.current = { ...mouseRef.current, ...canvasPoint(e), active: true }; }}
            onMouseDown={(e) => { e.preventDefault(); mouseRef.current = { ...mouseRef.current, ...canvasPoint(e), down: true, active: true }; }}
            onMouseUp={() => { mouseRef.current.down = false; }}
            onMouseLeave={() => { mouseRef.current.down = false; }}
          />
          {!running && (
            <div className='arc-overlay'>
              <div className='arc-overlay-title'>{hud.done ? 'Puzzle complete!' : 'Ready'}</div>
              <div className='arc-overlay-sub'>{SCENES[kind]} · {DIFFS[diff].label}</div>
              <button className='btn' onClick={start}>{hud.done ? 'Play again' : 'Start'}</button>
            </div>
          )}
        </div>

        <div className='arc-controls'>
          <button className='btn' onClick={start} disabled={running}>Start</button>
          <button className='btn secondary' onClick={stop} disabled={!running}>Pause</button>
          <button className='btn secondary' onClick={() => newPuzzle()}>Shuffle new</button>
          <button className='btn secondary' onClick={setNeutral} disabled={!frame}>Set neutral</button>
          <button className='btn secondary' onClick={recenter} disabled={!frame}>Recenter (C)</button>
          <label className='arc-toggle'>
            <input type='checkbox' checked={peek} onChange={(e) => setPeek(e.target.checked)} />
            Show picture
          </label>
          <label className='arc-toggle'>
            <input type='checkbox' checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
            Sound
          </label>
        </div>

        <div className='arc-settings'>
          <label className='arc-slider'>
            Picture
            <select value={kind} onChange={(e) => { setKind(e.target.value); newPuzzle(e.target.value, diff); }}>
              {Object.entries(SCENES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>

          <label className='arc-slider'>
            Difficulty
            <select value={diff} onChange={(e) => { setDiff(e.target.value); newPuzzle(kind, e.target.value); }}>
              {Object.entries(DIFFS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={useGlove} onChange={(e) => setUseGlove(e.target.checked)} />
            Glove input {connected ? <span className='arc-live'>live</span> : <span className='arc-dead'>no device</span>}
          </label>

          <label className='arc-slider'>
            Grab flex channel
            <select value={flexChannel} onChange={(e) => setFlexChannel(parseInt(e.target.value, 10))}>
              <option value={0}>flex_0 (D34)</option>
              <option value={1}>flex_1 (D35)</option>
            </select>
          </label>

          <label className='arc-slider'>
            Grab when
            <select value={flexMode} onChange={(e) => setFlexMode(e.target.value)}>
              <option value='above'>flex above threshold</option>
              <option value='below'>flex below threshold</option>
            </select>
          </label>

          <label className='arc-slider'>
            Grab threshold <b>{flexThreshold}</b> (now {flexNow ?? '—'})
            <input type='range' min='0' max='4095' step='10' value={flexThreshold}
              onChange={(e) => setFlexThreshold(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Aim range <b>±{maxAngle}°</b>
            <input type='range' min='8' max='60' step='1' value={maxAngle}
              onChange={(e) => setMaxAngle(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Smoothing <b>{smoothing}</b>
            <input type='range' min='1' max='40' step='1' value={smoothing}
              onChange={(e) => setSmoothing(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Yaw noise gate <b>{yawGate.toFixed(1)} deg/s</b>
            <input type='range' min='0' max='6' step='0.1' value={yawGate}
              onChange={(e) => setYawGate(parseFloat(e.target.value))} />
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={invertX} onChange={(e) => setInvertX(e.target.checked)} />
            Invert horizontal
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={invertY} onChange={(e) => setInvertY(e.target.checked)} />
            Invert vertical
          </label>

          <div className='arc-sensor'>
            <div className='arc-stat'><label>pitch</label><b>{pitchNow != null ? pitchNow + '°' : '—'}</b></div>
            <div className='arc-stat'><label>yaw</label><b>{yawNow != null ? yawNow + '°' : '—'}</b></div>
            <div className='arc-stat'><label>flex {flexChannel}</label><b>{flexNow ?? '—'}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PuzzleUI;
