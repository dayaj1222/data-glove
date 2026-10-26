/**
 * Complementary tilt tracker: gyro + accelerometer fused, with a noise gate.
 *
 * Why not just the accelerometer? Because it is noisy: gravity is a DC signal
 * buried in vibration and quantisation, so a plain asin() of it jitters by a
 * degree or two every sample. That is what made aiming feel finicky.
 *
 * Why not just the gyroscope? Because a rate sensor integrated over time
 * drifts without bound -- a 0.5 dps bias is 30 degrees per minute, which is
 * why raw gyro aiming feels fine for two seconds and then wanders off.
 *
 * The complementary filter takes each sensor where it is strong:
 *
 *   angle = alpha * (angle + gyroRate * dt) + (1 - alpha) * accelAngle
 *
 * The gyro term carries fast wrist motion; the accel term pulls the estimate
 * back to physical truth over roughly 1/(1-alpha) frames, so drift cannot
 * accumulate. Neither sensor alone can do this.
 *
 * Two refinements that matter for a hand-held sensor:
 *
 * 1. Noise gate. Below a threshold the gyro reading is bias, not motion.
 *    Integrating it would slowly walk the reticle across the screen while the
 *    hand is still, so gated readings contribute exactly zero rate.
 *
 * 2. Adaptive alpha. While genuinely moving, trust the gyro almost entirely
 *    (alpha -> 0.995) so it tracks the wrist without accel lag. While still,
 *    drop alpha so the accelerometer can scrub out accumulated bias. This is
 *    the "mean that changes with some factor" behaviour: the blend weight is
 *    a function of measured angular speed, not a constant.
 */

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class TiltTracker {
  constructor() {
    this.right = 0;      // degrees, positive = tipped toward user's right
    this.up = 0;         // degrees, positive = nose up
    this.biasRight = 0;  // learned gyro bias, deg/s
    this.biasUp = 0;
    this.ready = false;
  }

  reset(rightDeg, upDeg) {
    this.right = rightDeg || 0;
    this.up = upDeg || 0;
    this.ready = true;
  }

  /** Forget the learned bias, e.g. after a re-calibration. */
  clearBias() {
    this.biasRight = 0;
    this.biasUp = 0;
  }

  /**
   * @param {object} p
   * @param {number} p.accelRight  accelerometer-derived tilt, degrees
   * @param {number} p.accelUp     accelerometer-derived tilt, degrees
   * @param {number} p.gyroRight   angular rate about the roll axis, deg/s
   * @param {number} p.gyroUp      angular rate about the pitch axis, deg/s
   * @param {number} p.dt          seconds since last update
   * @param {number} p.gate        rates below this (deg/s) count as noise
   * @param {number} p.stillAlpha  blend weight when still (drift removal)
   * @param {number} p.moveAlpha   blend weight when moving (tracking)
   * @param {number} p.moveRate    deg/s at which moveAlpha is reached
   */
  update({ accelRight, accelUp, gyroRight, gyroUp, dt, gate, learnThreshold, stillAlpha, moveAlpha, moveRate }) {
    const step = Math.min(dt, 0.05); // a long frame must not integrate far

    if (!this.ready) {
      this.reset(accelRight, accelUp);
      return this;
    }

    // --- online bias estimation.
    //
    // The firmware already subtracts the offsets measured at boot, but that
    // measurement only happens if the board was still for 2 s at power-up and
    // the bias still moves with temperature. So learn it again here: while the
    // board is not moving, whatever the gyro keeps reporting IS bias. Averaging
    // it (~0.5 s) and subtracting gives a true zero-on-still that does not
    // depend on how the board was sitting when it booted.
    // Learning uses its own, larger threshold. Tying it to the gate made it
    // deadlock on real hardware: the residual bias on a channel (~6.5 deg/s
    // measured here) exceeded the gate, so the gate never blocked it AND the
    // bias was never learned -- a permanent drift on that axis.
    const rawSpeed = Math.max(Math.abs(gyroRight), Math.abs(gyroUp));
    const learnAt = Number.isFinite(learnThreshold) ? learnThreshold : gate;
    if (rawSpeed < learnAt) {
      const k = Math.min(1, step * 2);
      this.biasRight += (gyroRight - this.biasRight) * k;
      this.biasUp += (gyroUp - this.biasUp) * k;
    }

    const correctedRight = gyroRight - this.biasRight;
    const correctedUp = gyroUp - this.biasUp;

    // --- noise gate: dead-band the rate rather than clamping it, so a value
    // just above the gate starts from zero instead of jumping.
    const gRight = Math.abs(correctedRight) <= gate ? 0 : correctedRight - Math.sign(correctedRight) * gate;
    const gUp = Math.abs(correctedUp) <= gate ? 0 : correctedUp - Math.sign(correctedUp) * gate;

    // --- adaptive blend weight from measured angular speed
    const speed = Math.max(Math.abs(correctedRight), Math.abs(correctedUp));
    const t = clamp(speed / Math.max(moveRate, 1e-3), 0, 1);
    const alpha = stillAlpha + (moveAlpha - stillAlpha) * t;

    // --- predict with the gyro, then correct toward the accelerometer
    const predRight = this.right + gRight * step;
    const predUp = this.up + gUp * step;

    this.right = alpha * predRight + (1 - alpha) * accelRight;
    this.up = alpha * predUp + (1 - alpha) * accelUp;
    return this;
  }
}

export const gToDeg = (g) => (Math.asin(clamp(g, -1, 1)) * 180) / Math.PI;
export const degToG = (deg) => Math.sin((clamp(deg, 0, 90) * Math.PI) / 180);
