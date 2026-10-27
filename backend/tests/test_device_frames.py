import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import device
from app.serial_manager import serial_manager


def push(n, start=0):
    for i in range(n):
        serial_manager._record_frame({"flex": [start + i, 0, 0, 0, 0], "accel": [0.0, 0.0, 1.0],
                                      "gyro": [1.0, 2.0, 3.0], "mag": [0.0, 0.0, 0.0]})


def test_frames_since_returns_only_new_frames_in_order():
    serial_manager.frames.clear()
    serial_manager.frames_total = 0
    push(5)
    first = device.device_frames(since=0)
    assert first["total"] == 5 and [f["flex_0"] for f in first["frames"]] == [0, 1, 2, 3, 4]
    push(3, start=100)
    second = device.device_frames(since=first["total"])
    assert [f["flex_0"] for f in second["frames"]] == [100, 101, 102]
    assert device.device_frames(since=second["total"])["frames"] == []


def test_counter_reset_returns_a_few_newest():
    serial_manager.frames.clear()
    serial_manager.frames_total = 0
    push(10)
    r = device.device_frames(since=9999)
    assert 0 < len(r["frames"]) <= 5 and r["frames"][-1]["flex_0"] == 9
