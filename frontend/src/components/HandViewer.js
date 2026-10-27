import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Mahony, headingOf } from '../lib/orientation';

const FRAME_DT = 1 / 50;               // firmware sends at a fixed 50 Hz
const STORE_KEY = 'handviewer.flexcal.v1';
const REST_FRAMES = 50;                // 1 s of stillness at 50 Hz
const REST_GYRO = 4;                   // deg/s: below this the hand counts as still
const LEVEL_COS = Math.cos(12 * Math.PI / 180);   // back of the hand within 12 deg of flat
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const D2R = Math.PI / 180;

/**
 * Board mounting presets: rows give BODY coordinates (x right, y up out of the back
 * of the hand, z toward the wrist) from SENSOR coordinates.
 */
const MOUNTS = {
  'flat-thumb': {
    label: 'Board flat on the back of the hand, X to the fingers, Y to the thumb side',
    B: [[0, -1, 0], [0, 0, 1], [-1, 0, 0]],
  },
  'flat-wrist': {
    label: 'Board flat, X toward the wrist, Y to the little-finger side',
    B: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  },
  edge: {
    label: 'Board on edge: Y up, X to the fingers, Z to the right',
    B: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  },
};

// Earth (Z up) -> three.js world (Y up, -Z away from the viewer)
const W = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

const mat3to4 = (m) => new THREE.Matrix4().set(
  m[0][0], m[0][1], m[0][2], 0,
  m[1][0], m[1][1], m[1][2], 0,
  m[2][0], m[2][1], m[2][2], 0,
  0, 0, 0, 1,
);

// Finger layout: x position across the palm, splay about Y, segment lengths, radius.
const FINGERS = [
  { id: 'thumb', x: -0.5, z: 0.15, splay: 38 * D2R, seg: [0.34, 0.28, 0.2], r: 0.075, bend: [50, 70, 0], sensed: true },
  { id: 'index', x: -0.3, z: -0.5, splay: 0, seg: [0.45, 0.28, 0.2], r: 0.07, bend: [75, 95, 60], sensed: true },
  { id: 'middle', x: -0.1, z: -0.5, splay: 0, seg: [0.5, 0.3, 0.22], r: 0.07, bend: [75, 95, 60], sensed: false },
  { id: 'ring', x: 0.1, z: -0.5, splay: 0, seg: [0.46, 0.28, 0.2], r: 0.066, bend: [75, 95, 60], sensed: false },
  { id: 'pinky', x: 0.29, z: -0.5, splay: -4 * D2R, seg: [0.36, 0.22, 0.17], r: 0.06, bend: [75, 95, 60], sensed: false },
];

function segmentMesh(len, r, material) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 14);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -len / 2);
  return new THREE.Mesh(g, material);
}

function buildHand(scene) {
  const hand = new THREE.Group();
  const glove = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.85 });
  const dim = new THREE.MeshStandardMaterial({ color: 0xcfcbc0, roughness: 0.9 });
  const sensedMat = new THREE.MeshStandardMaterial({ color: 0xcfe8f7, roughness: 0.8 });
  const strip = new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.5 });

  const palm = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.22, 1.0, 4, 0.08), glove);
  hand.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.35, 28), dim);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, 0, 0.66);
  hand.add(cuff);

  // IMU board on the back of the hand
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4 }));
  board.position.set(0.0, 0.125, 0.1);
  hand.add(board);
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x111111 }));
  chip.position.set(0, 0.15, 0.1);
  hand.add(chip);

  const joints = {};
  for (const f of FINGERS) {
    const mat = f.sensed ? sensedMat : dim;
    const base = new THREE.Group();
    base.position.set(f.x, 0, f.z);
    base.rotation.y = f.splay;
    hand.add(base);

    let parent = base;
    const js = [];
    for (let i = 0; i < 3; i += 1) {
      const j = new THREE.Group();
      if (i > 0) j.position.set(0, 0, -f.seg[i - 1]);
      parent.add(j);
      j.add(segmentMesh(f.seg[i], f.r * (1 - 0.08 * i), mat));
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(f.r * 1.02, 16, 12), mat);
      j.add(knuckle);
      if (f.sensed && i < 2) {              // the flex sensor strip along the back of the finger
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, f.seg[i] * 0.92), strip);
        s.position.set(0, f.r * 0.98, -f.seg[i] / 2);
        j.add(s);
      }
      js.push(j);
      parent = j;
    }
    joints[f.id] = js;
  }

  // sensor axes on the board (set per mount by the caller)
  const axes = new THREE.Group();
  axes.position.copy(board.position);
  hand.add(axes);

  scene.add(hand);
  return { hand, joints, axes };
}

