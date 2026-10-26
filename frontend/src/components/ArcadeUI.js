import React, { useEffect, useRef, useState } from 'react';
import { useEspFrame } from '../hooks/useEspFrame';

const W = 720;
const H = 480;
const SHIP_W = 44;
const SHIP_H = 24;
const FIRE_COOLDOWN = 160;

/**
 * Minimal 1D Kalman filter for a noisy angle signal.
 *
 * State is just the estimate (mean) and its variance. There is no motion
 * model because the hand does not accelerate predictably, so "predict" only
 * grows the variance by a process-noise term and "update" pulls the estimate
 * towards the measurement by the Kalman gain.
 *
 * The trick that keeps it responsive AND smooth: process noise grows with the
 * *innovation* (how far the new sample is from the estimate). A steady hand
 * produces tiny innovations, so the gain stays low and jitter is rejected; a
 * real flick produces a large innovation, so the gain rises and the estimate
 * snaps to the new position within a few frames. One fixed gain cannot do
 * both -- that is exactly why a constant lerp felt either twitchy or laggy.
 */
class AngleFilter {
  constructor() {
    this.x = null;   // estimate (degrees)
    this.p = 1;      // variance of the estimate
  }

  reset(x) {
    this.x = x;
    this.p = 1;
  }

  /**
   * @param {number} z  raw measurement
   * @param {number} dt seconds since last update
   * @param {number} r  measurement noise variance (bigger = smoother)
   */
  update(z, dt, r) {
    if (!Number.isFinite(z)) return this.x;
    if (this.x == null) {
      this.reset(z);
      return this.x;
    }

    const innovation = z - this.x;
    // Adaptive process noise: quiet when still, wide open when moving.
    const q = 0.5 + 40 * Math.abs(innovation) * Math.max(dt, 1 / 240);
    this.p += q;

    const k = this.p / (this.p + Math.max(r, 1e-3));
    this.x += k * innovation;
    this.p *= 1 - k;
    return this.x;
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Roll (tilt) in degrees, derived from gravity.
 *
 * The accelerometer measures orientation, which is absolute and drift-free
 * (unlike integrated gyro yaw), so it is the right signal for steering.
 * Steering uses the Y axis: atan2(y, |x,z|) is 0 deg upright and +/-90 deg
 * rolled onto its side. Changing STEER_AXIS below is all that is needed to
 * steer from a different axis.
 */
const STEER_AXIS = 'y';

function tiltAngle(f) {
  const ax = Number(f.accel_x) || 0;
  const ay = Number(f.accel_y) || 0;
  const az = Number(f.accel_z) || 0;
  const deg = (r) => (r * 180) / Math.PI;
  if (STEER_AXIS === 'x') return deg(Math.atan2(ax, Math.sqrt(ay * ay + az * az)));
  if (STEER_AXIS === 'z') return deg(Math.atan2(az, Math.sqrt(ax * ax + ay * ay)));
  return deg(Math.atan2(ay, Math.sqrt(ax * ax + az * az)));
}

function gyroMagnitude(f) {
  const gx = Number(f.gyro_x) || 0;
  const gy = Number(f.gyro_y) || 0;
  const gz = Number(f.gyro_z) || 0;
  return Math.sqrt(gx * gx + gy * gy + gz * gz);
}

/**
 * Arcade tab: a small top-down shooter driven by the glove.
 *
 * Controls:
 *   roll the hand left/right -> accel tilt angle, mapped directly onto the
 *                               ship's x. The ship follows the hand instead
 *                               of accelerating, so it feels like the ship
 *                               *is* your hand.
 *   bend the finger          -> fire. Flex is read relative to a learned
 *                               flat baseline, so bending (a drop in the
 *                               reading) pulls the trigger.
 *   snap the wrist           -> fire (gyro rate spike).
 *
 * Keyboard fallback: ArrowLeft / ArrowRight steer, Space fires.
 */
function ArcadeUI() {
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState({ score: 0, lives: 3, wave: 1, best: 0 });
  const [useGlove, setUseGlove] = useState(true);
  const [fireThreshold, setFireThreshold] = useState(180);
  const [tiltDeadzone, setTiltDeadzone] = useState(4);
  const [flickThreshold, setFlickThreshold] = useState(120);
  const [angleRange, setAngleRange] = useState(45);
  const [smoothing, setSmoothing] = useState(6);
  const [steerMode, setSteerMode] = useState('tilt');
  const [yawGain, setYawGain] = useState(1.5);
  const [swayAxis, setSwayAxis] = useState('x');
  const [swayGain, setSwayGain] = useState(1.0);
  const [invertSway, setInvertSway] = useState(false);
  const [invertTilt, setInvertTilt] = useState(false);
  const [invertTwist, setInvertTwist] = useState(true);
  const [tiltOffset, setTiltOffset] = useState(0);
  const [flexFlat, setFlexFlat] = useState(null);
  const [flexBent, setFlexBent] = useState(null);

  const { frame, connected } = useEspFrame(useGlove);

  // Sensor/UI state mirrored into refs so the rAF loop never re-subscribes.
  const frameRef = useRef(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const useGloveRef = useRef(true);
  const fireThresholdRef = useRef(180);
  const tiltDeadzoneRef = useRef(4);
  const flickThresholdRef = useRef(120);
  const angleRangeRef = useRef(45);
  const smoothingRef = useRef(6);
  const steerModeRef = useRef('tilt');
  const yawGainRef = useRef(1.5);
  const yawRef = useRef(0);
  const swayAxisRef = useRef('x');
  const swayGainRef = useRef(1.0);
  const invertSwayRef = useRef(false);
  const swayDcRef = useRef(0);
  const swayRef = useRef(0);
  const tiltFilterRef = useRef(new AngleFilter());
  const shipFilterRef = useRef(new AngleFilter());
  const invertRef = useRef(false);
  const invertTwistRef = useRef(true);
  const tiltOffsetRef = useRef(0);
  const flexFlatRef = useRef(null);
  const flexBentRef = useRef(null);
  const flexOnRef = useRef(false);
  const keysRef = useRef({ left: false, right: false, fire: false });

  // The whole game world lives in a ref; React only sees the HUD numbers.
  const gameRef = useRef(null);

  // Mirror of the last HUD values actually pushed to React. Comparing
  // against this is what stops setHud from firing every animation frame --
  // that used to re-render the whole tab 60x/sec and made the game feel
  // sluggish, especially once the ship was dead and nothing was changing.
  const hudRef = useRef({ score: 0, lives: 3, wave: 1, best: 0 });

  // When the game is not running the canvas only needs redrawing when
  // something actually changed, not 60 times a second.
  const dirtyRef = useRef(true);

  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { useGloveRef.current = useGlove; }, [useGlove]);
  useEffect(() => { fireThresholdRef.current = fireThreshold; }, [fireThreshold]);
  useEffect(() => { tiltDeadzoneRef.current = tiltDeadzone; }, [tiltDeadzone]);
  useEffect(() => { flickThresholdRef.current = flickThreshold; }, [flickThreshold]);
  useEffect(() => { angleRangeRef.current = angleRange; }, [angleRange]);
  useEffect(() => { smoothingRef.current = smoothing; }, [smoothing]);
  useEffect(() => { steerModeRef.current = steerMode; }, [steerMode]);
  useEffect(() => { yawGainRef.current = yawGain; }, [yawGain]);
  useEffect(() => { swayAxisRef.current = swayAxis; }, [swayAxis]);
  useEffect(() => { swayGainRef.current = swayGain; }, [swayGain]);
  useEffect(() => { invertSwayRef.current = invertSway; }, [invertSway]);
  useEffect(() => { invertRef.current = invertTilt; }, [invertTilt]);
  useEffect(() => { invertTwistRef.current = invertTwist; }, [invertTwist]);
  useEffect(() => { tiltOffsetRef.current = tiltOffset; }, [tiltOffset]);
  useEffect(() => { flexFlatRef.current = flexFlat; }, [flexFlat]);
  useEffect(() => { flexBentRef.current = flexBent; }, [flexBent]);

  // Flex reference points are captured ONCE, on demand, by the two buttons
  // below. Deliberately NOT auto-learned: an adaptive baseline slides toward
  // whatever you are holding, so after you release it still reads as "bent"
  // for a while and the ship keeps firing. That made firing look like it
  // started on release and lasted as long as the hold. Fixed values cannot
  // do that.

  const makeGame = () => ({
    ship: { x: W / 2, y: H - 46, vx: 0 },
    bullets: [],
    enemies: [],
    particles: [],
    score: 0,
    lives: 3,
    wave: 1,
    best: 0,
    lastFire: 0,
    spawnTimer: 0,
    spawnEvery: 900,
    enemySpeed: 55,
    lastTs: 0,
    hitFlash: 0,
    missed: 0,
  });

  const resetGame = () => {
    const best = gameRef.current ? gameRef.current.best : 0;
    const g = makeGame();
    g.best = best;
    gameRef.current = g;
    // Keep the HUD diff baseline in sync, otherwise the first frames after a
    // restart compare against stale values (lives: 0) and the "Game Over"
    // overlay can linger even though the game has already reset.
    hudRef.current = { score: 0, lives: 3, wave: 1, best };
    setHud(hudRef.current);
    dirtyRef.current = true;
  };

  // Keyboard fallback input.
  useEffect(() => {
    const down = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keysRef.current.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd') keysRef.current.right = true;
      if (e.key === ' ') { keysRef.current.fire = true; e.preventDefault(); }
    };
    const up = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keysRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') keysRef.current.right = false;
      if (e.key === ' ') keysRef.current.fire = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Game loop. Mounted once; reads all mutable state through refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    if (!gameRef.current) gameRef.current = makeGame();

    const draw = (g) => {
      ctx.fillStyle = '#0b0b16';
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(99,102,241,0.12)';
      for (let i = 0; i < 60; i++) {
        const sx = (i * 137.5) % W;
        const sy = (i * 89.3 + g.lastTs * 0.02 * ((i % 3) + 1)) % H;
        ctx.fillRect(sx, sy, 2, 2);
      }

      for (const p of g.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#a5b4fc';
      for (const b of g.bullets) ctx.fillRect(b.x - 2, b.y - 10, 4, 14);

      for (const e of g.enemies) {
        ctx.beginPath();
        ctx.fillStyle = e.tough ? '#f472b6' : '#f87171';
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (e.tough) {
          ctx.fillStyle = '#fde68a';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.save();
      ctx.translate(g.ship.x, g.ship.y);
      ctx.rotate(Math.max(-0.35, Math.min(0.35, g.ship.vx / 1200)));
      ctx.beginPath();
      ctx.moveTo(0, -SHIP_H / 2 - 6);
      ctx.lineTo(SHIP_W / 2, SHIP_H / 2);
      ctx.lineTo(0, SHIP_H / 2 - 8);
      ctx.lineTo(-SHIP_W / 2, SHIP_H / 2);
      ctx.closePath();
      ctx.fillStyle = g.hitFlash > 0 ? '#fca5a5' : '#818cf8';
      ctx.fill();
      ctx.strokeStyle = '#c7d2fe';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      if (g.hitFlash > 0) {
        ctx.fillStyle = 'rgba(239,68,68,' + (g.hitFlash / 400) * 0.35 + ')';
        ctx.fillRect(0, 0, W, H);
      }
    };

    const spawnEnemy = (g) => {
      const tough = Math.random() > 0.82;
      g.enemies.push({
        x: 40 + Math.random() * (W - 80),
        y: -30,
        r: 14 + Math.random() * 8,
        vy: g.enemySpeed * (0.7 + Math.random() * 0.6),
        wobble: Math.random() * Math.PI * 2,
        tough,
        hp: tough ? 2 : 1,
      });
    };

    const burst = (g, x, y, color, n) => {
      const count = n || 14;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 40 + Math.random() * 200;
        g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 420, max: 420, color });
      }
    };

    const fire = (g, ts) => {
      if (ts - g.lastFire < FIRE_COOLDOWN) return;
      g.lastFire = ts;
      g.bullets.push({ x: g.ship.x, y: g.ship.y - SHIP_H / 2, vy: -520 });
      burst(g, g.ship.x, g.ship.y - SHIP_H / 2, '#a5b4fc', 4);
    };

    const step = (ts) => {
      raf = requestAnimationFrame(step);
      try {
        const g = gameRef.current;
        if (!g) return;
      const dt = Math.min(50, ts - (g.lastTs || ts)) / 1000;
      g.lastTs = ts;

      if (!runningRef.current || pausedRef.current) {
        if (dirtyRef.current) {
          draw(g);
          dirtyRef.current = false;
        }
        return;
      }

      // ---- input: hand tilt maps straight onto ship position
      let wantFire = false;
      let tiltDeg = 0;

      if (useGloveRef.current && frameRef.current) {
        const f = frameRef.current;

        // Steering: absolute angle with a small deadzone so a resting hand
        // does not jitter. Invert is exposed in the UI because the board can
        // be mounted either way round on the hand.
        const raw = (tiltAngle(f) - tiltOffsetRef.current) * (invertRef.current ? -1 : 1);

        // Smooth before the deadzone so jitter cannot cross the threshold.
        const filtered = tiltFilterRef.current.update(raw, dt, smoothingRef.current);
        const dz = tiltDeadzoneRef.current;
        tiltDeg = Math.abs(filtered) < dz ? 0 : filtered - Math.sign(filtered) * dz;

        // Yaw assist: twist the wrist and the ship follows.
        //
        // The accelerometer cannot see yaw at all -- twisting the hand leaves
        // the gravity vector unchanged -- so this has to come from the gyro.
        // Gyro gives a *rate*, so integrate it into an angle, but integrate
        // with a leak: the angle is pulled back to zero whenever you stop
        // twisting. That trades long-term heading (impossible without a
        // magnetometer, ~10 deg/min drift) for a responsive short-term twist
        // control that returns to centre on its own.
        const yawRate = (Number(f.gyro_z) || 0) * (invertTwistRef.current ? -1 : 1);
        yawRef.current += yawRate * dt;
        yawRef.current *= Math.pow(0.2, dt); // leak: time constant ~1.2 s
        yawRef.current = clamp(yawRef.current, -angleRangeRef.current * 1.5, angleRangeRef.current * 1.5);

        const mode = steerModeRef.current;

        // Sway: actual side-to-side hand translation.
        //
        // Gravity sits in the accelerometer as a constant offset, so the raw
        // value never returns to zero even when the hand is still. Track that
        // offset as a slow-moving mean (the "DC" term) and subtract it: what
        // is left is only the dynamic acceleration from real hand movement.
        // Integrating that gives a sway amount, and the leak pulls it back to
        // centre so it cannot run away. Two integrations would give true
        // position but drift quadratically; one integration plus a leak gives
        // a responsive nudge that self-centres, which is what a shooter wants.
        const sAxis = swayAxisRef.current;
        const rawSway = (sAxis === 'y' ? Number(f.accel_y) : Number(f.accel_x)) || 0;
        const dcAlpha = Math.min(1, dt * 1.5); // ~0.7 s mean, tracks gravity only
        swayDcRef.current += (rawSway - swayDcRef.current) * dcAlpha;
        const dynamicAccel = (rawSway - swayDcRef.current) * (invertSwayRef.current ? -1 : 1);
        swayRef.current += dynamicAccel * dt * 400;
        swayRef.current *= Math.pow(0.15, dt); // leak back to centre
        swayRef.current = clamp(swayRef.current, -60, 60);

        if (mode === 'sway') {
          tiltDeg = swayRef.current * swayGainRef.current;
        } else if (mode === 'tilt+sway') {
          tiltDeg += swayRef.current * swayGainRef.current;
        }

        if (mode === 'yaw') {
          tiltDeg = yawRef.current * yawGainRef.current;
        } else if (mode === 'both' || mode === 'tilt+yaw') {
          tiltDeg += yawRef.current * yawGainRef.current;
        }

        // Trigger 1: flex, hold-to-fire with hysteresis.
        //
        // With both reference points captured, "bent" is decided purely by
        // which reference the reading is nearer, and the margin creates a
        // hysteresis band so the signal cannot chatter at the boundary.
        // While the flag is on the ship fires every frame (rate-limited by
        // fire() to FIRE_COOLDOWN); as soon as the finger comes back past the
        // band it switches off. No timer, no decay, no lag.
        const flex = Number(f.flex_0);
        const flat = flexFlatRef.current;
        const bentV = flexBentRef.current;
        if (Number.isFinite(flex) && Number.isFinite(flat) && Number.isFinite(bentV)
            && flat !== bentV) {
          const dir = bentV < flat ? -1 : 1; // direction from flat towards bent
          const mid = (flat + bentV) / 2;
          const margin = Math.max(3, Math.abs(flat - bentV) * 0.08);
          const d = dir * (flex - mid); // >0 means bent side
          if (d > margin) flexOnRef.current = true;
          else if (d < -margin) flexOnRef.current = false;
          if (flexOnRef.current) wantFire = true;
        } else if (Number.isFinite(flex)) {
          // Uncalibrated fallback: plain threshold on the raw reading.
          if (flex > fireThresholdRef.current) wantFire = true;
        }

        // Trigger 2: wrist flick. Gyro is a rotation *rate*, so a snap shows
        // up as a spike even though integrated yaw angle would drift away.
        if (gyroMagnitude(f) > flickThresholdRef.current) wantFire = true;
      }

      if (keysRef.current.left) tiltDeg = -angleRangeRef.current * 0.8;
      if (keysRef.current.right) tiltDeg = angleRangeRef.current * 0.8;
      if (keysRef.current.fire) wantFire = true;

      // Map angle directly to x: the ship mirrors the hand. Hold it half
      // right and the ship sits half right. The lerp only smooths sensor
      // noise and produces a bank angle; there is no momentum to fight.
      const halfSpan = W / 2 - SHIP_W / 2 - 6;
      const targetX = W / 2 + clamp(tiltDeg / angleRangeRef.current, -1, 1) * halfSpan;
      // Second, much heavier filter on the mapped position. The angle filter
      // cleans the sensor; this one removes the residual crawl in pixels, so
      // the ship glides instead of shivering. Larger R here means more
      // smoothing, since pixel noise is far smaller than degree noise.
      const filteredX = shipFilterRef.current.update(targetX, dt, smoothingRef.current * 4);
      const prevX = g.ship.x;
      g.ship.x = clamp(filteredX, SHIP_W / 2 + 6, W - SHIP_W / 2 - 6);
      g.ship.vx = dt > 0 ? (g.ship.x - prevX) / dt : 0;

      if (wantFire) fire(g, ts);

      for (const b of g.bullets) b.y += b.vy * dt;
      g.bullets = g.bullets.filter((b) => b.y > -20);

      g.spawnTimer += dt * 1000;
      if (g.spawnTimer >= g.spawnEvery) {
        g.spawnTimer = 0;
        spawnEnemy(g);
      }

      for (const e of g.enemies) {
        e.y += e.vy * dt;
        e.wobble += dt * 3;
        e.x += Math.sin(e.wobble) * 30 * dt;
        e.x = Math.max(e.r, Math.min(W - e.r, e.x));
      }

      for (const b of g.bullets) {
        if (b.dead) continue;
        for (const e of g.enemies) {
          if (e.dead) continue;
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (dx * dx + dy * dy < (e.r + 3) * (e.r + 3)) {
            b.dead = true;
            e.hp -= 1;
            burst(g, e.x, e.y, '#fbbf24', 4);
            if (e.hp <= 0) {
              e.dead = true;
              g.score += e.tough ? 50 : 20;
              burst(g, e.x, e.y, '#f87171', e.tough ? 24 : 14);
            }
          }
        }
      }
      g.bullets = g.bullets.filter((b) => !b.dead);
      g.enemies = g.enemies.filter((e) => !e.dead);

      for (const e of g.enemies) {
        const nearX = Math.abs(e.x - g.ship.x) < e.r + SHIP_W / 2;
        const nearY = Math.abs(e.y - g.ship.y) < e.r + SHIP_H / 2;
        if (nearX && nearY) {
          // Only an actual collision costs a life. An enemy that slips past
          // is simply removed: with the old rule every miss also cost a life,
          // so three leaks ended the run almost immediately and the game felt
          // like it had frozen / stopped responding.
          e.dead = true;
          g.lives -= 1;
          g.hitFlash = 260;
          burst(g, e.x, e.y, '#f87171', 20);
        } else if (e.y - e.r > H) {
          e.dead = true;
          g.missed = (g.missed || 0) + 1;
        }
      }
      g.enemies = g.enemies.filter((e) => !e.dead);

      if (g.hitFlash > 0) g.hitFlash -= dt * 1000;

      for (const p of g.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 120 * dt;
        p.life -= dt * 1000;
      }
      g.particles = g.particles.filter((p) => p.life > 0);

      const wave = 1 + Math.floor(g.score / 300);
      if (wave !== g.wave) {
        g.wave = wave;
        g.spawnEvery = Math.max(280, 900 - (wave - 1) * 110);
        g.enemySpeed = 55 + (wave - 1) * 18;
      }

      if (g.lives <= 0) {
        g.best = Math.max(g.best || 0, g.score);
        runningRef.current = false;
        setRunning(false);
      }

      // Only touch React state when a displayed number actually changed.
      const nextHud = {
        score: g.score,
        lives: Math.max(0, g.lives),
        wave: g.wave,
        best: g.best || 0,
      };
      const prevHud = hudRef.current;
      if (prevHud.score !== nextHud.score
          || prevHud.lives !== nextHud.lives
          || prevHud.wave !== nextHud.wave
          || prevHud.best !== nextHud.best) {
        hudRef.current = nextHud;
        setHud(nextHud);
      }

      draw(g);
      } catch (err) {
        // Never let one bad frame wedge the loop: the requestAnimationFrame
        // above is already scheduled, so we just log and carry on. Without
        // this an exception left the canvas frozen while the UI still looked
        // alive.
        console.error('arcade frame error', err);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = () => {
    if (!gameRef.current || gameRef.current.lives <= 0) resetGame();
    gameRef.current.lastTs = 0;
    dirtyRef.current = true;
    setPaused(false);
    setRunning(true);
  };

  const stop = () => {
    dirtyRef.current = true;
    setRunning(false);
    setPaused(false);
  };

  const togglePause = () => {
    if (!running) return;
    dirtyRef.current = true;
    setPaused((p) => !p);
  };

  const flexValue = frame ? Number(frame.flex_0) : NaN;
  const calibrated = Number.isFinite(flexFlat) && Number.isFinite(flexBent) && flexFlat !== flexBent;
  const bent = calibrated ? flexOnRef.current : (Number.isFinite(flexValue) && flexValue > fireThreshold);
  const gyroRate = frame ? gyroMagnitude(frame) : NaN;
  const ax = frame ? (tiltAngle(frame) - tiltOffset) * (invertTilt ? -1 : 1) : NaN;

  // Capture the current pose as "straight ahead". Resting hand poses vary a
  // lot (we have seen accel_y anywhere from 0.16 to 0.82), so a fixed neutral
  // would leave the ship pinned to one edge.
  const setNeutral = () => {
    if (frame) {
      const t = tiltAngle(frame);
      setTiltOffset(t);
      tiltFilterRef.current.reset(0);
      shipFilterRef.current.reset(W / 2);
      yawRef.current = 0;
      swayRef.current = 0;
      swayDcRef.current = 0;
    }
  };

  // One-shot captures of the two flex reference poses. Press FLAT with the
  // finger straight, BENT with it curled. Firing then follows the travel
  // between those two readings, whichever direction the sensor runs.
  // Nothing is learned in the background.
  const captureFlat = () => {
    if (frame) {
      setFlexFlat(Number(frame.flex_0));
      flexOnRef.current = false;
    }
  };

  const captureBent = () => {
    if (frame) setFlexBent(Number(frame.flex_0));
  };

  return (
    <div className='arc-wrap'>
      <div className='card arc-card'>
        <div className='arc-head'>
          <div>
            <h2>Arcade — Flex Shooter</h2>
            <p>Roll your hand to fly, bend your finger to shoot.</p>
            <p className='arc-sub'>Steering axis: accel_{STEER_AXIS} · neutral {Math.round(tiltOffset)}°</p>
          </div>
          <div className='arc-hud'>
            <div className='arc-stat'><label>Score</label><b>{hud.score}</b></div>
            <div className='arc-stat'><label>Lives</label><b className={hud.lives <= 1 ? 'warn' : ''}>{hud.lives}</b></div>
            <div className='arc-stat'><label>Wave</label><b>{hud.wave}</b></div>
            <div className='arc-stat'><label>Best</label><b>{hud.best}</b></div>
          </div>
        </div>

        <div className='arc-stage'>
          <canvas ref={canvasRef} width={W} height={H} className='arc-canvas' />
          {!running && (
            <div className='arc-overlay'>
              <div className='arc-overlay-title'>{hud.lives <= 0 ? 'Game Over' : 'Ready'}</div>
              {hud.lives <= 0 && <div className='arc-overlay-sub'>Score {hud.score} · Best {hud.best}</div>}
              <button className='btn' onClick={start}>Start</button>
            </div>
          )}
          {running && paused && (
            <div className='arc-overlay'>
              <div className='arc-overlay-title'>Paused</div>
              <button className='btn' onClick={togglePause}>Resume</button>
            </div>
          )}
        </div>

        <div className='arc-controls'>
          <button className='btn' onClick={start} disabled={running && !paused}>Start</button>
          <button className='btn secondary' onClick={togglePause} disabled={!running}>Pause</button>
          <button className='btn secondary' onClick={stop} disabled={!running && !paused}>Stop</button>
          <span className='arc-hint'>← → steer · Space fire</span>
        </div>

        <div className='arc-settings'>
          <label className='arc-toggle'>
            <input type='checkbox' checked={useGlove} onChange={(e) => setUseGlove(e.target.checked)} />
            Glove input {connected ? <span className='arc-live'>live</span> : <span className='arc-dead'>no device</span>}
          </label>

          <label className='arc-slider'>
            Steering source
            <select value={steerMode} onChange={(e) => setSteerMode(e.target.value)}>
              <option value='sway'>hand move side to side (sway)</option>
              <option value='tilt+sway'>tilt + sway</option>
              <option value='tilt'>tilt only (gravity/roll)</option>
              <option value='yaw'>wrist twist only (gyro)</option>
              <option value='tilt+yaw'>tilt + wrist twist</option>
            </select>
          </label>

          <label className='arc-slider'>
            Sway axis
            <select value={swayAxis} onChange={(e) => setSwayAxis(e.target.value)}>
              <option value='x'>accel_x</option>
              <option value='y'>accel_y</option>
            </select>
          </label>

          <label className='arc-slider'>
            Sway gain <b>{swayGain.toFixed(1)}x</b>
            <input type='range' min='0.2' max='5' step='0.1' value={swayGain}
              onChange={(e) => setSwayGain(parseFloat(e.target.value))} />
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={invertSway} onChange={(e) => setInvertSway(e.target.checked)} />
            Invert sway
          </label>

          <label className='arc-slider'>
            Twist gain <b>{yawGain.toFixed(1)}x</b>
            <input type='range' min='0.2' max='5' step='0.1' value={yawGain}
              onChange={(e) => setYawGain(parseFloat(e.target.value))} />
          </label>

          <label className='arc-slider'>
            Tilt range <b>±{angleRange}°</b>
            <input type='range' min='10' max='90' step='1' value={angleRange}
              onChange={(e) => setAngleRange(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Smoothing <b>{smoothing}</b> (higher = smoother, more lag)
            <input type='range' min='1' max='40' step='1' value={smoothing}
              onChange={(e) => setSmoothing(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Tilt deadzone <b>±{tiltDeadzone}°</b>
            <input type='range' min='0' max='20' step='1' value={tiltDeadzone}
              onChange={(e) => setTiltDeadzone(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={invertTilt} onChange={(e) => setInvertTilt(e.target.checked)} />
            Invert tilt
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={invertTwist} onChange={(e) => setInvertTwist(e.target.checked)} />
            Invert twist
          </label>

          <button className='btn secondary' onClick={setNeutral} disabled={!frame}>
            Set neutral (hold hand level)
          </button>

          <div className='arc-calib'>
            <button className='btn secondary' onClick={captureFlat} disabled={!frame}>
              Capture FLAT ({Number.isFinite(flexFlat) ? Math.round(flexFlat) : 'not set'})
            </button>
            <button className='btn secondary' onClick={captureBent} disabled={!frame}>
              Capture BENT ({Number.isFinite(flexBent) ? Math.round(flexBent) : 'not set'})
            </button>
          </div>

          {!calibrated && (
            <label className='arc-slider'>
              Uncalibrated: fire above raw flex <b>{fireThreshold}</b>
              <input type='range' min='10' max='1000' step='10' value={fireThreshold}
                onChange={(e) => setFireThreshold(parseInt(e.target.value, 10))} />
            </label>
          )}

          <label className='arc-slider'>
            Flick trigger <b>{flickThreshold} dps</b>
            <input type='range' min='40' max='500' step='10' value={flickThreshold}
              onChange={(e) => setFlickThreshold(parseInt(e.target.value, 10))} />
          </label>

          <div className='arc-sensor'>
            <div className='arc-stat'><label>tilt</label><b>{Number.isFinite(ax) ? Math.round(ax) + '°' : '—'}</b></div>
            <div className='arc-stat'><label>sway</label><b>{frame ? Math.round(swayRef.current * swayGain) : '—'}</b></div>
            <div className='arc-stat'><label>twist</label><b>{frame ? Math.round(yawRef.current) + '°' : '—'}</b></div>
            <div className='arc-stat'><label>|gyro|</label><b>{Number.isFinite(gyroRate) ? Math.round(gyroRate) : '—'}</b></div>
            <div className='arc-stat'><label>flex</label><b>{Number.isFinite(flexValue) ? Math.round(flexValue) : '—'}</b></div>
            <div className='arc-stat'><label>firing</label><b className={bent ? 'ok' : ''}>{bent ? 'ON' : 'off'}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ArcadeUI;
