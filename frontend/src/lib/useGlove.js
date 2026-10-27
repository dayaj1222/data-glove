import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Mahony, headingOf } from './orientation';

/**
 * The glove as a live input for 3D scenes: orientation of the hand (pitch, roll, heading)
 * from the IMU, and how far the thumb and index finger are bent (0..1).
 *
 * Every frame the backend received since the last poll is processed in order (frames arrive in
 * bursts), so the gyro integration sees all of them. The result is written into a ref that a
 * render loop can read without re-rendering React:
 *
 *   ref.current = { pitch, roll, yaw (deg), thumb, index (0..1), connected, rest (0..1) }
 *
 * Heading has no compass: it is gyro-only, zeroed on the first frame, and re-zeroed by
 * zero() or automatically after the hand rests flat and still for a second.
 */

export const FLEX_STORE_KEY = 'handviewer.flexcal.v1';     // shared with the 3D hand view
const FRAME_DT = 1 / 50;
const REST_FRAMES = 50;
const REST_GYRO = 4;
const LEVEL_COS = Math.cos((12 * Math.PI) / 180);
const R2D = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// rows give BODY coordinates (x right, y up out of the back of the hand, z to the wrist)
export const MOUNTS = {
  'flat-thumb': [[0, -1, 0], [0, 0, 1], [-1, 0, 0]],
  'flat-wrist': [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  edge: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
};

const W = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const m4 = (m) => new THREE.Matrix4().set(
  m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1,
);

function loadCal() {
  try {
    const raw = window.localStorage.getItem(FLEX_STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function useGlove({ mount = 'flat-thumb', kp = 1.5, autoZero = true, swap = false } = {}) {
  const out = useRef({ pitch: 0, roll: 0, yaw: 0, thumb: 0, index: 0, connected: false, rest: 0, zeros: 0, ready: false });
  const opts = useRef({ mount, kp, autoZero, swap });
  const api = useRef({});
  opts.current = { mount, kp, autoZero, swap };

  useEffect(() => {
    const filter = new Mahony(opts.current.kp);
    const st = { yawOff: 0, needZero: true, seq: 0, raw: [0, 0], cal: loadCal(),
      lo: [1e9, 1e9], hi: [-1e9, -1e9], rest: 0, armed: true };
    const tmp = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const eul = new THREE.Euler();
    let cancelled = false;

    const zero = () => {
      const B = MOUNTS[opts.current.mount] || MOUNTS['flat-thumb'];
      const fwd = [-B[2][0], -B[2][1], -B[2][2]];            // sensor axis along the fingers
      st.yawOff = headingOf(filter.q, fwd) - Math.PI / 2;
    };
    api.current.zero = zero;
    api.current.reset = () => {
      const q = filter;
      q.ready = false;
      q.q = [1, 0, 0, 0];
      st.needZero = true;
    };
    api.current.reloadCal = () => { st.cal = loadCal(); };

    const bend = (slot) => {
      const raw = st.raw[slot];
      if (st.cal && Math.abs(st.cal.bent[slot] - st.cal.straight[slot]) > 20) {
        return clamp((raw - st.cal.straight[slot]) / (st.cal.bent[slot] - st.cal.straight[slot]), 0, 1);
      }
      st.lo[slot] = Math.min(st.lo[slot], raw);
      st.hi[slot] = Math.max(st.hi[slot], raw);
      const span = st.hi[slot] - st.lo[slot];
      return span > 120 ? clamp((raw - st.lo[slot]) / span, 0, 1) : 0;
    };

    const poll = async () => {
      try {
        const res = await fetch(`/api/device/frames?since=${st.seq}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        out.current.connected = !!data.connected;
        st.seq = data.total;
        filter.kp = opts.current.kp;
        const B = MOUNTS[opts.current.mount] || MOUNTS['flat-thumb'];
        for (const f of data.frames) {
          filter.update(f.accel_x, f.accel_y, f.accel_z, f.gyro_x, f.gyro_y, f.gyro_z, FRAME_DT);
          st.raw = [f.flex_0, f.flex_1];
          if (st.needZero && filter.ready) { st.needZero = false; zero(); }
          const mag = Math.hypot(f.accel_x, f.accel_y, f.accel_z);
          const gyro = Math.hypot(f.gyro_x, f.gyro_y, f.gyro_z);
          const upY = mag > 0.5 ? (B[1][0] * f.accel_x + B[1][1] * f.accel_y + B[1][2] * f.accel_z) / mag : 0;
          const still = gyro < REST_GYRO && mag > 0.85 && mag < 1.15;
          if (still && upY > LEVEL_COS) {
            st.rest += 1;
            if (opts.current.autoZero && st.armed && st.rest >= REST_FRAMES) {
              zero();
              st.armed = false;
              out.current.zeros += 1;
            }
          } else {
            st.rest = 0;
            if (!still) st.armed = true;
          }
        }
        if (filter.ready) {
          const [w, x, y, z] = filter.q;
          tmp.copy(W)
            .multiply(new THREE.Matrix4().makeRotationZ(-st.yawOff))
            .multiply(new THREE.Matrix4().makeRotationFromQuaternion(quat.set(x, y, z, w)))
            .multiply(m4(B).transpose());
          quat.setFromRotationMatrix(tmp);
          eul.setFromQuaternion(quat, 'YXZ');
          const o = out.current;
          o.yaw = eul.y * R2D;
          o.pitch = eul.x * R2D;
          o.roll = eul.z * R2D;
          o.ready = true;
        }
        const swapped = opts.current.swap;
        out.current.thumb = bend(swapped ? 1 : 0);
        out.current.index = bend(swapped ? 0 : 1);
        out.current.rest = Math.min(1, st.rest / REST_FRAMES);
      } catch (e) {
        out.current.connected = false;
      }
    };
    const id = setInterval(poll, 25);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { state: out, zero: () => api.current.zero && api.current.zero(), reset: () => api.current.reset && api.current.reset(),
    reloadCal: () => api.current.reloadCal && api.current.reloadCal() };
}
