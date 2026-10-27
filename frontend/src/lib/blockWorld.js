import * as CANNON from 'cannon-es';

/**
 * Rigid-body world for the block stacker (cannon-es): solid boxes with friction that stack, slide,
 * tip and topple. Kept free of any rendering so it can be exercised from a plain script.
 *
 * Units: 1 block = 1 unit. The table top is the plane y = 0.
 */

export const TABLE_W = 12;
export const TABLE_D = 8;
const HOLD_GAIN = 22;          // 1/s: how quickly a held block follows the claw
const HOLD_MAX = 12;           // u/s: speed cap (at 60 fps that is 0.2 per frame, far less than a block)

export class BlockWorld {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.allowSleep = true;
    this.world.solver.iterations = 40;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.mat = new CANNON.Material('block');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.mat, this.mat, {
      friction: 0.7, restitution: 0.0, contactEquationStiffness: 1e8, contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8, frictionEquationRelaxation: 3,
    }));
    const table = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(TABLE_W / 2, 0.25, TABLE_D / 2)),
      position: new CANNON.Vec3(0, -0.25, 0),
      material: this.mat,
    });
    this.world.addBody(table);
    this.blocks = [];
  }

  addBlock(x, y, z, w, d, h = 1) {
    const body = new CANNON.Body({
      mass: w * d * h,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
      position: new CANNON.Vec3(x, y, z),
      material: this.mat,
      linearDamping: 0.08,
      angularDamping: 0.35,
      allowSleep: true,
      sleepSpeedLimit: 0.2,
      sleepTimeLimit: 0.5,
    });
    this.world.addBody(body);
    const b = { body, w, h, d, held: false, mesh: null };
    this.blocks.push(b);
    return b;
  }

  removeBlock(b) {
    this.world.removeBody(b.body);
    this.blocks = this.blocks.filter((o) => o !== b);
    this.wakeAll();                       // sleeping blocks must notice that their support is gone
  }

  wakeAll() {
    this.blocks.forEach((o) => o.body.wakeUp());
  }

  clear() {
    [...this.blocks].forEach((b) => this.removeBlock(b));
  }

  step(dt) {
    this.world.step(1 / 120, dt, 6);
  }

  /**
   * Move a held block toward (tx, ty, tz) as a solid body. It is kinematic while held and is swept one axis at a time
   * against the table and every other block, so it stops when it touches something instead of passing through
   * (and never shoves a tower over by accident). Returns the position it actually reached.
   */
  hold(b, tx, ty, tz, dt = 1 / 60) {
    const body = b.body;
    if (!b.held) {
      b.mass0 = body.mass;
      body.type = CANNON.Body.KINEMATIC;
      body.mass = 0;
      body.updateMassProperties();
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.quaternion.set(0, 0, 0, 1);
      b.held = true;
      this.wakeAll();
    }
    const p = body.position;
    const gain = Math.min(1, HOLD_GAIN * dt);
    const want = [(tx - p.x) * gain, (ty - p.y) * gain, (tz - p.z) * gain];
    const cap = HOLD_MAX * dt;
    const n = Math.hypot(...want);
    if (n > cap) want.forEach((_, i) => { want[i] *= cap / n; });

    const others = this.blocks.filter((o) => o !== b && !o.held);
    others.forEach((o) => o.body.updateAABB());
    const half = [b.w / 2, b.h / 2, b.d / 2];
    const pos = [p.x, p.y, p.z];
    for (const axis of [1, 0, 2]) {                                   // y first, then x, then z
      let d = want[axis];
      if (d === 0) continue;
      for (const o of others) {
        const lo = o.body.aabb.lowerBound;
        const hi = o.body.aabb.upperBound;
        const olo = [lo.x, lo.y, lo.z];
        const ohi = [hi.x, hi.y, hi.z];
        let overlapOther = true;
        for (let k = 0; k < 3; k += 1) {
          if (k === axis) continue;
          if (pos[k] + half[k] <= olo[k] + 1e-4 || pos[k] - half[k] >= ohi[k] - 1e-4) { overlapOther = false; break; }
        }
        if (!overlapOther) continue;
        if (d > 0) {
          const gap = olo[axis] - (pos[axis] + half[axis]);
          if (gap >= -1e-4) d = Math.min(d, Math.max(0, gap));
        } else {
          const gap = (pos[axis] - half[axis]) - ohi[axis];
          if (gap >= -1e-4) d = Math.max(d, -Math.max(0, gap));
        }
      }
      pos[axis] += d;
    }
    pos[1] = Math.max(half[1], pos[1]);                                // never below the table
    pos[0] = Math.max(-TABLE_W / 2 + half[0], Math.min(TABLE_W / 2 - half[0], pos[0]));
    pos[2] = Math.max(-TABLE_D / 2 + half[2], Math.min(TABLE_D / 2 - half[2], pos[2]));
    body.position.set(pos[0], pos[1], pos[2]);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.set(0, 0, 0);
    body.aabbNeedsUpdate = true;
    body.wakeUp();
    return { x: pos[0], y: pos[1], z: pos[2] };
  }

  release(b) {
    if (!b.held) return;
    b.body.type = CANNON.Body.DYNAMIC;
    b.body.mass = b.mass0 || b.w * b.d * b.h;
    b.body.updateMassProperties();
    b.body.velocity.set(0, 0, 0);
    b.body.angularVelocity.set(0, 0, 0);
    b.held = false;
    b.body.wakeUp();
  }

  /** How level a block is: 1 = upright, lower when it lies on its side. */
  uprightness(b) {
    const up = b.body.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    return up.y;
  }

  /** True when no other block sits on top of `b` (approximate, axis-aligned). */
  exposed(b) {
    const p = b.body.position;
    return !this.blocks.some((o) => {
      if (o === b || o.held) return false;
      const q = o.body.position;
      return Math.abs(q.x - p.x) < (b.w + o.w) / 2 - 0.05
        && Math.abs(q.z - p.z) < (b.d + o.d) / 2 - 0.05
        && q.y - o.h / 2 > p.y + b.h / 2 - 0.2
        && q.y - o.h / 2 < p.y + b.h / 2 + 0.4;
    });
  }

  /** Height of the highest surface under a footprint at (x, z) that is below `maxY`; used for the landing ghost. */
  topUnder(b, x, z, maxY = 99) {
    let top = 0;
    for (const o of this.blocks) {
      if (o === b || o.held) continue;
      const q = o.body.position;
      if (Math.abs(q.x - x) < (b.w + o.w) / 2 && Math.abs(q.z - z) < (b.d + o.d) / 2) {
        const t = q.y + o.h / 2;
        if (t <= maxY) top = Math.max(top, t);
      }
    }
    return top;
  }

  /** Still: asleep or barely moving. */
  still(b) {
    if (b.body.sleepState === CANNON.Body.SLEEPING) return true;
    return b.body.velocity.length() < 0.25 && b.body.angularVelocity.length() < 0.4;
  }

  /** Highest top among settled, upright blocks to the right of `minX`. */
  towerHeight(minX) {
    let top = 0;
    for (const b of this.blocks) {
      if (b.held || !this.still(b) || this.uprightness(b) < 0.96) continue;
      const p = b.body.position;
      if (p.x - b.w / 2 < minX) continue;
      top = Math.max(top, p.y + b.h / 2);
    }
    return top;
  }
}
