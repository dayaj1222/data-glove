"""Host-side measurements for the Final report (section 6, 7). Run from backend/:

    .venv/bin/python ../docs/measurements/measure_host.py

Writes ../docs/measurements/results.json. Everything here is measured on the
development PC; firmware timings need a logic analyser and are not in this file.
"""
import json
import math
import os
import pickle
import statistics as st
import sys
import threading
import time
from collections import deque
from pathlib import Path

sys.path.insert(0, os.getcwd())

import numpy as np

from app.aircursor import AirCursor
from app.device.framing import FRAME_MAGIC, FrameDecoder
from app.routers.training import extract_features, load_model


def stats(samples, unit):
    s = sorted(samples)
    n = len(s)
    return {
        "n": n, "unit": unit,
        "mean": round(st.fmean(s), 3), "std": round(st.pstdev(s), 3),
        "p50": round(s[n // 2], 3), "p99": round(s[min(n - 1, int(n * 0.99))], 3),
        "min": round(s[0], 3), "max": round(s[-1], 3),
    }


def timeit_us(fn, n, warm=50):
    for _ in range(warm):
        fn()
    out = []
    for _ in range(n):
        t = time.perf_counter_ns()
        fn()
        out.append((time.perf_counter_ns() - t) / 1000.0)
    return out


class FakeDev:
    def __init__(self):
        self.events = []
        self.first_write = None

    def write(self, kind, code, value):
        if self.first_write is None:
            self.first_write = time.perf_counter()
        self.events.append((time.perf_counter(), kind, code, value))

    def syn(self):
        pass

    def close(self):
        pass


class Src:
    def __init__(self):
        self.frames = deque(maxlen=1000)
        self.frames_total = 0
        self.latest_frame = None

    def push(self, f):
        self.frames.append(f)
        self.latest_frame = f
        self.frames_total += 1


def frame(flex=(0, 0), gyro=(0, 0, 0), accel=(0.0, 1.0, 0.0)):
    return {"flex": [flex[0], flex[1], 0, 0, 0], "accel": list(accel), "gyro": list(gyro)}


res = {}

# ---- 1. framing: bytes -> frame -------------------------------------------------
import struct
payload = struct.pack("<5H9f", 100, 200, 0, 0, 0, 0.1, 0.2, 0.9, 1.0, 2.0, 3.0, 0, 0, 0)
raw = FRAME_MAGIC + payload
dec = FrameDecoder()
res["framing_decode_per_frame"] = stats(timeit_us(lambda: dec.feed(raw), 20000), "us")

# ---- 2. air mouse: one sample through process() ---------------------------------
ac = AirCursor(Src(), device_factory=lambda: FakeDev())
ac._dev = FakeDev()
f_move = frame(gyro=(0, -40, 10), flex=(0, 300))
t = [100.0]


def proc():
    t[0] += 0.02
    ac.process(f_move, 0.02, t[0])


res["aircursor_process_per_sample"] = stats(timeit_us(proc, 20000), "us")

# ---- 3. feature extraction + inference -----------------------------------------
rng = np.random.default_rng(0)
window = [{**{f"flex_{i}": float(rng.integers(0, 4000)) for i in range(5)},
           **{f"{s}_{a}": float(rng.normal()) for s in ("accel", "gyro", "mag") for a in "xyz"}} for _ in range(25)]
res["extract_features_25_frames"] = stats(timeit_us(lambda: extract_features(window), 500), "us")

mp = "models/model_2gestures.pkl"
feat = extract_features(window).reshape(1, -1)


def baseline():
    with open(mp, "rb") as fh:
        m = pickle.load(fh)
    m.predict(feat)
    m.predict_proba(feat)


def cached():
    m = load_model(mp)
    m.predict(feat)
    m.predict_proba(feat)


res["predict_reload_each_call_BASELINE"] = stats(timeit_us(baseline, 200, warm=5), "us")
res["predict_cached_model_OPTIMISED"] = stats(timeit_us(cached, 200, warm=5), "us")
b, o = res["predict_reload_each_call_BASELINE"]["mean"], res["predict_cached_model_OPTIMISED"]["mean"]
res["predict_speedup"] = {"baseline_us": b, "optimised_us": o, "saved_us": round(b - o, 1), "factor": round(b / o, 2)}

# ---- 4. air mouse end to end: frame arrives -> first cursor event written -------
lat = []
for trial in range(60):
    src = Src()
    dev = FakeDev()
    ac2 = AirCursor(src, device_factory=lambda d=dev: d)
    ac2.enable()
    time.sleep(0.15)                       # let the loop settle on "now"
    for _ in range(10):
        src.push(frame())                  # quiet frames: learn bias
    time.sleep(0.12)
    dev.events.clear()
    dev.first_write = None
    t0 = time.perf_counter()
    for _ in range(5):                     # a burst of 5 moving frames, like USB delivers
        src.push(frame(gyro=(0, -120, 0)))
    deadline = time.perf_counter() + 0.5
    while dev.first_write is None and time.perf_counter() < deadline:
        time.sleep(0.0005)
    if dev.first_write is not None:
        lat.append((dev.first_write - t0) * 1000.0)
    ac2.disable()
    time.sleep(0.02)
res["aircursor_frame_to_cursor_event"] = stats(lat, "ms")
res["raw_latency_ms"] = [round(x, 3) for x in lat]

# ---- 5. fault injection: glove stops sending while a button is held -------------
rel = []
for trial in range(10):
    src = Src()
    dev = FakeDev()
    ac3 = AirCursor(src, device_factory=lambda d=dev: d)
    ac3.enable()
    time.sleep(0.1)
    for _ in range(40):                    # hold the primary finger bent -> left button down
        src.push(frame(flex=(0, 400)))
        time.sleep(0.02)
    held = any(code == 272 and val == 1 for _, _, code, val in dev.events)
    t_stop = time.perf_counter()           # glove goes silent
    t_up = None
    while time.perf_counter() - t_stop < 2.0:
        if any(code == 272 and val == 0 for _, _, code, val in dev.events):
            t_up = time.perf_counter()
            break
        time.sleep(0.002)
    ac3.disable()
    if held and t_up:
        rel.append((t_up - t_stop) * 1000.0)
res["fault_glove_silent_to_button_release"] = stats(rel, "ms")
res["raw_release_ms"] = [round(x, 2) for x in rel]

# ---- 5b. per-node cost inside AirCursor.process (the CDFG node table) ----------
ac4 = AirCursor(Src(), device_factory=lambda: FakeDev())
ac4._dev = FakeDev()
fr = frame(gyro=(0, -40, 10), flex=(0, 300), accel=(0.05, 0.9, 0.3))
nodes = {}
nodes["N1 flex hysteresis x2"] = timeit_us(lambda: (ac4._prim.update(300.0, 100, "above", 20.0), ac4._sec.update(0.0, 100, "above", 20.0)), 20000)
nodes["N2 pose: gravity + bias + rates"] = timeit_us(lambda: ac4.pose(fr, 0.02), 20000)
pz = ac4.pose(fr, 0.02)
nodes["N3 clutch update"] = timeit_us(lambda: ac4._update_clutch(pz["pitch"]), 20000)
nodes["N4 palm zone (nearest pose / roll)"] = timeit_us(lambda: ac4._update_zone(pz["u"], pz["roll"]), 20000)
nodes["N5 finger state machine"] = timeit_us(lambda: ac4._fingers(False, True, 100.0), 20000)
nodes["N6 rate shaping x2"] = timeit_us(lambda: (ac4._shape(pz["right"]), ac4._shape(pz["up"])), 20000)
res["aircursor_nodes_us"] = {k: stats(v, "us") for k, v in nodes.items()}

# ---- 6. gyro bias from the still recording --------------------------------------
rows = [json.loads(l) for l in open("../docs/calibration/gyro_still.jsonl")]
g = np.array([r["gyro"] for r in rows])
a = np.array([r["accel"] for r in rows])
res["gyro_still_recording"] = {
    "n": len(rows), "unit": "deg/s",
    "mean": [round(float(x), 3) for x in g.mean(0)], "std": [round(float(x), 3) for x in g.std(0)],
    "accel_norm_mean_g": round(float(np.linalg.norm(a, axis=1).mean()), 4),
    "accel_norm_std_g": round(float(np.linalg.norm(a, axis=1).std()), 4),
}

Path("../docs/measurements/results.json").write_text(json.dumps(res, indent=2))
for k, v in res.items():
    print(k, v)
