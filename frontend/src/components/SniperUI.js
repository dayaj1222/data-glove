import React, { useEffect, useRef, useState } from 'react';
import { useEspFrame } from '../hooks/useEspFrame';
import AngleFilter from '../lib/angleFilter';
import { Pointer, clamp } from '../lib/pointer';

const W = 800;
const H = 520;
const SHOT_COOLDOWN = 380; // ms between shots (bolt action)
const MAG_SIZE = 5;
const RELOAD_MS = 1200;
const HORIZON = H * 0.6;   // sky meets distant hills
const FLOOR_Y = H * 0.74;  // front edge of the earth berm

// Fixed star field (deterministic, so the sky does not shimmer between frames).
const STARS = Array.from({ length: 70 }, (_, i) => {
  const a = Math.sin(i * 127.1) * 43758.5453;
  const b = Math.sin(i * 311.7) * 12543.321;
  const c = Math.sin(i * 74.7) * 9187.77;
  return {
    x: (a - Math.floor(a)) * W,
    y: (b - Math.floor(b)) * HORIZON * 0.8,
    r: 0.4 + (c - Math.floor(c)) * 1.1,
    tw: i * 0.7,
  };
});

/** Ridge line y at x: layered sines make a believable mountain silhouette. */
const ridge = (x, base, amp, f) =>
  base - amp * (0.55 * Math.sin(x * f) + 0.3 * Math.sin(x * f * 2.3 + 1.7) + 0.15 * Math.sin(x * f * 5.1 + 0.4));

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Target range: point the glove's index finger at a bullseye and fire.
 *
 * Board mounting: +X along the finger (at the screen), +Y up, +Z to the right.
 * The crosshair is where the finger points. Pitch comes from gravity (absolute)
 * and yaw from the integrated gyro (see lib/pointer.js); there is no
 * magnetometer, so yaw drifts slowly and is cancelled with Recenter (C).
 *
 * Trigger: Space / Enter, mouse click on the range, or the flex sensor.
 */
