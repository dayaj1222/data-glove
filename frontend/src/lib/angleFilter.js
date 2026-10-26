/**
 * Minimal 1D Kalman filter for a noisy angle signal.
 *
 * State is only the estimate (mean) and its variance. There is no motion model
 * because a hand does not accelerate predictably, so 'predict' just grows the
 * variance by a process-noise term and 'update' pulls the estimate toward the
 * measurement by the Kalman gain.
 *
 * The trick that keeps it both smooth and responsive: process noise grows with
 * the innovation (how far the new sample is from the estimate). A steady hand
 * gives tiny innovations, so the gain stays low and jitter is averaged away; a
 * real movement gives a large innovation, so the gain rises and the estimate
 * catches up within a few frames. A single fixed gain cannot do both.
 */
export default class AngleFilter {
  constructor() {
    this.x = null; // estimate
    this.p = 1;    // variance of the estimate
  }

  reset(x) {
    this.x = x;
    this.p = 1;
  }

  /**
   * @param {number} z  raw measurement
   * @param {number} dt seconds since the previous update
   * @param {number} r  measurement noise variance (larger = smoother)
   */
  update(z, dt, r) {
    if (!Number.isFinite(z)) return this.x;
    if (this.x == null) {
      this.reset(z);
      return this.x;
    }

    const innovation = z - this.x;
    const q = 0.5 + 40 * Math.abs(innovation) * Math.max(dt, 1 / 240);
    this.p += q;

    const k = this.p / (this.p + Math.max(r, 1e-3));
    this.x += k * innovation;
    this.p *= 1 - k;
    return this.x;
  }
}
