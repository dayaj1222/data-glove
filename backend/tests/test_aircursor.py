import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evdev import ecodes as e

from app.aircursor import AirCursor, Hysteresis


class FakeDev:
    def __init__(self):
        self.events = []

    def write(self, kind, code, value):
        self.events.append((kind, code, value))

    def syn(self):
        pass

    def close(self):
        pass

    def keys(self):
        return [(c, v) for k, c, v in self.events if k == e.EV_KEY]


class Src:
    latest_frame = None
    frames_total = 0


def make(**cfg):
    ac = AirCursor(Src(), device_factory=lambda: FakeDev(), calibration_path=Path('/nonexistent/aircursor.json'))
    ac._dev = FakeDev()        # drive process() directly, no thread
    ac.update_config(cfg)
    return ac, ac._dev


# u = board-frame gravity direction. Palm down/level: roll 0. Palm sideways: roll 90. Palm up: roll 180.
# POINT_DOWN: finger pitched well below level (clutch).
LEVEL, ROLLED, PALM_UP, POINT_DOWN = (0, 1, 0), (0, 0, 1), (0, -1, 0), (-0.8, 0.6, 0)
DOWN = POINT_DOWN


def frame(gyro=(0, 0, 0), prim=0, sec=0, accel=LEVEL):
    # primary = flex_1, secondary = flex_0 (the defaults)
    return {"flex": [sec, prim, 0, 0, 0], "accel": list(accel), "gyro": list(gyro)}


class Clock:
    def __init__(self):
        self.t = 100.0

    def run(self, ac, f, n, dt=0.02):
        for _ in range(n):
            self.t += dt
            ac.process(f, dt, self.t)


def test_hysteresis_does_not_chatter():
    h = Hysteresis()
    assert not h.update(100, 100, "above")
    assert h.update(140, 100, "above")
    assert h.update(110, 100, "above")
    assert not h.update(60, 100, "above")


def test_turning_right_moves_cursor_right():
    ac, _ = make(); c = Clock()
    c.run(ac, frame(), 40)
    c.run(ac, frame(gyro=(0, -60, 0)), 10)
    assert ac._pending[0] > 0


def test_raising_finger_moves_cursor_up():
    ac, _ = make(); c = Clock()
    c.run(ac, frame(), 40)
    c.run(ac, frame(gyro=(0, 0, 60)), 10)
    assert ac._pending[1] < 0


def test_roll_about_the_finger_does_not_move():
    ac, _ = make(); c = Clock()
    c.run(ac, frame(), 40)
    c.run(ac, frame(gyro=(80, 0, 0)), 10)
    assert abs(ac._pending[0]) < 1e-6 and abs(ac._pending[1]) < 1e-6


def test_still_hand_learns_bias_and_stays_put():
    ac, _ = make(); c = Clock()
    c.run(ac, frame(gyro=(0, 2.0, 0.5)), 200)
    ac._pending = [0.0, 0.0]
    c.run(ac, frame(gyro=(0, 2.0, 0.5)), 20)
    assert abs(ac._pending[0]) < 0.5 and abs(ac._pending[1]) < 0.5



M = e.KEY_LEFTMETA
GRID = {
    # zone accel,  finger args,                    expected presses
    ("down", "a"):  (LEVEL,   dict(prim=400),           [(e.BTN_LEFT, 1)]),
    ("down", "b"):  (LEVEL,   dict(sec=400),            [(e.BTN_RIGHT, 1)]),
    ("down", "ab"): (LEVEL,   dict(prim=400, sec=400),  []),                       # scroll
    ("side", "a"):  (ROLLED,  dict(prim=400),           [(M, 1), (e.BTN_LEFT, 1)]),
    ("side", "b"):  (ROLLED,  dict(sec=400),            [(M, 1), (e.BTN_RIGHT, 1)]),
    ("side", "ab"): (ROLLED,  dict(prim=400, sec=400),  [(e.BTN_MIDDLE, 1)]),
    ("up", "a"):    (PALM_UP, dict(prim=400),           [(e.KEY_LEFTALT, 1), (e.KEY_LEFT, 1)]),
    ("up", "b"):    (PALM_UP, dict(sec=400),            [(e.KEY_LEFTALT, 1), (e.KEY_RIGHT, 1)]),
    ("up", "ab"):   (PALM_UP, dict(prim=400, sec=400),  [(e.KEY_ESC, 1)]),
}


def test_all_nine_gestures():
    for (zone, g), (accel, fingers, expected) in GRID.items():
        ac, dev = make(); c = Clock()
        c.run(ac, frame(accel=accel), 5)                       # settle into the zone
        assert ac.stats["zone"] == zone, (zone, g)
        c.run(ac, frame(accel=accel, **fingers), 10)
        assert dev.keys() == expected, (zone, g, dev.keys())
        if g == "ab" and zone == "down":
            assert ac._scroll
        # release: everything pressed comes up again, in reverse order
        c.run(ac, frame(accel=accel), 4)
        ups = [(code, 0) for code, _ in reversed(expected)]
        assert dev.keys() == expected + ups, (zone, g, dev.keys())
        assert not ac._scroll and not ac._combo


