"""Air mouse: turn the glove into a real desktop pointer through uinput.

Cursor movement is relative, like a physical mouse: it follows how fast the
finger turns, not where it points (yaw angle drifts without a magnetometer).

Geometry (board: +X along the finger, +Y up, +Z to the user's right). With u the
unit "up" vector from the accelerometer and w the gyro vector:

    yaw   rate (right) = -(w_y*u_y + w_z*u_z) / (1 - u_x^2)
    pitch rate (up)    =  (w_z*u_y - w_y*u_z) / cos(pitch)
    pitch  (absolute)  =  asin(u_x)            finger elevation, drift-free
    roll   (absolute)  =  atan2(u_z, u_y)      wrist twist about the finger, drift-free

GESTURE GRID. Two flex fingers (A = primary, B = secondary) and the wrist roll
give 3 x 3 = 9 distinct gestures:

                      A alone       B alone       A + B together
    palm DOWN         left          right         scroll
    palm SIDEWAYS     drag window   resize window middle button
    palm UP           back          forward       escape

The zone is read from gravity, so it never drifts. Hold each of the three poses
once and capture it (`calibrate`); the zone is then whichever captured pose the hand
is closest to, so it works however the board happens to sit on the hand. Without a
calibration it falls back to thresholds on the roll angle. The
zone is read when a gesture starts and then held until the fingers relax, so
turning the wrist mid-drag cannot change what the gesture does. Every cell is
configurable (`down_a` ... `up_ab`).

Other rules:
    clutch     finger pointed down freezes the cursor and releases everything
    hold       the cursor stands still briefly after a press (no shaken clicks)
    chord      a press waits `chord_ms` to tell one finger from two; a bend
               shorter than that is still delivered as a tap on release

Safety: everything is released when disabled, when frames go stale, and on exit,
so a lost USB cable cannot leave a button or modifier stuck down.
"""

from __future__ import annotations

import atexit
import json
import math
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

CALIBRATION_FILE = Path(__file__).resolve().parent.parent / "aircursor_calibration.json"
ZONES = ("down", "side", "up")
ZONE_MARGIN = 10.0     # deg a new zone must beat the current one by before switching
TICK = 0.01            # s, output rate of the mover thread
HI_RES = 120           # REL_WHEEL_HI_RES units per scroll notch
STALE_AFTER = 0.5      # s without a new frame -> release everything
HYSTERESIS = 20        # default raw ADC counts either side of a flex threshold

MOD_KEYS = {
    "SUPER": "KEY_LEFTMETA",
    "ALT": "KEY_LEFTALT",
    "CTRL": "KEY_LEFTCTRL",
    "SHIFT": "KEY_LEFTSHIFT",
}

# Named actions. Each is a combo pressed in order and released in reverse, so a
# "hold" gesture keeps it down: mouse buttons for click/drag, keys for shortcuts.
ACTIONS = (
    "none", "left", "right", "middle", "mod_left", "mod_right",
    "scroll", "back", "forward", "escape",
)