function SniperUI() {
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [hud, setHud] = useState({
    score: 0, shots: 0, hits: 0, bullseyes: 0, ammo: MAG_SIZE, reloading: false, best: 0,
  });
  const [useGlove, setUseGlove] = useState(true);
  const [maxAngle, setMaxAngle] = useState(24);
  const [smoothing, setSmoothing] = useState(3);
  const [deadzone, setDeadzone] = useState(1.0);
  const [gyroGate, setGyroGate] = useState(1.5);
  const [flexChannel, setFlexChannel] = useState(1);
  const [invertX, setInvertX] = useState(false);
  const [invertY, setInvertY] = useState(false);
  const [flexFlat, setFlexFlat] = useState(null);
  const [flexBent, setFlexBent] = useState(null);
  const [triggerMode, setTriggerMode] = useState('raw-above');
  const [fireFlex, setFireFlex] = useState(100);

  const { frame, connected } = useEspFrame(useGlove);

  // Everything the animation loop reads lives in refs, so the loop can be
  // mounted exactly once and never re-subscribe on a state change.
  const frameRef = useRef(null);
  const runningRef = useRef(false);
  const useGloveRef = useRef(true);
  const maxAngleRef = useRef(28);
  const smoothingRef = useRef(6);
  const deadzoneRef = useRef(1.5);
  const invertXRef = useRef(false);
  const invertYRef = useRef(false);
  const gyroGateRef = useRef(8.0);
  const flexChannelRef = useRef(1);
  const flexFlatRef = useRef(null);
  const flexBentRef = useRef(null);
  const triggerModeRef = useRef('raw-above');
  const fireFlexRef = useRef(100);

  // Pointer fuses gyro+accel into pitch/yaw; the two position filters then
  // remove residual crawl in pixels so the reticle glides.
  const pointerRef = useRef(new Pointer());
  const xFilterRef = useRef(new AngleFilter());
  const yFilterRef = useRef(new AngleFilter());

  const fireRequestRef = useRef(false);
  const flexWasRef = useRef(false);
  const rangeRef = useRef(null);
  const hudRef = useRef(null);
  const dirtyRef = useRef(true);
  const audioRef = useRef(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);

  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { useGloveRef.current = useGlove; }, [useGlove]);
  useEffect(() => { maxAngleRef.current = maxAngle; }, [maxAngle]);
  useEffect(() => { smoothingRef.current = smoothing; }, [smoothing]);
  useEffect(() => { deadzoneRef.current = deadzone; }, [deadzone]);
  useEffect(() => { invertXRef.current = invertX; }, [invertX]);
  useEffect(() => { invertYRef.current = invertY; }, [invertY]);
  useEffect(() => { gyroGateRef.current = gyroGate; }, [gyroGate]);
  useEffect(() => { flexChannelRef.current = flexChannel; }, [flexChannel]);
  useEffect(() => { flexFlatRef.current = flexFlat; }, [flexFlat]);
  useEffect(() => { flexBentRef.current = flexBent; }, [flexBent]);
  useEffect(() => { triggerModeRef.current = triggerMode; }, [triggerMode]);
  useEffect(() => { fireFlexRef.current = fireFlex; }, [fireFlex]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // WebAudio shot. Synthesised rather than loaded: a noise burst through a
  // fast decaying lowpass gives a convincing crack with no asset to fetch,
  // and the context is created lazily on the first shot so the browser's
  // autoplay policy never blocks it.
  const playShot = () => {
    if (mutedRef.current) return;
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
      const dur = 0.22;

      // Noise body
      const frames = Math.floor(ac.sampleRate * dur);
      const buffer = ac.createBuffer(1, frames, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        const t = i / frames;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
      }
      const noise = ac.createBufferSource();
      noise.buffer = buffer;

      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, now);
      lp.frequency.exponentialRampToValueAtTime(320, now + dur);

      const noiseGain = ac.createGain();
      noiseGain.gain.setValueAtTime(0.5, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(lp).connect(noiseGain).connect(ac.destination);
      noise.start(now);
      noise.stop(now + dur);

      // Low thump for weight
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
      const oscGain = ac.createGain();
      oscGain.gain.setValueAtTime(0.35, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(oscGain).connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (err) {
      console.warn('audio unavailable', err);
    }
  };

  // Dry-fire click, so an empty mag still feels like an action.
  const playClick = () => {
    if (mutedRef.current) return;
    try {
      const ac = audioRef.current;
      if (!ac) return;
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(900, now);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(g).connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch (err) {
      /* ignore */
    }
  };

  const makeRange = () => ({
    targets: [],
    tracers: [],
    marks: [],
    particles: [],
    clock: 0,
    score: 0,
    shots: 0,
    hits: 0,
    bullseyes: 0,
    best: 0,
    ammo: MAG_SIZE,
    reloadUntil: 0,
    lastShot: 0,
    spawnTimer: 0,
    spawnEvery: 1300,
    lastTs: 0,
    reticle: { x: W / 2, y: H / 2 },
    muzzle: 0,
    shake: 0,
    hitStop: 0,
  });

  const resetRange = () => {
    const best = rangeRef.current ? rangeRef.current.best : 0;
    const r = makeRange();
    r.best = best;
    rangeRef.current = r;
    xFilterRef.current.reset(W / 2);
    yFilterRef.current.reset(H / 2);
    pointerRef.current.reseed();      // re-seed from gravity next frame
    hudRef.current = null;
    dirtyRef.current = true;
  };

  // Keyboard: Space / Enter fire, R reloads.
  //
  // F1 was the original trigger but browsers reserve it for help: Chrome and
  // Firefox frequently never deliver the keydown at all (or open the help
  // panel instead), so shots were silently dropped. Space and Enter are
  // delivered reliably; F1 is still accepted where the browser allows it.
  useEffect(() => {
    const isFireKey = (e) =>
      e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter' || e.code === 'Space';

    const down = (e) => {
      if (isFireKey(e)) {
        e.preventDefault();
        fireRequestRef.current = true;
      } else if (e.key === 'F1') {
        e.preventDefault();
        fireRequestRef.current = true;
      } else if (e.key === 'c' || e.key === 'C') {
        pointerRef.current.recenterYaw();
        xFilterRef.current.reset(W / 2);
        yFilterRef.current.reset(H / 2);
      } else if (e.key === 'r' || e.key === 'R') {
        const r = rangeRef.current;
        if (r && r.reloadUntil === 0 && r.ammo < MAG_SIZE) {
          r.reloadUntil = performance.now() + RELOAD_MS;
        }
      }
    };
    const up = (e) => {
      if (e.key === 'F1') e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    if (!rangeRef.current) rangeRef.current = makeRange();

    const spawnTarget = (r) => {
      const rad = 20 + Math.random() * 20;
      r.targets.push({
        x: 80 + Math.random() * (W - 160),
        y: 90 + Math.random() * (H - 230),
        r: rad,
        life: 5200,
        max: 5200,
      });
      r.spawnEvery = Math.max(600, 1300 - r.score / 40);
    };

    // Debris / dust: small particles flung out from (x, y), pulled down by gravity.
    const burst = (r, x, y, n, color, speed, life) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.7);
        r.particles.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.25,
          life: life * 1000 * (0.6 + Math.random() * 0.4), max: life * 1000,
          size: 1.5 + Math.random() * 2.5, color,
        });
      }
    };

    const fire = (r, ts) => {
      if (ts - r.lastShot < SHOT_COOLDOWN) return;
      if (r.reloadUntil > 0) return;
      if (r.ammo <= 0) {
        r.reloadUntil = ts + RELOAD_MS;
        playClick();
        return;
      }

      r.lastShot = ts;
      r.ammo -= 1;
      r.shots += 1;
      r.muzzle = 150;   // ms of muzzle flash
      r.shake = 7;      // px of screen shake
      playShot();

      const { x, y } = r.reticle;
      r.tracers.push({ x2: x, y2: y, life: 220, max: 220 });

      // Nearest target whose ring contains the crosshair.
      let hit = null;
      let bestD = Infinity;
      for (const t of r.targets) {
        const dx = x - t.x;
        const dy = y - t.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= t.r && d < bestD) {
          bestD = d;
          hit = t;
        }
      }

      if (!hit) {
        r.marks.push({ x, y, kind: 'miss', life: 520, max: 520 });
        burst(r, x, y, 9, '#94a3b8', 110, 0.5);
        return;
      }

      r.hits += 1;
      const frac = bestD / hit.r;
      let gained = 25;
      let ring = 'outer';
      if (frac < 0.28) {
        gained = 100;
        ring = 'bull';
        r.bullseyes += 1;
      } else if (frac < 0.62) {
        gained = 50;
        ring = 'inner';
      }
      r.score += gained;
      r.best = Math.max(r.best, r.score);
      hit.dead = true;
      r.hitStop = 70;
      r.shake = ring === 'bull' ? 12 : 9;
      r.marks.push({ x: hit.x, y: hit.y, kind: ring, life: 700, max: 700, gain: gained });
      burst(r, hit.x, hit.y, ring === 'bull' ? 26 : 16, ring === 'bull' ? '#f87171' : '#e2e8f0', 220, 0.8);
    };

    const drawScene = (r) => {
      // Parallax: far layers slide less than near ones as the aim moves, which
      // is what makes the scene read as a real view being swept.
      const ox = r.reticle.x - W / 2;
      const t = r.clock / 1000;

      ctx.save();
      if (r.shake > 0) {
        const sh = r.shake;
        ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
      }

      // ---- sky (dusk)
      const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 10);
      sky.addColorStop(0, '#070b1e');
      sky.addColorStop(0.45, '#1b2a5a');
      sky.addColorStop(0.8, '#6b4d8f');
      sky.addColorStop(1, '#f0966a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, HORIZON + 10);

      for (const st of STARS) {
        const a = (1 - st.y / (HORIZON * 0.8)) * (0.5 + 0.5 * Math.sin(t * 1.4 + st.tw));
        ctx.globalAlpha = clamp(a, 0, 0.9);
        ctx.fillStyle = '#e0e7ff';
        ctx.beginPath();
        ctx.arc(st.x - ox * 0.01, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // low sun with glow
      const sx = W * 0.74 - ox * 0.02;
      const glow = ctx.createRadialGradient(sx, HORIZON, 4, sx, HORIZON, 230);
      glow.addColorStop(0, 'rgba(255,214,150,0.95)');
      glow.addColorStop(0.2, 'rgba(255,160,110,0.45)');
      glow.addColorStop(1, 'rgba(255,120,90,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, HORIZON + 10);

      // drifting clouds
      ctx.fillStyle = 'rgba(30,22,60,0.5)';
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 260 + t * (6 + i * 2)) % (W + 300)) - 150 - ox * 0.03;
        const cy = 70 + i * 38;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 90, 11, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 40, cy - 6, 55, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- far mountains, mid hills, tree line (each darker and faster)
      const layer = (color, base, amp, freq, par, step) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-60, H);
        for (let x = -60; x <= W + 60; x += step) {
          ctx.lineTo(x, ridge(x - ox * par, base, amp, freq));
        }
        ctx.lineTo(W + 60, H);
        ctx.closePath();
        ctx.fill();
      };
      layer('#3b3a6e', HORIZON - 8, 70, 0.0075, 0.03, 12);
      layer('#272a57', HORIZON + 8, 42, 0.012, 0.06, 10);
      layer('#161a3a', HORIZON + 26, 22, 0.02, 0.1, 8);

      // pine silhouettes on the near ridge
      ctx.fillStyle = '#0d1029';
      for (let i = 0; i < 46; i++) {
        const tx = ((i * 37.3) % (W + 80)) - 40 - ox * 0.12;
        const ty = ridge(tx + ox * 0.0, HORIZON + 30, 18, 0.02) + 4;
        const th = 14 + ((i * 53) % 17);
        ctx.beginPath();
        ctx.moveTo(tx, ty - th);
        ctx.lineTo(tx - th * 0.28, ty);
        ctx.lineTo(tx + th * 0.28, ty);
        ctx.closePath();
        ctx.fill();
      }

      // ---- range floor: lit grass with perspective lanes
      const ground = ctx.createLinearGradient(0, HORIZON + 30, 0, H);
      ground.addColorStop(0, '#2a3a3a');
      ground.addColorStop(0.35, '#1c2a2c');
      ground.addColorStop(1, '#0a1114');
      ctx.fillStyle = ground;
      ctx.fillRect(0, HORIZON + 30, W, H - HORIZON - 30);

      const vpx = W / 2 - ox * 0.12;
      ctx.strokeStyle = 'rgba(210,230,200,0.10)';
      ctx.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo(vpx, HORIZON + 30);
        ctx.lineTo(vpx + i * 170, H);
        ctx.stroke();
      }
      for (let i = 1; i < 9; i++) {
        const y = HORIZON + 30 + Math.pow(i / 9, 2.1) * (H - HORIZON - 30);
        ctx.globalAlpha = 0.05 + i * 0.012;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // earth berm the targets stand behind
      const berm = ctx.createLinearGradient(0, FLOOR_Y - 14, 0, FLOOR_Y + 22);
      berm.addColorStop(0, '#4a3b30');
      berm.addColorStop(0.25, '#352b25');
      berm.addColorStop(1, '#171210');
      ctx.fillStyle = berm;
      ctx.fillRect(0, FLOOR_Y, W, 22);
      ctx.fillStyle = 'rgba(255,200,150,0.18)';
      ctx.fillRect(0, FLOOR_Y, W, 2);

      // ---- targets: post, ground shadow, board
      for (const tg of r.targets) {
        const age = tg.max - tg.life;
        const pop = clamp(age / 220, 0, 1);
        const sc = Math.max(0.001, easeOutBack(pop));
        const fade = clamp(tg.life / 700, 0, 1);

        ctx.globalAlpha = fade;
        // ground shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(tg.x + 6, FLOOR_Y + 12, tg.r * 0.9 * sc, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        // post
        ctx.strokeStyle = '#2b211b';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(tg.x, tg.y);
        ctx.lineTo(tg.x, FLOOR_Y + 10);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,220,180,0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tg.x - 1.5, tg.y);
        ctx.lineTo(tg.x - 1.5, FLOOR_Y + 10);
        ctx.stroke();

        const rr = tg.r * sc;
        // rim + face
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr + 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0b1220';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = '#f1f5f9';
        ctx.fill();
        // inner scoring ring (matches the 0.62 hit boundary)
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr * 0.45, 0, Math.PI * 2);
        ctx.stroke();
        // bullseye (matches the 0.28 boundary)
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tg.x - rr * 0.07, tg.y - rr * 0.07, rr * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fill();
        // face highlight
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr, Math.PI * 1.15, Math.PI * 1.55);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // time-left arc around the board
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, rr + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(tg.life / tg.max, 0, 1));
        ctx.strokeStyle = tg.life < 1400 ? 'rgba(248,113,113,0.85)' : 'rgba(125,211,252,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ---- particles
      for (const p of r.particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // ---- tracers (hot core over a soft glow)
      for (const tr of r.tracers) {
        const a = clamp(tr.life / tr.max, 0, 1);
        ctx.globalAlpha = a * 0.35;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(W / 2, H + 10);
        ctx.lineTo(tr.x2, tr.y2);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#fff7d6';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ---- impact marks
      for (const m of r.marks) {
        const a = clamp(m.life / m.max, 0, 1);
        ctx.globalAlpha = a;
        if (m.kind === 'miss') {
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(m.x - 6, m.y - 6);
          ctx.lineTo(m.x + 6, m.y + 6);
          ctx.moveTo(m.x + 6, m.y - 6);
          ctx.lineTo(m.x - 6, m.y + 6);
          ctx.stroke();
        } else {
          const color = m.kind === 'bull' ? '#f87171' : m.kind === 'inner' ? '#fbbf24' : '#4ade80';
          const grow = 1 + (1 - a) * 0.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(m.x, m.y, 16 * grow, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.font = 'bold 16px ui-monospace, monospace';
          ctx.fillText('+' + m.gain, m.x + 22, m.y - 14 - (1 - a) * 18);
        }
        ctx.globalAlpha = 1;
      }

      // ---- scope vignette (dark rim, clear centre on the reticle)
      const { x, y } = r.reticle;
      const vig = ctx.createRadialGradient(x, y, 150, x, y, 560);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // ---- reticle: long hairlines, thick posts, mil-dots, centre dot
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x - 34, y); ctx.lineTo(x - 9, y);
      ctx.moveTo(x + 9, y); ctx.lineTo(x + 34, y);
      ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 9);
      ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 34);
      ctx.stroke();
      ctx.strokeStyle = '#c7d2fe';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = '#c7d2fe';
      for (let k = 1; k <= 3; k++) {
        const d = 12 + k * 14;
        for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#f87171';
      ctx.fill();
      ctx.strokeStyle = 'rgba(165,180,252,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 52, 0, Math.PI * 2);
      ctx.stroke();

      // ---- muzzle flash + hit flash
      if (r.muzzle > 0) {
        const m = r.muzzle / 150;
        const flash = ctx.createRadialGradient(W / 2, H + 20, 0, W / 2, H + 20, 340 * m);
        flash.addColorStop(0, 'rgba(253,230,138,' + (0.85 * m) + ')');
        flash.addColorStop(0.45, 'rgba(251,191,36,' + (0.35 * m) + ')');
        flash.addColorStop(1, 'rgba(251,191,36,0)');
        ctx.fillStyle = flash;
        ctx.fillRect(0, 0, W, H);

        ctx.globalAlpha = m * 0.9;
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 56 + (1 - m) * 30, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (r.hitStop > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + (r.hitStop / 70) * 0.12 + ')';
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
    };

    const step = (ts) => {
      raf = requestAnimationFrame(step);
      try {
        const r = rangeRef.current;
        if (!r) return;
        const dt = Math.min(50, ts - (r.lastTs || ts)) / 1000;
        r.lastTs = ts;
        r.clock += dt * 1000;

        if (!runningRef.current) {
          if (dirtyRef.current) {
            drawScene(r);
            dirtyRef.current = false;
          }
          return;
        }

        // ---- aiming: finger pitch -> vertical, finger yaw -> horizontal
        let wantFire = fireRequestRef.current;
        fireRequestRef.current = false;

        if (useGloveRef.current && frameRef.current) {
          const f = frameRef.current;
          const maxDeg = maxAngleRef.current;
          const dzDeg = deadzoneRef.current;
          const rNoise = smoothingRef.current;

          const pos = pointerRef.current.update(f, dt, {
            yawGate: gyroGateRef.current,
            yawLimit: maxDeg * 1.6,
          });
          if (pos) {
            const dz = (v) => (Math.abs(v) < dzDeg ? 0 : v - Math.sign(v) * dzDeg);
            const yawDeg = dz(pos.yaw) * (invertXRef.current ? -1 : 1);
            const pitchDeg = dz(pos.pitch) * (invertYRef.current ? -1 : 1);

            // One pixels-per-degree for both axes, so a 10 degree swing is the
            // same distance sideways as it is up.
            const pxPerDeg = (W / 2 - 30) / maxDeg;
            const targetX = W / 2 + clamp(yawDeg * pxPerDeg, -(W / 2 - 30), W / 2 - 30);
            const targetY = H / 2 - clamp(pitchDeg * pxPerDeg, -(H / 2 - 30), H / 2 - 30);

            r.reticle.x = clamp(xFilterRef.current.update(targetX, dt, rNoise * 4), 10, W - 10);
            r.reticle.y = clamp(yFilterRef.current.update(targetY, dt, rNoise * 4), 10, H - 10);
          }

          // Flex trigger. Three modes:
          //   raw-above / raw-below : plain comparison against fireFlex
          //   calibrated            : bend measured between FLAT and BENT
          //
          // The raw modes exist because the calibrated path needs BOTH
          // captures before it will fire at all, which made the trigger look
          // dead whenever they had not been taken.
          const flex = Number(f[`flex_${flexChannelRef.current}`]);
          const flat = flexFlatRef.current;
          const bentV = flexBentRef.current;
          const mode = triggerModeRef.current;

          if (Number.isFinite(flex)) {
            let isBent = false;

            if (mode === 'raw-above') {
              isBent = flex > fireFlexRef.current;
            } else if (mode === 'raw-below') {
              isBent = flex < fireFlexRef.current;
            } else if (Number.isFinite(flat) && Number.isFinite(bentV) && flat !== bentV) {
              const dir = bentV < flat ? -1 : 1;
              const mid = (flat + bentV) / 2;
              const margin = Math.max(3, Math.abs(flat - bentV) * 0.1);
              isBent = dir * (flex - mid) > margin;
            }

            // Calibrated mode is edge-triggered (one bend = one shot); the raw
            // modes fire on every frame the condition holds, which is what
            // makes a plain threshold feel responsive.
            if (mode === 'calibrated') {
              if (isBent && !flexWasRef.current) wantFire = true;
            } else if (isBent) {
              wantFire = true;
            }
            flexWasRef.current = isBent;
          }
        }

        // ---- targets
        r.spawnTimer += dt * 1000;
        if (r.spawnTimer >= r.spawnEvery) {
          r.spawnTimer = 0;
          spawnTarget(r);
        }
        for (const t of r.targets) t.life -= dt * 1000;
        r.targets = r.targets.filter((t) => !t.dead && t.life > 0);

        // ---- reload bookkeeping
        if (r.reloadUntil > 0 && ts >= r.reloadUntil) {
          r.reloadUntil = 0;
          r.ammo = MAG_SIZE;
        } else if (r.ammo <= 0 && r.reloadUntil === 0) {
          r.reloadUntil = ts + RELOAD_MS;
        }

        if (wantFire) fire(r, ts);

        // ---- effects
        for (const tr of r.tracers) tr.life -= dt * 1000;
        r.tracers = r.tracers.filter((tr) => tr.life > 0);
        if (r.muzzle > 0) r.muzzle -= dt * 1000;
        if (r.hitStop > 0) r.hitStop -= dt * 1000;
        if (r.shake > 0) r.shake = Math.max(0, r.shake - dt * 46);
        for (const p of r.particles) {
          p.life -= dt * 1000;
          p.vy += 520 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
        r.particles = r.particles.filter((p) => p.life > 0);
        for (const m of r.marks) m.life -= dt * 1000;
        r.marks = r.marks.filter((m) => m.life > 0);

        // ---- HUD, only when a displayed value actually changes
        const next = {
          score: r.score,
          shots: r.shots,
          hits: r.hits,
          bullseyes: r.bullseyes,
          ammo: r.ammo,
          reloading: r.reloadUntil > 0,
          best: r.best,
        };
        const prev = hudRef.current;
        if (!prev
            || prev.score !== next.score
            || prev.shots !== next.shots
            || prev.hits !== next.hits
            || prev.bullseyes !== next.bullseyes
            || prev.ammo !== next.ammo
            || prev.reloading !== next.reloading
            || prev.best !== next.best) {
          hudRef.current = next;
          setHud(next);
        }

        drawScene(r);
      } catch (err) {
        // A single bad frame must never wedge the loop.
        console.error('sniper frame error', err);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = () => {
    if (!rangeRef.current || rangeRef.current.shots === 0) resetRange();
    rangeRef.current.lastTs = 0;
    dirtyRef.current = true;
    setRunning(true);
  };

  const stop = () => {
    dirtyRef.current = true;
    setRunning(false);
  };

  const resetAim = () => {
    xFilterRef.current.reset(W / 2);
    yFilterRef.current.reset(H / 2);
    if (rangeRef.current) rangeRef.current.reticle = { x: W / 2, y: H / 2 };
  };

  // Current pose becomes the aim centre (pitch from gravity, yaw to zero).
  const setNeutral = () => {
    if (!frame) return;
    pointerRef.current.calibrate(frame);
    resetAim();
  };

  // Cancel accumulated gyro yaw drift without touching the pitch neutral.
  const recenter = () => {
    pointerRef.current.recenterYaw();
    resetAim();
  };

  const captureFlat = () => {
    if (frame) setFlexFlat(Number(frame[`flex_${flexChannelRef.current}`]));
  };

  const captureBent = () => {
    if (frame) setFlexBent(Number(frame[`flex_${flexChannelRef.current}`]));
  };

  const accuracy = hud.shots > 0 ? Math.round((hud.hits / hud.shots) * 100) : 0;
  const ptr = pointerRef.current;
  const pitchNow = ptr.ready ? ptr.pitch : NaN;
  const yawNow = ptr.ready ? ptr.yaw : NaN;
  const gyroNow = frame ? Math.hypot(Number(frame.gyro_x) || 0, Number(frame.gyro_y) || 0, Number(frame.gyro_z) || 0) : NaN;

  return (
    <div className='arc-wrap'>
      <div className='card arc-card'>
        <div className='arc-head'>
          <div>
            <h2>Sniper Range</h2>
            <p>Point your index finger at a bullseye and bend it to fire.</p>
            <p className='arc-sub'>
              Board on the finger: +X at the screen, +Y up, +Z right. Pitch the finger to aim up/down, swing it to aim sideways. Press C to recenter yaw drift.
            </p>
          </div>
          <div className='arc-hud'>
            <div className='arc-stat'><label>Score</label><b>{hud.score}</b></div>
            <div className='arc-stat'><label>Ammo</label><b className={hud.ammo === 0 ? 'warn' : ''}>{hud.reloading ? 'RLD' : hud.ammo + '/' + MAG_SIZE}</b></div>
            <div className='arc-stat'><label>Accuracy</label><b>{accuracy}%</b></div>
            <div className='arc-stat'><label>Bulls</label><b>{hud.bullseyes}</b></div>
            <div className='arc-stat'><label>Best</label><b>{hud.best}</b></div>
          </div>
        </div>

        <div className='arc-stage'>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className='arc-canvas'
            onMouseDown={(e) => { e.preventDefault(); fireRequestRef.current = true; }}
          />
          {!running && (
            <div className='arc-overlay'>
              <div className='arc-overlay-title'>Range hot</div>
              <div className='arc-overlay-sub'>Score {hud.score} · Accuracy {accuracy}%</div>
              <button className='btn' onClick={start}>Start</button>
            </div>
          )}
        </div>

        <div className='arc-controls'>
          <button className='btn' onClick={start} disabled={running}>Start</button>
          <button className='btn secondary' onClick={stop} disabled={!running}>Stop</button>
          <button className='btn secondary' onClick={setNeutral} disabled={!frame}>Set neutral (aim centre)</button>
          <button className='btn secondary' onClick={recenter} disabled={!frame}>Recenter yaw (C)</button>
          <label className='arc-toggle'>
            <input type='checkbox' checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
            Sound
          </label>
          <button
            className='btn'
            onMouseDown={(e) => { e.preventDefault(); fireRequestRef.current = true; }}
            disabled={!running}
          >
            FIRE
          </button>
          <span className='arc-hint'>Space / Enter fire · R reload</span>
        </div>

        <div className='arc-settings'>
          <label className='arc-toggle'>
            <input type='checkbox' checked={useGlove} onChange={(e) => setUseGlove(e.target.checked)} />
            Glove input {connected ? <span className='arc-live'>live</span> : <span className='arc-dead'>no device</span>}
          </label>

          <label className='arc-slider'>
            Flex channel <b>{flexChannel}</b>
            <select value={flexChannel} onChange={(e) => setFlexChannel(parseInt(e.target.value, 10))}>
              <option value={0}>flex_0 (D34)</option>
              <option value={1}>flex_1 (D35)</option>
            </select>
          </label>

          <label className='arc-slider'>
            Flex trigger mode
            <select value={triggerMode} onChange={(e) => setTriggerMode(e.target.value)}>
              <option value='raw-above'>fire when flex &gt; threshold</option>
              <option value='raw-below'>fire when flex &lt; threshold</option>
              <option value='calibrated'>calibrated (FLAT / BENT)</option>
            </select>
          </label>

          <label className='arc-slider'>
            Flex threshold <b>{fireFlex}</b>
            <input type='range' min='0' max='1000' step='5' value={fireFlex}
              onChange={(e) => setFireFlex(parseInt(e.target.value, 10))} />
          </label>

          <div className='arc-calib'>
            <button className='btn secondary' onClick={captureFlat} disabled={!frame}>
              Capture FLAT ({Number.isFinite(flexFlat) ? Math.round(flexFlat) : 'not set'})
            </button>
            <button className='btn secondary' onClick={captureBent} disabled={!frame}>
              Capture BENT ({Number.isFinite(flexBent) ? Math.round(flexBent) : 'not set'})
            </button>
          </div>

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
            Yaw noise gate <b>{gyroGate.toFixed(1)} deg/s</b>
            <input type='range' min='0' max='6' step='0.1' value={gyroGate}
              onChange={(e) => setGyroGate(parseFloat(e.target.value))} />
          </label>

          <label className='arc-slider'>
            Deadzone <b>±{deadzone}°</b>
            <input type='range' min='0' max='12' step='0.5' value={deadzone}
              onChange={(e) => setDeadzone(parseFloat(e.target.value))} />
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
            <div className='arc-stat'><label>pitch</label><b>{Number.isFinite(pitchNow) ? Math.round(pitchNow) + '°' : '—'}</b></div>
            <div className='arc-stat'><label>yaw</label><b>{Number.isFinite(yawNow) ? Math.round(yawNow) + '°' : '—'}</b></div>
            <div className='arc-stat'><label>gyro</label><b>{Number.isFinite(gyroNow) ? Math.round(gyroNow) : '—'}</b></div>
            <div className='arc-stat'><label>flex {flexChannel}</label><b>{frame ? Math.round(Number(frame[`flex_${flexChannel}`])) : '—'}</b></div>
            <div className='arc-stat'><label>shots</label><b>{hud.shots}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SniperUI;