def test_zone_boundaries():
    ac, _ = make(); c = Clock()
    for accel, zone in ((LEVEL, "down"), (ROLLED, "side"), (PALM_UP, "up"), (ROLLED, "side"), (LEVEL, "down")):
        c.run(ac, frame(accel=accel), 5)
        assert ac.stats["zone"] == zone


def test_either_side_counts_as_sideways():
    ac, _ = make(); c = Clock()
    c.run(ac, frame(accel=(0, 0, -1)), 5)           # rolled the other way
    assert ac.stats["zone"] == "side"


def test_quick_bend_is_still_a_tap():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(prim=400), 1)                    # 20 ms, shorter than chord_ms
    c.run(ac, frame(prim=0), 3)
    assert dev.keys() == [(e.BTN_LEFT, 1), (e.BTN_LEFT, 0)]


def test_zone_is_locked_while_a_gesture_is_held():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(accel=LEVEL), 5)
    c.run(ac, frame(prim=400, accel=LEVEL), 10)       # left button down in the "down" zone
    c.run(ac, frame(prim=400, accel=ROLLED), 6)      # wrist twists mid-drag
    assert dev.keys() == [(e.BTN_LEFT, 1)]            # no Super appeared, still the same drag
    c.run(ac, frame(prim=0, accel=ROLLED), 3)
    assert dev.keys() == [(e.BTN_LEFT, 1), (e.BTN_LEFT, 0)]


def test_a_second_finger_joining_late_does_not_change_the_gesture():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(prim=400), 10)
    c.run(ac, frame(prim=400, sec=400), 10)
    assert dev.keys() == [(e.BTN_LEFT, 1)]


def test_both_fingers_scroll_without_clicking():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(), 40)
    c.run(ac, frame(prim=400, sec=400, gyro=(0, 0, 40)), 10)
    assert dev.keys() == []
    assert ac.stats["mode"] == "scroll"
    assert ac._scroll_pending > 0                    # finger up -> scroll up
    assert ac._pending == [0.0, 0.0]                 # cursor frozen


def test_clutch_releases_and_freezes_when_hand_is_lowered():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(prim=400), 10)
    assert ac._combo
    c.run(ac, frame(prim=400, accel=POINT_DOWN, gyro=(0, -60, 0)), 3)
    assert ac.stats["mode"] == "clutch"
    assert not ac._combo
    ac._pending = [0.0, 0.0]
    c.run(ac, frame(accel=POINT_DOWN, gyro=(0, -60, 0)), 5)
    assert ac._pending == [0.0, 0.0]


def test_cursor_holds_still_right_after_a_press():
    ac, _ = make(); c = Clock()
    c.run(ac, frame(), 40)
    c.run(ac, frame(prim=400), 8)
    ac._pending = [0.0, 0.0]
    c.run(ac, frame(prim=400, gyro=(0, -60, 0)), 3)
    assert ac._pending == [0.0, 0.0]


def test_remapping_a_cell():
    ac, dev = make(down_a="middle"); c = Clock()
    c.run(ac, frame(prim=400), 10)
    assert dev.keys() == [(e.BTN_MIDDLE, 1)]


def test_invalid_action_is_ignored():
    ac, _ = make()
    ac.update_config({"down_a": "format_disk"})
    assert ac.config["down_a"] == "left"


def test_release_all_clears_everything():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(accel=ROLLED), 5)
    c.run(ac, frame(prim=400, accel=ROLLED), 10)
    ac._release_all()
    assert not ac._combo
    assert (M, 0) in dev.keys() and (e.BTN_LEFT, 0) in dev.keys()


def test_fingers_bent_one_after_the_other_still_make_a_chord():
    ac, dev = make(); c = Clock()
    c.run(ac, frame(), 40)
    c.run(ac, frame(prim=400), 3)                    # 60 ms lead, inside chord_ms
    c.run(ac, frame(prim=400, sec=400), 8)
    assert dev.keys() == [] and ac._scroll


def test_threshold_margin_is_configurable():
    ac, dev = make(primary_threshold=100, primary_margin=10); c = Clock()
    c.run(ac, frame(prim=115), 10)                   # 115 > 100 + 10
    assert dev.keys() == [(e.BTN_LEFT, 1)]


def test_finger_calibration_sets_thresholds():
    class Live:
        frames_total = 0
        latest_frame = {"flex": [60, 70, 0, 0, 0], "accel": [0, 1, 0], "gyro": [0, 0, 0]}

    import threading, time
    src = Live()

    def pump():
        for _ in range(200):
            src.frames_total += 1
            time.sleep(0.005)

    ac = AirCursor(src, device_factory=lambda: FakeDev(), calibration_path=Path('/nonexistent/aircursor.json'))
    t = threading.Thread(target=pump); t.start()
    ac.capture_fingers("straight", seconds=0.5)
    t.join()
    src.latest_frame = {"flex": [900, 700, 0, 0, 0], "accel": [0, 1, 0], "gyro": [0, 0, 0]}
    t = threading.Thread(target=pump); t.start()
    out = ac.capture_fingers("bent", seconds=0.5)
    t.join()
    # primary = flex_1 (70 -> 700), secondary = flex_0 (60 -> 900)
    assert abs(ac.config["primary_threshold"] - 385) < 1 and ac.config["primary_mode"] == "above"
    assert abs(ac.config["secondary_threshold"] - 480) < 1
    assert "applied" in out