DEFAULT_CONFIG: Dict[str, Any] = {
    "gain": 22.0,             # pixels per degree of finger turn
    "accel": 0.012,           # extra gain per deg/s above the gate (fast flick = far)
    "gate": 1.2,              # deg/s below which a rate is treated as noise
    "invert_x": False,
    "invert_y": False,
    "primary_channel": 1,     # finger A
    "primary_threshold": 100,
    "primary_mode": "above",  # "above": bent when flex > threshold, else "below"
    "primary_margin": 20.0,   # counts above/below the threshold needed to flip
    "secondary_channel": 0,   # finger B
    "secondary_threshold": 100,
    "secondary_mode": "above",
    "secondary_margin": 20.0,
    "roll_side": 45.0,        # |roll| above this = palm sideways ...
    "roll_up": 135.0,         # ... and above this = palm up
    "mod_key": "SUPER",
    "clutch_enabled": True,   # point the finger down to freeze everything
    "clutch_pitch": 40.0,     # degrees below level that engage the clutch
    "scroll_gain": 0.25,      # wheel notches per degree of finger travel
    "invert_scroll": False,
    "stabilize_ms": 180,      # cursor holds still this long after a press
    "chord_ms": 120,          # wait this long to tell one finger from two
    # the 3 x 3 grid
    "down_a": "left", "down_b": "right", "down_ab": "scroll",
    "side_a": "mod_left", "side_b": "mod_right", "side_ab": "middle",
    "up_a": "back", "up_b": "forward", "up_ab": "escape",
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class Hysteresis:
    """Schmitt trigger on a flex reading."""

    def __init__(self) -> None:
        self.on = False

    def update(self, value: float, threshold: float, mode: str, margin: float = HYSTERESIS) -> bool:
        sign = 1.0 if mode == "above" else -1.0
        d = sign * (value - threshold)
        if not self.on and d > margin:
            self.on = True
        elif self.on and d < -margin:
            self.on = False
        return self.on


class AirCursor:
    def __init__(self, source: Any, device_factory: Optional[Callable[[], Any]] = None) -> None:
        self._source = source                     # object with .latest_frame / .frames_total
        self._factory = device_factory or self._real_device
        self.config: Dict[str, Any] = dict(DEFAULT_CONFIG)
        self.enabled = False
        self.error: Optional[str] = None
        self.stats: Dict[str, Any] = {
            "mode": "down", "zone": "down", "gesture": "-", "action": "none", "held": False,
            "rate_x": 0.0, "rate_y": 0.0, "pitch": 0.0, "roll": 0.0, "moved": 0,
            "angles": {z: None for z in ZONES},
            "a_bent": False, "b_bent": False, "flex_a": 0.0, "flex_b": 0.0,
        }

        self._dev: Any = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self.poses: Dict[str, Optional[List[float]]] = {z: None for z in ZONES}
        self._finger_cal: Dict[str, List[float]] = {}
        self._load_poses()
        atexit.register(self.disable)
        self._reset_state()

    def _reset_state(self) -> None:
        self._bias = [0.0, 0.0, 0.0]
        self._seen = -1
        self._last_new = 0.0
        self._pending = [0.0, 0.0]
        self._frac = [0.0, 0.0]
        self._scroll_pending = 0.0
        self._scroll_hi_acc = 0
        self._scroll_frac = 0.0
        self._prim = Hysteresis()
        self._sec = Hysteresis()
        self._combo: List[int] = []          # keys/buttons currently held, in press order
        self._scroll = False
        self._gesture: Optional[str] = None  # "a" | "b" | "ab" while one is active
        self._pend_t: Optional[float] = None
        self._pend_fingers = (False, False)
        self._clutched = False
        self._zone = "down"
        self._freeze_until = 0.0

    # ------------------------------------------------------------ lifecycle
    @staticmethod
    def _real_device() -> Any:
        from evdev import UInput, ecodes as e

        caps = {
            e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE,
                       e.KEY_LEFTMETA, e.KEY_LEFTALT, e.KEY_LEFTCTRL, e.KEY_LEFTSHIFT,
                       e.KEY_LEFT, e.KEY_RIGHT, e.KEY_ESC],
            e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL, e.REL_WHEEL_HI_RES],
        }
        return UInput(caps, name="Data Glove Air Mouse")

    def enable(self) -> bool:
        with self._lock:
            if self.enabled:
                return True
            if self._dev is not None:        # leftover from a loop that died
                try:
                    self._dev.close()
                except Exception:  # noqa: BLE001
                    pass
                self._dev = None
            try:
                self._dev = self._factory()
            except Exception as exc:  # noqa: BLE001
                self._dev = None
                self.error = f"cannot create uinput device: {exc}"
                return False
            self.error = None
            self._reset_state()
            self._stop.clear()
            self.enabled = True
            self._thread = threading.Thread(target=self._loop, daemon=True, name="air-cursor")
            self._thread.start()
            return True

    def disable(self) -> None:
        with self._lock:
            self.enabled = False
            self._stop.set()
        t = self._thread
        if t is not None and t.is_alive() and threading.current_thread() is not t:
            t.join(timeout=1.0)
        with self._lock:
            self._release_all()
            dev, self._dev = self._dev, None
            if dev is not None:
                try:
                    dev.close()
                except Exception:  # noqa: BLE001
                    pass
            self._thread = None

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            for k, v in patch.items():
                if k in DEFAULT_CONFIG and v is not None:
                    if k == "mod_key" and v not in MOD_KEYS:
                        continue
                    if k[:4] in ("down", "side") or k[:2] == "up":
                        if k.endswith(("_a", "_b", "_ab")) and v not in ACTIONS:
                            continue
                    self.config[k] = type(DEFAULT_CONFIG[k])(v)
            return dict(self.config)

    def state(self) -> Dict[str, Any]:
        return {"enabled": self.enabled, "error": self.error, "config": dict(self.config),
                "calibrated": {z: self.poses[z] is not None for z in ZONES}, **self.stats}

    # --------------------------------------------------------------- output
    def _emit(self, kind: int, code: int, value: int) -> None:
        if self._dev is not None:
            self._dev.write(kind, code, value)

    def _sync(self) -> None:
        if self._dev is not None:
            self._dev.syn()

    def _combo_for(self, action: str) -> List[int]:
        from evdev import ecodes as e

        mod = getattr(e, MOD_KEYS[self.config["mod_key"]])
        return {
            "left": [e.BTN_LEFT],
            "right": [e.BTN_RIGHT],
            "middle": [e.BTN_MIDDLE],
            "mod_left": [mod, e.BTN_LEFT],
            "mod_right": [mod, e.BTN_RIGHT],
            "back": [e.KEY_LEFTALT, e.KEY_LEFT],
            "forward": [e.KEY_LEFTALT, e.KEY_RIGHT],
            "escape": [e.KEY_ESC],
        }.get(action, [])

    def _press(self, action: str) -> None:
        """Start an action: press its combo (or switch scrolling on) and hold it."""
        from evdev import ecodes as e

        if action == "scroll":
            self._scroll = True
        for code in self._combo_for(action):
            self._emit(e.EV_KEY, code, 1)
            self._sync()
            self._combo.append(code)
        self._publish()

    def _release(self) -> None:
        """Release whatever is held, last pressed first."""
        from evdev import ecodes as e

        for code in reversed(self._combo):
            self._emit(e.EV_KEY, code, 0)
            self._sync()
        self._combo = []
        self._scroll = False
        self._publish()

    def _publish(self) -> None:
        self.stats["held"] = bool(self._combo) or self._scroll

    def _release_all(self) -> None:
        try:
            self._release()
        except Exception:  # noqa: BLE001
            pass
        self._prim.on = False
        self._sec.on = False
        self._pend_t = None
        self._gesture = None
        self._pending = [0.0, 0.0]
        self._scroll_pending = 0.0
        self._publish()

    # ---------------------------------------------------------------- maths
    def pose(self, frame: Dict[str, Any], dt: float) -> Optional[Dict[str, float]]:
        """Finger turn rates plus absolute pitch and roll, or None without gravity."""
        ax, ay, az = (float(v) for v in frame["accel"])
        mag = math.sqrt(ax * ax + ay * ay + az * az)
        if mag < 1e-6:
            return None
        ux, uy, uz = ax / mag, ay / mag, az / mag
        raw = [float(v) for v in frame["gyro"]]
        speed = math.sqrt(sum((raw[i] - self._bias[i]) ** 2 for i in range(3)))
        if speed < 4.0:  # quiet: whatever the gyro still reads is bias
            k = min(1.0, dt * 1.5)
            for i in range(3):
                self._bias[i] += (raw[i] - self._bias[i]) * k
        wx, wy, wz = (raw[i] - self._bias[i] for i in range(3))
        cos_p = max(0.1, math.sqrt(max(0.0, 1.0 - ux * ux)))
        return {
            "up": (wz * uy - wy * uz) / cos_p,
            "right": -(wy * uy + wz * uz) / max(0.05, 1.0 - ux * ux),
            "pitch": math.degrees(math.asin(_clamp(ux, -1.0, 1.0))),
            "roll": math.degrees(math.atan2(uz, uy)),
            "u": (ux, uy, uz),
        }

    def _shape(self, rate: float) -> float:
        """Dead-band, then a gentle speed curve: slow = precise, fast = far."""
        gate = self.config["gate"]
        a = abs(rate)
        if a <= gate:
            return 0.0
        a -= gate
        return math.copysign(a * (1.0 + self.config["accel"] * a), rate)

    def _update_clutch(self, pitch: float) -> None:
        cfg = self.config
        if not cfg["clutch_enabled"]:
            self._clutched = False
            return
        lim = cfg["clutch_pitch"]
        if not self._clutched and pitch < -lim:
            self._clutched = True
        elif self._clutched and pitch > -lim + 8:
            self._clutched = False

    @staticmethod
    def _angle(u: Any, ref: Any) -> float:
        d = _clamp(u[0] * ref[0] + u[1] * ref[1] + u[2] * ref[2], -1.0, 1.0)
        return math.degrees(math.acos(d))

    def _update_zone(self, u: Any, roll: float) -> None:
        """Palm zone. Calibrated: nearest captured pose, switching only when another
        pose beats the current one by ZONE_MARGIN. Otherwise: thresholds on |roll|."""
        if all(self.poses[z] is not None for z in ZONES):
            ang = {z: self._angle(u, self.poses[z]) for z in ZONES}
            self.stats["angles"] = {z: round(v, 1) for z, v in ang.items()}
            best = min(ang, key=ang.get)
            if best != self._zone and ang[best] < ang[self._zone] - ZONE_MARGIN:
                self._zone = best
            return
        cfg = self.config
        order = ("down", "side", "up")
        bounds = (cfg["roll_side"], cfg["roll_up"])
        h = 4.0
        r = abs(roll)
        i = order.index(self._zone)
        while i < 2 and r > bounds[i] + h:
            i += 1
        while i > 0 and r < bounds[i - 1] - h:
            i -= 1
        self._zone = order[i]

    def _new_frames(self, seen: int) -> tuple:
        """Every frame that arrived since counter `seen`, oldest first, plus the new counter.

        USB-serial delivers frames in bursts (~5 at once), so looking only at the
        newest one throws most of the data away. The source keeps a deque of recent
        frames; sources without one (tests) fall back to the latest frame."""
        total = getattr(self._source, "frames_total", 0)
        if total == seen:
            return [], total
        buf = getattr(self._source, "frames", None)
        if buf:
            n = min(total - seen, len(buf))
            if n > 0:
                return list(buf)[-n:], total
        latest = getattr(self._source, "latest_frame", None)
        return ([latest] if latest is not None else []), total

    # ----------------------------------------------------------- calibration
    def _load_poses(self) -> None:
        try:
            data = json.loads(CALIBRATION_FILE.read_text())
            for z in ZONES:
                v = data.get(z)
                if isinstance(v, list) and len(v) == 3:
                    self.poses[z] = [float(x) for x in v]
        except Exception:  # noqa: BLE001 - missing/corrupt file just means "uncalibrated"
            pass

    def _save_poses(self) -> None:
        try:
            CALIBRATION_FILE.write_text(json.dumps(self.poses))
        except Exception:  # noqa: BLE001
            pass

    def capture_pose(self, zone: str, seconds: float = 0.7) -> Dict[str, Any]:
        """Average the gravity direction while the hand is held in `zone`'s pose.
        Works with the air mouse off: it samples the live frames directly."""
        if zone not in ZONES:
            raise ValueError(f"unknown zone {zone!r}")
        samples: List[List[float]] = []
        n_frames = 0
        seen = getattr(self._source, "frames_total", 0)
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            time.sleep(0.01)
            frames, seen = self._new_frames(seen)
            for frame in frames:
                n_frames += 1
                ax, ay, az = (float(v) for v in frame["accel"])
                mag = math.sqrt(ax * ax + ay * ay + az * az)
                if mag > 0.5:
                    samples.append([ax / mag, ay / mag, az / mag])
        if len(samples) < 8:
            raise RuntimeError(
                f"only {len(samples)} usable accel samples ({n_frames} frames) in {seconds}s - "
                "is the glove streaming and the IMU detected?")
        mean = [sum(c) / len(samples) for c in zip(*samples)]
        n = math.sqrt(sum(v * v for v in mean))
        if n < 0.6:
            raise RuntimeError("hand was moving - hold the pose still and try again")
        ref = [v / n for v in mean]
        with self._lock:
            self.poses[zone] = ref
            self._save_poses()
        return {"zone": zone, "samples": len(samples), "vector": [round(v, 3) for v in ref]}

    def capture_fingers(self, kind: str, seconds: float = 0.8) -> Dict[str, Any]:
        """Average both fingers' flex values while they are held `straight` or `bent`.
        Once both have been captured the thresholds are set halfway between, the
        direction (above/below) follows which is larger, and the hysteresis margin
        scales with the gap so a noisy sensor cannot chatter."""
        if kind not in ("straight", "bent"):
            raise ValueError(f"kind must be straight or bent, got {kind!r}")
        cfg = self.config
        chans = (cfg["primary_channel"], cfg["secondary_channel"])
        sums = [0.0, 0.0]
        n = 0
        seen = getattr(self._source, "frames_total", 0)
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            time.sleep(0.01)
            frames, seen = self._new_frames(seen)
            for frame in frames:
                for i, ch in enumerate(chans):
                    sums[i] += float(frame["flex"][ch])
                n += 1
        if n < 8:
            raise RuntimeError("no live sensor frames - is the glove streaming?")
        got = [v / n for v in sums]
        self._finger_cal[kind] = got
        out: Dict[str, Any] = {"kind": kind, "primary": round(got[0], 1), "secondary": round(got[1], 1)}
        if "straight" in self._finger_cal and "bent" in self._finger_cal:
            patch: Dict[str, Any] = {}
            for i, name in enumerate(("primary", "secondary")):
                st, bt = self._finger_cal["straight"][i], self._finger_cal["bent"][i]
                gap = abs(bt - st)
                patch[f"{name}_threshold"] = round((st + bt) / 2, 1)
                patch[f"{name}_mode"] = "above" if bt > st else "below"
                patch[f"{name}_margin"] = round(_clamp(gap * 0.2, 8.0, 80.0), 1)
                out[f"{name}_gap"] = round(gap, 1)
            self.update_config(patch)
            out["applied"] = patch
        return out

    def reset_poses(self) -> None:
        with self._lock:
            self.poses = {z: None for z in ZONES}
            self.stats["angles"] = {z: None for z in ZONES}
            self._save_poses()

    # -------------------------------------------------------------- gestures
    def _action_for(self, zone: str, gesture: str) -> str:
        return str(self.config.get(f"{zone}_{gesture}", "none"))

    def _hold_after(self, action: str, now: float) -> None:
        """Mouse-button actions hold the cursor still briefly so bending a finger
        does not shake the click."""
        if action in ("left", "right", "middle", "mod_left", "mod_right"):
            self._freeze_until = now + self.config["stabilize_ms"] / 1000.0

    def _start(self, gesture: str, now: float) -> None:
        action = self._action_for(self._zone, gesture)      # zone is fixed from here on
        self._gesture = gesture
        self.stats["gesture"] = gesture.upper()
        self.stats["action"] = action
        self._press(action)
        self._hold_after(action, now)

    def _end(self, now: float) -> None:
        action = self.stats["action"]
        self._release()
        self._gesture = None
        self.stats["gesture"] = "-"
        if action == "scroll":
            self._freeze_until = now + self.config["stabilize_ms"] / 1000.0

    def _fingers(self, a: bool, b: bool, now: float) -> None:
        cfg = self.config
        if self._clutched:
            if self._gesture or self._combo:
                self._release_all()
            return

        if self._gesture:
            # An active gesture lasts until every finger relaxes; a second finger
            # joining later is ignored so a drag cannot turn into something else.
            if not a and not b:
                self._end(now)
            return

        if not (a or b):
            if self._pend_t is not None:
                # Bend ended inside the chord window: deliver it as a tap.
                pa, pb = self._pend_fingers
                self._pend_t = None
                g = "ab" if pa and pb else "a" if pa else "b"
                self._start(g, now)
                self._end(now)
            return

        if a and b:                                          # both: no need to wait
            self._pend_t = None
            self._start("ab", now)
            return
        self._pend_fingers = (a, b)
        if self._pend_t is None:
            self._pend_t = now
        if now - self._pend_t >= cfg["chord_ms"] / 1000.0:
            self._pend_t = None
            self._start("a" if a else "b", now)

    def process(self, frame: Dict[str, Any], dt: float, now: Optional[float] = None) -> None:
        """One new sample: update gestures and queue cursor / scroll movement."""
        cfg = self.config
        now = time.monotonic() if now is None else now
        flex = frame["flex"]
        a = self._prim.update(float(flex[cfg["primary_channel"]]), cfg["primary_threshold"], cfg["primary_mode"], cfg["primary_margin"])
        b = self._sec.update(float(flex[cfg["secondary_channel"]]), cfg["secondary_threshold"], cfg["secondary_mode"], cfg["secondary_margin"])

        self.stats.update(a_bent=a, b_bent=b, flex_a=float(flex[cfg["primary_channel"]]),
                          flex_b=float(flex[cfg["secondary_channel"]]))
        p = self.pose(frame, dt)
        if p is None:
            return
        self._update_clutch(p["pitch"])
        if not self._gesture:                    # the zone is locked while a gesture is active
            self._update_zone(p["u"], p["roll"])
        self._fingers(a, b, now)

        self.stats.update(rate_x=round(p["right"], 1), rate_y=round(p["up"], 1),
                          pitch=round(p["pitch"], 1), roll=round(p["roll"], 1), zone=self._zone)
        self.stats["mode"] = "clutch" if self._clutched else ("scroll" if self._scroll else self._zone)

        if self._clutched:
            return
        if self._scroll:
            sign = -1.0 if cfg["invert_scroll"] else 1.0
            self._scroll_pending += self._shape(p["up"]) * dt * cfg["scroll_gain"] * sign
            return
        if now < self._freeze_until:
            self._pending = [0.0, 0.0]
            return
        sx = self._shape(p["right"]) * (-1 if cfg["invert_x"] else 1)
        sy = self._shape(p["up"]) * (-1 if cfg["invert_y"] else 1)
        self._pending[0] += sx * dt * cfg["gain"]
        self._pending[1] += -sy * dt * cfg["gain"]      # screen y grows downward

    def _drain(self) -> None:
        """Spread queued movement over the next ticks so 50 Hz data moves smoothly."""
        from evdev import ecodes as e

        out = [0, 0]
        for i in range(2):
            take = self._pending[i] * 0.5
            self._pending[i] -= take
            self._frac[i] += take
            step = int(self._frac[i])           # truncate toward zero
            self._frac[i] -= step
            out[i] = step
        wrote = False
        if out[0]:
            self._emit(e.EV_REL, e.REL_X, out[0])
            wrote = True
        if out[1]:
            self._emit(e.EV_REL, e.REL_Y, out[1])
            wrote = True
        if wrote:
            self.stats["moved"] += abs(out[0]) + abs(out[1])

        # Scroll: hi-res units every tick, plus a whole-notch event when one completes.
        take = self._scroll_pending * 0.5
        self._scroll_pending -= take
        self._scroll_frac += take * HI_RES
        hi = int(self._scroll_frac)
        self._scroll_frac -= hi
        if hi:
            self._emit(e.EV_REL, e.REL_WHEEL_HI_RES, hi)
            self._scroll_hi_acc += hi
            notches = int(self._scroll_hi_acc / HI_RES)
            if notches:
                self._emit(e.EV_REL, e.REL_WHEEL, notches)
                self._scroll_hi_acc -= notches * HI_RES
            wrote = True
        if wrote:
            self._sync()

    # ----------------------------------------------------------------- loop
    def _loop(self) -> None:
        try:
            while not self._stop.is_set():
                time.sleep(TICK)
                with self._lock:
                    if not self.enabled or self._dev is None:
                        break
                    now = time.monotonic()
                    frames, seen = self._new_frames(self._seen if self._seen >= 0 else getattr(self._source, "frames_total", 0))
                    if self._seen < 0:                      # first pass: start from "now", no backlog
                        self._seen = seen
                        self._last_new = now
                        frames = []
                    if frames:
                        span = _clamp(now - self._last_new, 0.001, 0.2) if self._last_new else 0.02 * len(frames)
                        dt = span / len(frames)
                        t0 = now - span
                        for i, frame in enumerate(frames):
                            self.process(frame, dt, t0 + dt * (i + 1))
                        self._seen = seen
                        self._last_new = now
                    elif now - self._last_new > STALE_AFTER and (self._combo or self._scroll):
                        self._release_all()          # lost the glove: never leave a button down
                    self._drain()
        except Exception as exc:  # noqa: BLE001
            self.error = f"air cursor stopped: {exc}"
        finally:
            with self._lock:
                self._release_all()
                self.enabled = False


def _make() -> AirCursor:
    from .serial_manager import serial_manager

    return AirCursor(serial_manager)


air_cursor = _make()