function loadCal() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveCal(cal) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(cal));
  } catch (e) { /* storage may be unavailable */ }
}

function HandViewer() {
  const mountRef = useRef(null);
  const [running, setRunning] = useState(true);
  const [mountKey, setMountKey] = useState('flat-thumb');
  const [kp, setKp] = useState(1.5);
  const [followIndex, setFollowIndex] = useState(false);
  const [swap, setSwap] = useState(false);          // false: flex_0 = thumb, flex_1 = index
  const [autoZero, setAutoZero] = useState(true);
  const [hud, setHud] = useState({
    connected: false, fps: 0, pitch: 0, roll: 0, yaw: 0, raw: [0, 0], norm: [0, 0], calibrated: false, zeros: 0, resting: 0,
  });

  // Everything the loops read lives in refs, so they mount once.
  const runningRef = useRef(true);
  const mountKeyRef = useRef('flat-thumb');
  const followRef = useRef(false);
  const swapRef = useRef(false);
  const filterRef = useRef(new Mahony(1.5));
  const yawOffRef = useRef(0);
  const sceneRef = useRef(null);
  const rawRef = useRef([0, 0]);
  const calRef = useRef(loadCal());                 // { straight:[a,b], bent:[a,b] } per sensor slot
  const rangeRef = useRef({ lo: [1e9, 1e9], hi: [-1e9, -1e9] });
  const seqRef = useRef(0);
  const countRef = useRef({ n: 0, t: performance.now(), fps: 0 });
  const connectedRef = useRef(false);
  const autoZeroRef = useRef(true);
  const restRef = useRef({ frames: 0, armed: true, zeros: 0 });   // rest detector for the auto heading zero
  const needZeroRef = useRef(true);                 // point the fingers away from the camera on the first frame

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { mountKeyRef.current = mountKey; }, [mountKey]);
  useEffect(() => { followRef.current = followIndex; }, [followIndex]);
  useEffect(() => { swapRef.current = swap; }, [swap]);
  useEffect(() => { autoZeroRef.current = autoZero; }, [autoZero]);
  useEffect(() => { filterRef.current.kp = kp; }, [kp]);

  // ---------------------------------------------------------------- scene + render loop
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    const width = el.clientWidth || 800;
    const height = 520;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x0b0b16);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
    camera.position.set(1.6, 1.9, 2.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -0.55);
    controls.enableDamping = true;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x202030, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    const grid = new THREE.GridHelper(6, 24, 0x6366f1, 0x2a2a44);
    grid.position.y = -1.1;
    scene.add(grid);

    const { hand, joints, axes } = buildHand(scene);
    sceneRef.current = { hand, joints, axes };

    let raf = 0;
    let lastHud = 0;
    const tmp = new THREE.Matrix4();
    const eul = new THREE.Euler();

    const tFor = (slot) => {
      const raw = rawRef.current[slot];
      const cal = calRef.current;
      if (cal) {
        const s = cal.straight[slot];
        const b = cal.bent[slot];
        if (Math.abs(b - s) > 20) return clamp((raw - s) / (b - s), 0, 1);
      }
      const r = rangeRef.current;
      r.lo[slot] = Math.min(r.lo[slot], raw);
      r.hi[slot] = Math.max(r.hi[slot], raw);
      const span = r.hi[slot] - r.lo[slot];
      return span > 120 ? clamp((raw - r.lo[slot]) / span, 0, 1) : 0;
    };

    const step = (ts) => {
      raf = requestAnimationFrame(step);
      controls.update();

      // ---- hand orientation: R = W * Rz(-yaw0) * R(q) * B^T
      const q = filterRef.current.q;
      const m = MOUNTS[mountKeyRef.current] || MOUNTS['flat-thumb'];
      const Bm = mat3to4(m.B);
      const Binv = Bm.clone().transpose();
      const qq = new THREE.Quaternion(q[1], q[2], q[3], q[0]);
      const Rq = new THREE.Matrix4().makeRotationFromQuaternion(qq);
      const Rz = new THREE.Matrix4().makeRotationZ(-yawOffRef.current);
      tmp.copy(W).multiply(Rz).multiply(Rq).multiply(Binv);
      hand.quaternion.setFromRotationMatrix(tmp);

      // sensor axes drawn on the board, in body coordinates (columns of B)
      while (axes.children.length) axes.remove(axes.children[0]);
      [[0xef4444, 0], [0x22c55e, 1], [0x3b82f6, 2]].forEach(([color, i]) => {
        const dir = new THREE.Vector3(m.B[0][i], m.B[1][i], m.B[2][i]);
        axes.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 0.45, color, 0.1, 0.06));
      });

      // ---- fingers
      const thumbSlot = swapRef.current ? 1 : 0;
      const indexSlot = swapRef.current ? 0 : 1;
      const tThumb = tFor(thumbSlot);
      const tIndex = tFor(indexSlot);
      for (const f of FINGERS) {
        let t = 0.22;                                   // relaxed curl for fingers with no sensor
        if (f.id === 'thumb') t = tThumb;
        else if (f.id === 'index') t = tIndex;
        else if (followRef.current) t = tIndex;
        const js = joints[f.id];
        for (let i = 0; i < 3; i += 1) js[i].rotation.x = -f.bend[i] * D2R * t;
      }

      // ---- HUD at ~8 Hz
      if (ts - lastHud > 120) {
        lastHud = ts;
        eul.setFromQuaternion(hand.quaternion, 'YXZ');
        const c = countRef.current;
        const now = performance.now();
        if (now - c.t > 1000) {
          c.fps = (c.n * 1000) / (now - c.t);
          c.n = 0;
          c.t = now;
        }
        setHud({
          connected: connectedRef.current,
          fps: c.fps,
          pitch: eul.x / D2R,
          roll: eul.z / D2R,
          yaw: eul.y / D2R,
          raw: [...rawRef.current],
          norm: [tFor(thumbSlot), tFor(indexSlot)],
          calibrated: !!calRef.current,
          zeros: restRef.current.zeros,
          resting: Math.min(1, restRef.current.frames / REST_FRAMES),
        });
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(step);

    const onResize = () => {
      const w = el.clientWidth || width;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => mt.dispose());
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, []);

  const zeroHeadingRef = useRef(() => {});

  // ---------------------------------------------------------------- data: every frame, in order
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (!runningRef.current) return;
      try {
        const res = await fetch(`/api/device/frames?since=${seqRef.current}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        connectedRef.current = !!data.connected;
        seqRef.current = data.total;
        const filter = filterRef.current;
        for (const f of data.frames) {
          filter.update(f.accel_x, f.accel_y, f.accel_z, f.gyro_x, f.gyro_y, f.gyro_z, FRAME_DT);
          rawRef.current = [f.flex_0, f.flex_1];
          countRef.current.n += 1;

          // Auto-zero heading: resting flat and still for 1 s is a known pose, so the heading
          // drift accumulated so far can be cancelled. Re-arms once the hand moves again.
          const rest = restRef.current;
          const mag = Math.hypot(f.accel_x, f.accel_y, f.accel_z);
          const gyro = Math.hypot(f.gyro_x, f.gyro_y, f.gyro_z);
          const B = (MOUNTS[mountKeyRef.current] || MOUNTS['flat-thumb']).B;
          const upY = mag > 0.5
            ? (B[1][0] * f.accel_x + B[1][1] * f.accel_y + B[1][2] * f.accel_z) / mag
            : 0;
          const still = gyro < REST_GYRO && mag > 0.85 && mag < 1.15;
          if (still && upY > LEVEL_COS) {
            rest.frames += 1;
            if (autoZeroRef.current && rest.armed && rest.frames >= REST_FRAMES) {
              zeroHeadingRef.current();
              rest.armed = false;
              rest.zeros += 1;
            }
          } else {
            rest.frames = 0;
            if (!still) rest.armed = true;
          }
        }
        if (needZeroRef.current && filter.ready) {
          needZeroRef.current = false;
          zeroHeadingRef.current();
        }
      } catch (e) {
        connectedRef.current = false;
      }
    };
    const id = setInterval(poll, 25);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ---------------------------------------------------------------- actions
  const zeroHeading = () => {
    const m = MOUNTS[mountKeyRef.current] || MOUNTS['flat-thumb'];
    // the sensor axis that points along the fingers (body -Z): s = B^T * (0, 0, -1)
    const fwd = [-m.B[2][0], -m.B[2][1], -m.B[2][2]];
    // Earth +Y maps to the view direction (away from the camera), so make the fingers' heading 90 deg.
    yawOffRef.current = headingOf(filterRef.current.q, fwd) - Math.PI / 2;
  };

  zeroHeadingRef.current = zeroHeading;

  const resetFilter = () => {
    filterRef.current = new Mahony(kp);
    needZeroRef.current = true;
  };

  const capture = (kind) => {
    const cur = rawRef.current.slice();
    const prev = calRef.current || { straight: [cur[0], cur[1]], bent: [cur[0], cur[1]] };
    const next = { straight: prev.straight.slice(), bent: prev.bent.slice() };
    next[kind] = cur;
    calRef.current = next;
    saveCal(next);
  };

  const clearCal = () => {
    calRef.current = null;
    rangeRef.current = { lo: [1e9, 1e9], hi: [-1e9, -1e9] };
    try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  };

  const f0 = (n) => (Number.isFinite(n) ? Math.round(n) : '—');

  return (
    <div className='arc-wrap'>
      <div className='card arc-card'>
        <div className='arc-head'>
          <div>
            <h2>3D hand</h2>
            <p>Live pose of the glove: the hand tilts with the IMU and the two sensed fingers curl with their flex sensors. Drag to orbit, scroll to zoom.</p>
            <p className='arc-sub'>
              Tilt (pitch, roll) is absolute. The MPU-6500 has no magnetometer, so heading is gyro-only and slowly drifts. Rest the hand flat and still for a second and the heading re-centres by itself (or press Zero heading).
              Middle, ring and little fingers have no sensor and are drawn relaxed.
            </p>
          </div>
          <div className='arc-hud'>
            <div className='arc-stat'><label>Link</label><b className={hud.connected ? 'ok' : 'warn'}>{hud.connected ? 'live' : 'no data'}</b></div>
            <div className='arc-stat'><label>Frames/s</label><b>{hud.fps.toFixed(0)}</b></div>
            <div className='arc-stat'><label>Pitch</label><b>{f0(hud.pitch)}°</b></div>
            <div className='arc-stat'><label>Roll</label><b>{f0(hud.roll)}°</b></div>
            <div className='arc-stat'><label>Heading</label><b>{f0(hud.yaw)}°</b></div>
          </div>
        </div>

        <div className='arc-stage' ref={mountRef} style={{ height: 520 }} />

        <div className='arc-controls'>
          <button className='btn' onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Resume'}</button>
          <button className='btn secondary' onClick={zeroHeading}>Zero heading</button>
          <button className='btn secondary' onClick={resetFilter}>Reset orientation</button>
          <span className='arc-hint'>Hold the hand still for a second after Reset.</span>
        </div>

        <div className='arc-settings'>
          <label className='arc-slider'>
            Board mounting
            <select value={mountKey} onChange={(e) => setMountKey(e.target.value)}>
              {Object.entries(MOUNTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>

          <label className='arc-slider'>
            Tilt correction gain <b>{kp.toFixed(1)}</b>
            <input type='range' min='0.2' max='6' step='0.1' value={kp}
              onChange={(e) => setKp(parseFloat(e.target.value))} />
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={swap} onChange={(e) => setSwap(e.target.checked)} />
            Swap fingers (flex_0 = index, flex_1 = thumb)
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={autoZero} onChange={(e) => setAutoZero(e.target.checked)} />
            Auto-zero heading when the hand rests flat for 1 s
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={followIndex} onChange={(e) => setFollowIndex(e.target.checked)} />
            Other fingers follow the index finger
          </label>

          <div className='arc-calib'>
            <button className='btn secondary' onClick={() => capture('straight')}>Capture both fingers STRAIGHT</button>
            <button className='btn secondary' onClick={() => capture('bent')}>Capture both fingers BENT</button>
            <button className='btn secondary' onClick={clearCal}>Clear (auto range)</button>
          </div>

          <div className='arc-sensor'>
            <div className='arc-stat'><label>flex_0 raw</label><b>{f0(hud.raw[0])}</b></div>
            <div className='arc-stat'><label>flex_1 raw</label><b>{f0(hud.raw[1])}</b></div>
            <div className='arc-stat'><label>thumb bend</label><b>{Math.round(hud.norm[0] * 100)}%</b></div>
            <div className='arc-stat'><label>index bend</label><b>{Math.round(hud.norm[1] * 100)}%</b></div>
            <div className='arc-stat'><label>range</label><b>{hud.calibrated ? 'captured' : 'auto'}</b></div>
            <div className='arc-stat'><label>rest timer</label><b>{Math.round(hud.resting * 100)}%</b></div>
            <div className='arc-stat'><label>auto-zeros</label><b>{hud.zeros}</b></div>
          </div>
          <div className='arc-sub' style={{ gridColumn: '1 / -1' }}>
            Arrows on the blue board are the sensor axes: <span style={{ color: '#ef4444' }}>X</span>, <span style={{ color: '#22c55e' }}>Y</span>, <span style={{ color: '#3b82f6' }}>Z</span>.
            If the hand tilts the wrong way, pick the mounting that matches how the board sits on your glove.
          </div>
        </div>
      </div>
    </div>
  );
}

export default HandViewer;
