import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useGlove } from '../lib/useGlove';
import { BlockWorld } from '../lib/blockWorld';

const TABLE_W = 12;                       // x from -6 to 6
const TABLE_D = 8;                        // z from -4 to 4
const X_MAX = 5.4;
const Z_MAX = 3.4;
const Y_MIN = 0.9;
const Y_MAX = 7.6;
const PAD_X = -5.2;                       // where new blocks appear
const BUILD_X0 = -4.0;                    // the tower is measured to the right of this line
const COLORS = [0xf87171, 0xfbbf24, 0x4ade80, 0x60a5fa, 0xc084fc, 0xf472b6, 0x2dd4bf];
const SIZES = [[1, 1], [1, 1], [2, 1], [1, 2], [2, 2]];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 683;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f45';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(165,180,252,0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= TABLE_W; i += 1) {
    g.beginPath(); g.moveTo((i / TABLE_W) * c.width, 0); g.lineTo((i / TABLE_W) * c.width, c.height); g.stroke();
  }
  for (let j = 0; j <= TABLE_D; j += 1) {
    g.beginPath(); g.moveTo(0, (j / TABLE_D) * c.height); g.lineTo(c.width, (j / TABLE_D) * c.height); g.stroke();
  }
  // supply pad
  g.fillStyle = 'rgba(251,191,36,0.16)';
  g.fillRect(0, 0, (1.7 / TABLE_W) * c.width, c.height);
  g.fillStyle = 'rgba(74,222,128,0.07)';
  g.fillRect(((BUILD_X0 + TABLE_W / 2) / TABLE_W) * c.width, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function BlockStacker() {
  const mountRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [mapping, setMapping] = useState('pitch-depth');
  const [rangeDeg, setRangeDeg] = useState(45);
  const [speed, setSpeed] = useState(6);
  const [invertX, setInvertX] = useState(false);
  const [invertLift, setInvertLift] = useState(false);
  const [autoZero, setAutoZero] = useState(true);
  const [swap, setSwap] = useState(false);
  const [mount, setMount] = useState('flat-thumb');
  const [hud, setHud] = useState({
    level: 1, target: 4, height: 0, left: 0, held: false, msg: 'Press Start', live: false,
    pitch: 0, roll: 0, yaw: 0, thumb: 0, index: 0, best: 0, rest: 0,
  });

  const glove = useGlove({ mount, autoZero, swap });
  const gloveRef = glove.state;

  const runningRef = useRef(false);
  const mappingRef = useRef('pitch-depth');
  const rangeRef = useRef(45);
  const speedRef = useRef(6);
  const invertXRef = useRef(false);
  const invertRef = useRef(false);
  const restartRef = useRef(() => {});
  const keysRef = useRef({});

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { mappingRef.current = mapping; }, [mapping]);
  useEffect(() => { rangeRef.current = rangeDeg; }, [rangeDeg]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { invertXRef.current = invertX; }, [invertX]);
  useEffect(() => { invertRef.current = invertLift; }, [invertLift]);

  useEffect(() => {
    const down = (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd', 'q', 'e'].includes(k)) {
        if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
        e.preventDefault();
        keysRef.current[k] = true;
      }
    };
    const up = (e) => { keysRef.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    const width = el.clientWidth || 900;
    const height = 560;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x0b0b16);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0b16, 18, 40);
    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);
    camera.position.set(0, 8.2, 11.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2.2, 0);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 6;
    controls.maxDistance = 24;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x222233, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.05);
    sun.position.set(4, 11, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
    sun.shadow.camera.far = 30;
    scene.add(sun);

    const table = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, 0.4, TABLE_D),
      new THREE.MeshStandardMaterial({ map: makeGridTexture(), roughness: 0.9 }));
    table.position.y = -0.2;
    table.receiveShadow = true;
    scene.add(table);

    // goal frame at the target height
    const goal = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(TABLE_W / 2 + 1.4, 0.02, TABLE_D - 0.6)),
      new THREE.LineBasicMaterial({ color: 0x4ade80 }));
    goal.position.set(2.2, 4, 0);
    scene.add(goal);

    // claw: two fingers that close on a pinch
    const claw = new THREE.Group();
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xe5e7f5, roughness: 0.5 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0x6366f1 }));
    rod.position.y = 6.3;
    claw.add(rod);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), clawMat);
    claw.add(hub);
    const fingers = [-1, 1].map((sgn) => {
      const pivot = new THREE.Group();
      pivot.position.set(sgn * 0.2, 0, 0);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.65, 4, 10), clawMat);
      seg.position.y = -0.4;
      seg.castShadow = true;
      pivot.add(seg);
      claw.add(pivot);
      return { pivot, sgn };
    });
    scene.add(claw);

    const shadowDot = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    shadowDot.rotation.x = -Math.PI / 2;
    scene.add(shadowDot);
    const dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
      new THREE.LineDashedMaterial({ color: 0xa5b4fc, dashSize: 0.18, gapSize: 0.12 }));
    scene.add(dropLine);

    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.28, depthWrite: false }));
    ghost.visible = false;
    scene.add(ghost);

    // ------------------------------------------------------------ game state
    const G = {
      world: new BlockWorld(), queue: [], level: 1, target: 4, held: null, grabbed: false,
      cx: 0, cy: 4, cz: 0, tx: 0, ty: 4, tz: 0, won: 0, over: false,
      best: 0, lastHud: 0, msg: '', height: 0, lost: 0,
    };

    const disposeBlock = (b) => {
      scene.remove(b.mesh);
      b.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    };

    const addBlock = (w, d, color) => {
      const geo = new THREE.BoxGeometry(w, 1, d);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1c1b19 })));
      scene.add(mesh);
      const b = G.world.addBlock(PAD_X, 0.55, 0, w, d, 1);
      b.mesh = mesh;
      b.mat = mat;
      return b;
    };

    const levelSetup = (lvl) => {
      G.world.blocks.slice().forEach((b) => { disposeBlock(b); G.world.removeBlock(b); });
      G.level = lvl;
      G.target = 3 + lvl;
      G.held = null;
      G.grabbed = false;
      G.won = 0;
      G.over = false;
      G.lost = 0;
      const n = Math.round(G.target * 1.6) + 2;
      G.queue = Array.from({ length: n }, (_, i) => {
        const [w, d] = SIZES[Math.floor(Math.random() * SIZES.length)];
        return { w, d, color: COLORS[i % COLORS.length] };
      });
      goal.position.y = G.target;
      G.msg = `Level ${lvl}: build a tower ${G.target} blocks high`;
    };

    const onPad = (b) => !b.held && b.body.position.x < PAD_X + 1.4 && b.body.position.y < 1.8;

    const spawnIfPadFree = () => {
      if (G.queue.length === 0) return;
      if (G.world.blocks.some(onPad)) return;
      const nxt = G.queue.shift();
      addBlock(nxt.w, nxt.d, nxt.color);
    };

    restartRef.current = (lvl = 1) => {
      levelSetup(lvl);
      G.best = lvl === 1 ? 0 : G.best;
      spawnIfPadFree();
    };
    levelSetup(1);
    spawnIfPadFree();

    // ------------------------------------------------------------ input -> claw target
    const readInput = (dt) => {
      const gs = gloveRef.current;
      const live = gs.connected && gs.ready;
      const r = rangeRef.current;
      const keys = keysRef.current;
      let grab = false;
      if (live) {
        const dz = (v) => (Math.abs(v) < 2 ? 0 : v - Math.sign(v) * 2);      // ignore 2 deg of tremor
        // heading is positive when the fingers turn LEFT (counter-clockwise from above)
        const yawN = clamp(-dz(gs.yaw) / r, -1, 1) * (invertXRef.current ? -1 : 1);
        let depthN;
        let liftN;
        if (mappingRef.current === 'pitch-depth') {
          depthN = clamp(dz(gs.pitch) / r, -1, 1);               // fingers up = farther
          liftN = clamp(-dz(gs.roll) / (r * 1.6), 0, 1);         // thumb up (palm to the left) = higher
        } else {
          liftN = clamp((dz(gs.pitch) + r) / (2 * r), 0, 1);
          depthN = clamp(-dz(gs.roll) / r, -1, 1);
        }
        if (invertRef.current) liftN = 1 - liftN;
        G.tx = yawN * X_MAX;
        G.tz = -depthN * Z_MAX;
        G.ty = Y_MIN + liftN * (Y_MAX - Y_MIN);
        const pinch = Math.min(gs.thumb, gs.index);
        grab = G.grabbed ? pinch > 0.42 : pinch > 0.58;
      } else {
        const sp = 6 * dt;
        if (keys.arrowleft || keys.a) G.tx -= sp;
        if (keys.arrowright || keys.d) G.tx += sp;
        if (keys.arrowup || keys.w) G.tz -= sp;
        if (keys.arrowdown || keys.s) G.tz += sp;
        if (keys.q) G.ty += sp;
        if (keys.e) G.ty -= sp;
        G.tx = clamp(G.tx, -X_MAX, X_MAX);
        G.tz = clamp(G.tz, -Z_MAX, Z_MAX);
        G.ty = clamp(G.ty, Y_MIN, Y_MAX);
        grab = !!keys[' '];
      }
      return { grab, live };
    };

    // ------------------------------------------------------------ main loop
    let raf = 0;
    let prevTs = 0;
    const step = (ts) => {
      raf = requestAnimationFrame(step);
      controls.update();
      const dt = Math.min(0.05, (ts - (prevTs || ts)) / 1000);
      prevTs = ts;

      const { grab, live } = readInput(dt);

      if (runningRef.current && !G.over) {
        // claw eases toward its target
        const k = 1 - Math.exp(-speedRef.current * dt);
        G.cx += (G.tx - G.cx) * k;
        G.cy += (G.ty - G.cy) * k;
        G.cz += (G.tz - G.cz) * k;

        // grab / release edges
        const world = G.world;
        const tip = (bk) => {
          const p = bk.body.position;
          return Math.hypot(p.x - G.cx, p.z - G.cz, ((p.y + bk.h / 2) - (G.cy - 0.55)) * 0.6);
        };
        if (grab && !G.grabbed) {
          let best = null;
          let bestD = 1.6;
          for (const bk of world.blocks) {
            if (bk.held || !world.exposed(bk)) continue;
            const dist = tip(bk);
            if (dist < bestD) { best = bk; bestD = dist; }
          }
          G.grabbed = true;
          if (best) { G.held = best; }
        } else if (!grab && G.grabbed) {
          G.grabbed = false;
          if (G.held) { world.release(G.held); G.held = null; }
        }

        // physics: the held block is carried as a solid body (it stops against things), the rest is simulated
        if (G.held) {
          const bk = G.held;
          world.hold(bk, G.cx, Math.max(bk.h / 2, G.cy - 0.55 - bk.h / 2), G.cz, dt);
        }
        world.step(dt);

        // blocks that fell off the table are gone
        for (const bk of world.blocks.slice()) {
          if (bk.body.position.y < -4) {
            if (bk === G.held) G.held = null;
            disposeBlock(bk);
            world.removeBlock(bk);
            G.lost += 1;
          }
        }

        spawnIfPadFree();

        // goal: tower tall enough and everything settled for a moment
        G.height = world.towerHeight(BUILD_X0);
        G.best = Math.max(G.best, Math.floor(G.height + 0.01));
        const moving = world.blocks.some((bk) => !bk.held && !world.still(bk));
        if (G.height >= G.target - 0.01 && !moving && !G.held) G.won += dt; else G.won = 0;
        if (G.won > 1.2) {
          G.msg = `Level ${G.level} complete!`;
          levelSetup(G.level + 1);
          spawnIfPadFree();
        }
        const remaining = G.queue.length + world.blocks.filter(onPad).length;
        if (remaining === 0 && !G.held && !moving && G.height < G.target - 0.01) {
          G.over = true;
          G.msg = 'Out of blocks. Press Restart.';
        }
      }

      // ---------------------------------------------------------- draw
      claw.position.set(G.cx, G.cy, G.cz);
      const close = G.grabbed ? 1 : clamp(Math.min(gloveRef.current.thumb, gloveRef.current.index), 0, 1) * (live ? 0.8 : 0);
      fingers.forEach(({ pivot, sgn }) => {
        pivot.position.x = sgn * (0.62 - 0.4 * close);
        pivot.rotation.z = -sgn * 0.12 * (1 - close);
      });
      shadowDot.position.set(G.cx, 0.02, G.cz);
      dropLine.geometry.setFromPoints([new THREE.Vector3(G.cx, 0.03, G.cz), new THREE.Vector3(G.cx, G.cy - 0.3, G.cz)]);
      dropLine.computeLineDistances();

      // where the held block would land
      if (G.held) {
        const bk = G.held;
        const p = bk.body.position;
        const top = G.world.topUnder(bk, p.x, p.z, p.y - bk.h / 2 + 0.08);
        ghost.visible = true;
        ghost.scale.set(bk.w, bk.h, bk.d);
        ghost.position.set(p.x, top + bk.h / 2, p.z);
      } else {
        ghost.visible = false;
      }
      // highlight what the claw would pick up
      let near = null;
      let nearD = 1.6;
      if (!G.held) {
        for (const bk of G.world.blocks) {
          if (bk.held || !G.world.exposed(bk)) continue;
          const p = bk.body.position;
          const dist = Math.hypot(p.x - G.cx, p.z - G.cz, ((p.y + bk.h / 2) - (G.cy - 0.55)) * 0.6);
          if (dist < nearD) { near = bk; nearD = dist; }
        }
      }
      for (const bk of G.world.blocks) {
        bk.mesh.position.set(bk.body.position.x, bk.body.position.y, bk.body.position.z);
        bk.mesh.quaternion.set(bk.body.quaternion.x, bk.body.quaternion.y, bk.body.quaternion.z, bk.body.quaternion.w);
        bk.mat.emissive.setHex(bk === near ? 0x333333 : 0x000000);
      }

      if (ts - G.lastHud > 120) {
        G.lastHud = ts;
        const gs = gloveRef.current;
        setHud({
          level: G.level, target: G.target, height: Math.round(G.height * 10) / 10,
          left: G.queue.length + (G.world.blocks.some(onPad) ? 1 : 0), held: !!G.held, msg: G.msg || (runningRef.current ? '' : 'Press Start'),
          live, pitch: gs.pitch, roll: gs.roll, yaw: gs.yaw, thumb: gs.thumb, index: gs.index,
          best: G.best, rest: gs.rest,
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
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => { restartRef.current(1); setRunning(true); };
  const f0 = (n) => (Number.isFinite(n) ? Math.round(n) : '—');

  return (
    <div className='arc-wrap'>
      <div className='card arc-card'>
        <div className='arc-head'>
          <div>
            <h2>Block stacker 3D</h2>
            <p>Stack blocks into a tower taller than the green frame. Turn your hand to move the claw sideways, pitch for depth, twist the wrist (thumb up) to lift, and pinch thumb and index together to pick up and put down.</p>
            <p className='arc-sub'>
              Without the glove: arrow keys or WASD move, Q / E raise and lower, hold Space to grab. Drag the view with the mouse. A block needs at least half of its base on what is below it or it tips off.
            </p>
          </div>
          <div className='arc-hud'>
            <div className='arc-stat'><label>Level</label><b>{hud.level}</b></div>
            <div className='arc-stat'><label>Height</label><b className={hud.height >= hud.target ? 'ok' : ''}>{hud.height.toFixed(1)} / {hud.target}</b></div>
            <div className='arc-stat'><label>Blocks left</label><b>{hud.left}</b></div>
            <div className='arc-stat'><label>Best</label><b>{hud.best}</b></div>
            <div className='arc-stat'><label>Input</label><b className={hud.live ? 'ok' : ''}>{hud.live ? 'glove' : 'keyboard'}</b></div>
          </div>
        </div>

        <div className='arc-stage' ref={mountRef} style={{ height: 560, position: 'relative' }}>
          {(!running || hud.msg) && (
            <div style={{ position: 'absolute', left: 12, top: 10, zIndex: 2, color: '#e5e7f5', fontSize: 14, textShadow: '0 1px 3px #000', pointerEvents: 'none' }}>
              {hud.msg || 'Press Start'}
            </div>
          )}
        </div>

        <div className='arc-controls'>
          <button className='btn' onClick={start}>{running ? 'Restart' : 'Start'}</button>
          <button className='btn secondary' onClick={glove.zero}>Zero heading</button>
          <button className='btn secondary' onClick={glove.reset}>Reset orientation</button>
          <span className='arc-hint'>{hud.held ? 'holding a block: green ghost shows where it will land' : 'move the claw next to a block, then pinch'}</span>
        </div>

        <div className='arc-settings'>
          <label className='arc-slider'>
            Hand mapping
            <select value={mapping} onChange={(e) => setMapping(e.target.value)}>
              <option value='pitch-depth'>pitch = depth, wrist twist = height</option>
              <option value='pitch-lift'>pitch = height, wrist twist = depth</option>
            </select>
          </label>

          <label className='arc-slider'>
            Claw speed <b>{speed}</b> (lower = smoother and slower)
            <input type='range' min='1' max='20' step='1' value={speed}
              onChange={(e) => setSpeed(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Reach (full range at ±{rangeDeg}°)
            <input type='range' min='20' max='90' step='1' value={rangeDeg}
              onChange={(e) => setRangeDeg(parseInt(e.target.value, 10))} />
          </label>

          <label className='arc-slider'>
            Board mounting
            <select value={mount} onChange={(e) => setMount(e.target.value)}>
              <option value='flat-thumb'>flat on the back of the hand, Y to the thumb</option>
              <option value='flat-wrist'>flat, X toward the wrist</option>
              <option value='edge'>on edge, Y up</option>
            </select>
          </label>

          <label className='arc-toggle'>
            <input type='checkbox' checked={invertX} onChange={(e) => setInvertX(e.target.checked)} />
            Invert left / right
          </label>
          <label className='arc-toggle'>
            <input type='checkbox' checked={invertLift} onChange={(e) => setInvertLift(e.target.checked)} />
            Invert lift direction
          </label>
          <label className='arc-toggle'>
            <input type='checkbox' checked={autoZero} onChange={(e) => setAutoZero(e.target.checked)} />
            Auto-zero heading when the hand rests flat for 1 s
          </label>
          <label className='arc-toggle'>
            <input type='checkbox' checked={swap} onChange={(e) => setSwap(e.target.checked)} />
            Swap fingers (flex_0 = index, flex_1 = thumb)
          </label>

          <div className='arc-sensor'>
            <div className='arc-stat'><label>pitch</label><b>{f0(hud.pitch)}°</b></div>
            <div className='arc-stat'><label>roll</label><b>{f0(hud.roll)}°</b></div>
            <div className='arc-stat'><label>heading</label><b>{f0(hud.yaw)}°</b></div>
            <div className='arc-stat'><label>thumb</label><b>{Math.round(hud.thumb * 100)}%</b></div>
            <div className='arc-stat'><label>index</label><b>{Math.round(hud.index * 100)}%</b></div>
            <div className='arc-stat'><label>rest timer</label><b>{Math.round(hud.rest * 100)}%</b></div>
          </div>
          <div className='arc-sub' style={{ gridColumn: '1 / -1' }}>
            Finger range comes from the capture on the Hand 3D tab (or an automatic range if none was captured): capture both fingers straight and bent there first for reliable pinching.
          </div>
        </div>
      </div>
    </div>
  );
}

export default BlockStacker;
