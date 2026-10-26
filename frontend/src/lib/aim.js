/**
 * Aim math for the glove.
 *
 * The accelerometer measures the gravity vector in the board's own frame, so
 * it gives the board's orientation absolutely -- no drift, ever -- but only
 * two of the three rotation degrees of freedom. Yaw (rotation about the world
 * vertical) leaves gravity untouched and is therefore invisible; with no
 * magnetometer on the MPU-6500 that is a hard limit. So "aim" here means a
 * two-axis tilt direction, which is exactly what a target range needs.
 *
 * Board mounting, board flat on the hand with the silkscreen readable:
 *
 *   +X  points forward, at the screen
 *   +Y  points to the user's left
 *   +Z  points up, out of the board
 *
 * Consequences for aiming, which is why the axes are not interchangeable:
 *
 *   tip the hand sideways (roll about X) -> the raised edge is the left one,
 *     so world-up gains a +Y component: gy > 0  =>  aim right
 *   raise the fingers (pitch about Y)    -> the front edge is up, so world-up
 *     gains a +X component: gx > 0          =>  aim up
 *
 * Those two normalised components ARE the tilt vector. Deliberately there is
 * no pair of atan2 angles here: two independent angles cross-couple at large
 * tilts (roll stops being horizontal once you have pitched far), whereas the
 * normalised gravity components stay exact at any tilt up to 90 degrees and
 * degrade gracefully beyond.
 */

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Gravity (really: the accelerometer's proper-acceleration reading, which
 * points opposite gravity when at rest) as a unit vector in board frame.
 * Returns null when the sample carries no usable magnitude.
 */
export function gravityUnit(frame) {
  const ax = Number(frame.accel_x) || 0;
  const ay = Number(frame.accel_y) || 0;
  const az = Number(frame.accel_z) || 0;
  const n = Math.hypot(ax, ay, az);
  if (n < 1e-6) return null;
  return [ax / n, ay / n, az / n];
}

/** Rotate vector v by quaternion q = [x, y, z, w]. */
export function quatRotate(q, v) {
  // A missing quaternion means "no correction yet": rotate by identity
  // rather than throwing. Callers can then render before calibration.
  if (!q) return v;
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/**
 * Quaternion rotating unit vector a onto unit vector b (shortest arc).
 *
 * Used for neutral calibration: instead of subtracting two angles, which is
 * only valid for small offsets, this builds the exact rotation that would
 * bring the resting pose level. Aim maths then runs in that corrected frame,
 * so a hand that rests tilted still maps cleanly to the centre of the screen.
 */
export function quatFromTo(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.999999) return [0, 0, 0, 1];

  if (d < -0.999999) {
    // 180 degrees: any axis perpendicular to a works.
    let axis = [a[1] * 1 - a[2] * 0, a[2] * 0 - a[0] * 1, a[0] * 0 - a[1] * 0];
    if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-6) {
      axis = [a[2] * 1 - a[1] * 0, a[0] * 0 - a[2] * 1, 0];
    }
    const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    return [axis[0] / n, axis[1] / n, axis[2] / n, 0];
  }

  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const w = 1 + d;
  const n = Math.hypot(cx, cy, cz, w) || 1;
  return [cx / n, cy / n, cz / n, w / n];
}

/**
 * Turn a board-frame gravity vector into an aim direction.
 *
 * @param {number[]} up      unit gravity vector in board frame
 * @param {number[]|null} neutral quaternion from quatFromTo(restingUp, +Z)
 * @returns {{right:number, up:number, tilt:number}}
 *   right: tilt toward the user's right, in g (0..1)
 *   up:    tilt of the fingers upward, in g (0..1)
 *   tilt:  total tilt from level, in radians
 */
export function aimFromGravity(up, neutral) {
  const u = quatRotate(neutral, up);
  return {
    right: u[1],
    up: u[0],
    tilt: Math.asin(clamp(Math.hypot(u[0], u[1]), 0, 1)),
  };
}

/** Degrees of true tilt for a g-space component. */
export const gToDeg = (g) => (Math.asin(clamp(g, -1, 1)) * 180) / Math.PI;

/** g-space component corresponding to a given number of degrees. */
export const degToG = (deg) => Math.sin((clamp(deg, 0, 90) * Math.PI) / 180);
