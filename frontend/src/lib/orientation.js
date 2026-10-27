/**
 * Orientation of the glove's IMU from accelerometer + gyroscope (Mahony filter).
 *
 * Output is the quaternion q = [w, x, y, z] that rotates a vector from the SENSOR
 * frame into an Earth frame whose +Z is up (opposite gravity).
 *
 *   tilt (pitch, roll)  absolute and drift-free: gravity pulls the estimate back.
 *   heading (yaw)       gyro only. The MPU-6500 has no magnetometer, so heading
 *                       starts at 0 when the filter starts and drifts slowly;
 *                       `headingOf` + a yaw offset lets the UI zero it.
 *
 * Inputs: accel in g, gyro in deg/s (already offset-corrected by the firmware).
 */

const D2R = Math.PI / 180;

export const quatMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

export const quatNorm = (q) => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};

export const quatConj = (q) => [q[0], -q[1], -q[2], -q[3]];

/** Rotate vector v by quaternion q. */
export function quatRotate(q, v) {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Rotation about the Earth Z axis by `rad`. */
export const quatZ = (rad) => [Math.cos(rad / 2), 0, 0, Math.sin(rad / 2)];

/** Heading (rad) of sensor axis `axis` projected onto the Earth XY plane. */
export function headingOf(q, axis = [1, 0, 0]) {
  const f = quatRotate(q, axis);
  return Math.atan2(f[1], f[0]);
}

export class Mahony {
  constructor(kp = 1.5, ki = 0.0) {
    this.kp = kp;
    this.ki = ki;
    this.q = [1, 0, 0, 0];
    this.ready = false;
    this.eInt = [0, 0, 0];
  }

  /** Start from the tilt the accelerometer reports, instead of converging from level. */
  initFromAccel(ax, ay, az) {
    const n = Math.hypot(ax, ay, az);
    if (n < 1e-6) return;
    const a = [ax / n, ay / n, az / n];           // measured "up" in the sensor frame
    // shortest rotation taking sensor-frame up (a) onto Earth +Z
    const z = [0, 0, 1];
    const d = a[0] * z[0] + a[1] * z[1] + a[2] * z[2];
    let q;
    if (d < -0.999999) {
      q = [0, 1, 0, 0];
    } else {
      const c = [a[1] * z[2] - a[2] * z[1], a[2] * z[0] - a[0] * z[2], a[0] * z[1] - a[1] * z[0]];
      q = quatNorm([1 + d, c[0], c[1], c[2]]);
    }
    this.q = q;
    this.ready = true;
  }

  /** One sample. gx,gy,gz in deg/s, dt in seconds. */
  update(ax, ay, az, gx, gy, gz, dt) {
    if (!this.ready) {
      this.initFromAccel(ax, ay, az);
      return this.q;
    }
    let [q0, q1, q2, q3] = this.q;
    let wx = gx * D2R;
    let wy = gy * D2R;
    let wz = gz * D2R;

    const n = Math.hypot(ax, ay, az);
    // Only trust gravity when the board is not accelerating hard.
    if (n > 0.6 && n < 1.4) {
      const nx = ax / n;
      const ny = ay / n;
      const nz = az / n;
      // gravity ("up") direction predicted by the current estimate, in the sensor frame
      const vx = 2 * (q1 * q3 - q0 * q2);
      const vy = 2 * (q0 * q1 + q2 * q3);
      const vz = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;
      const ex = ny * vz - nz * vy;
      const ey = nz * vx - nx * vz;
      const ez = nx * vy - ny * vx;
      if (this.ki > 0) {
        this.eInt[0] += ex * this.ki * dt;
        this.eInt[1] += ey * this.ki * dt;
        this.eInt[2] += ez * this.ki * dt;
        wx += this.eInt[0];
        wy += this.eInt[1];
        wz += this.eInt[2];
      }
      wx += this.kp * ex;
      wy += this.kp * ey;
      wz += this.kp * ez;
    }

    const h = 0.5 * dt;
    const d0 = (-q1 * wx - q2 * wy - q3 * wz) * h;
    const d1 = (q0 * wx + q2 * wz - q3 * wy) * h;
    const d2 = (q0 * wy - q1 * wz + q3 * wx) * h;
    const d3 = (q0 * wz + q1 * wy - q2 * wx) * h;
    this.q = quatNorm([q0 + d0, q1 + d1, q2 + d2, q3 + d3]);
    return this.q;
  }
}
