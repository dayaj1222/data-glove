/**
 * Finger-pointer: where the board's +X axis points, as pitch and yaw.
 *
 * Mounting: +X along the pointing finger (at the screen), +Y up, +Z to the
 * user's right. Every formula below follows from that one choice.
 *
 *   pitch  elevation of the X axis. Gravity is visible to the accelerometer, so
 *          this is absolute and drift-free; the gyro only smooths it.
 *   yaw    azimuth of the X axis. Turning about the vertical leaves gravity
 *          untouched, so no accelerometer (and no magnetometer here) can see
 *          it. It exists only as an integrated gyro rate, hence it drifts a
 *          little and needs the recenter button.
 *
 * Rates use the tilted-board geometry, not a bare gyro axis. With u the unit
 * "up" vector in board frame (accelerometer direction at rest) and p = +X:
 *
 *   d(u)/dt = -w x u                              (u rotates opposite to the board)
 *   pitch rate = (w_z*u_y - w_y*u_z) / cos(pitch)
 *   yaw rate   = (w.u - (w.p)(u.p)) / (1 - (u.p)^2) = (w_y*u_y + w_z*u_z) / (1 - u_x^2)
 *
 * so rolling the wrist about the finger (w along X) moves neither, and the
 * pointer stays correct when the hand is pitched.
 *
 * Positive yaw rate from the maths is a turn to the LEFT (right-handed about
 * +Y), so aim-right is its negative; callers can still flip signs.
 */

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEG = 180 / Math.PI;

export class Pointer {
  constructor() {
    this.pitch = 0;          // degrees, + = finger up (absolute, relative to neutral once set)
    this.yaw = 0;            // degrees, + = aiming right, integrated from the gyro
    this.bias = [0, 0, 0];   // learned gyro bias, deg/s
    this.pitchNeutral = 0;
    this.ready = false;
  }

  /** Re-seed from gravity on the next frame; keeps the learned gyro bias. */
  reseed() {
    this.ready = false;
    this.yaw = 0;
  }

  /** Make the pose in frame `f` the aim centre (absolute pitch from gravity). */
  calibrate(f) {
    const ax = Number(f.accel_x) || 0;
    const ay = Number(f.accel_y) || 0;
    const az = Number(f.accel_z) || 0;
    const mag = Math.hypot(ax, ay, az);
    if (mag < 1e-6) return;
    this.pitchNeutral = Math.asin(clamp(ax / mag, -1, 1)) * DEG;
    this.pitch = 0;
    this.yaw = 0;
    this.ready = true;
  }

  /** Zero only the yaw, e.g. to cancel accumulated drift. */
  recenterYaw() {
    this.yaw = 0;
  }

  /**
   * @param {object} f        frame with accel_xyz (g) and gyro_xyz (deg/s)
   * @param {number} dt       seconds since the last update
   * @param {object} o
   * @param {number} o.yawGate   yaw rates below this (deg/s) count as noise
   * @param {number} o.yawLimit  yaw is clamped to +-this many degrees
   * @returns {{pitch:number, yaw:number, speed:number}|null}
   */
  update(f, dt, { yawGate = 1.5, yawLimit = 60 } = {}) {
    const ax = Number(f.accel_x) || 0;
    const ay = Number(f.accel_y) || 0;
    const az = Number(f.accel_z) || 0;
    const mag = Math.hypot(ax, ay, az);
    if (mag < 1e-6) return null;
    const u = [ax / mag, ay / mag, az / mag];

    const step = clamp(dt, 0, 0.05);
    const accelPitch = Math.asin(clamp(u[0], -1, 1)) * DEG - this.pitchNeutral;

    if (!this.ready) {
      this.pitch = accelPitch;
      this.yaw = 0;
      this.ready = true;
      return { pitch: this.pitch, yaw: this.yaw, speed: 0 };
    }

    // --- gyro bias: while the whole vector is quiet, whatever it reads is bias.
    const raw = [Number(f.gyro_x) || 0, Number(f.gyro_y) || 0, Number(f.gyro_z) || 0];
    const rel = [raw[0] - this.bias[0], raw[1] - this.bias[1], raw[2] - this.bias[2]];
    const speed = Math.hypot(rel[0], rel[1], rel[2]);
    if (speed < 4) {
      const k = Math.min(1, step * 1.5);
      for (let i = 0; i < 3; i++) this.bias[i] += (raw[i] - this.bias[i]) * k;
    }
    const w = [raw[0] - this.bias[0], raw[1] - this.bias[1], raw[2] - this.bias[2]];

    // --- pitch: propagate with the gyro, pull toward gravity.
    const cosP = Math.max(0.1, Math.sqrt(Math.max(0, 1 - u[0] * u[0])));
    const pitchRate = (w[2] * u[1] - w[1] * u[2]) / cosP;       // deg/s
    // Accelerations while the hand moves corrupt the gravity reading, so
    // lean on the gyro whenever |a| strays from 1 g.
    const quiet = Math.abs(mag - 1) < 0.12;
    const tau = quiet ? 0.5 : 5;
    const alpha = Math.exp(-step / tau);
    this.pitch = alpha * (this.pitch + pitchRate * step) + (1 - alpha) * accelPitch;

    // --- yaw: gyro only.
    const yawLeft = (w[1] * u[1] + w[2] * u[2]) / Math.max(0.05, 1 - u[0] * u[0]);
    const yawRight = -yawLeft;
    const gated = Math.abs(yawRight) <= yawGate ? 0 : yawRight - Math.sign(yawRight) * yawGate;
    this.yaw = clamp(this.yaw + gated * step, -yawLimit, yawLimit);

    return { pitch: this.pitch, yaw: this.yaw, speed };
  }
}
