# Data Glove — Session Findings

> Last updated: 2026-10-16
> Continue from here next session.

## Hardware reality (important)

| Component | Actual part | Notes |
|---|---|---|
| IMU | **MPU-6500** (NOT MPU-9250) | `WHO_AM_I = 0x70`. 6-axis. **No magnetometer.** |
| Flex sensor | 1x, on **D34** | Range measured 20 (curled) → 1000 (flat). Don't flex further. |
| MCU | ESP32 DevKit, CP210x USB bridge | Enumerates as `/dev/ttyUSB0` or `ttyUSB1` — check after every reset. |

**The docs (`report.md`, `report.tex`) claim MPU-9250 9-axis. That is wrong.** Correct before submission.

Verified: 117/117 clean reads of `0x70`, zero responses ever at `0x0C` (AK8963 mag address). No register setting can enable a magnetometer that isn't on the die.

## Sensor capability — what is and isn't possible

| Quantity | Sensor | Status |
|---|---|---|
| Pitch / roll (orientation) | Accel | ✅ absolute, drift-free |
| Yaw **angle** | Gyro Z integrated | ⚠️ drifts ~10°/min. Needs mag to fix. **Unfixable.** |
| Yaw **rate** | Gyro Z | ✅ accurate — keep as feature |
| Rotation magnitude | Gyro | ✅ |
| Tilt / gravity | Accel | ✅ |
| Linear acceleration | Accel (minus gravity) | ✅ brief only |
| **Position in 3D** | — | ❌ **impossible.** Double-integration drift. No absolute reference exists. |
| Absolute heading | — | ❌ needs magnetometer |

**Key rule:** accel = orientation. gyro = motion rate. mag = compass (absent).

### Dead reckoning is not viable
Integrating accel → velocity → position drifts quadratically. With 0.005 m/s² noise: 1cm error at 2s, 25cm at 10s, 2.25m at 30s. 1mg of bias → 18m/min. This is why phones use GPS and VR uses cameras. Not a limitation of our chip — physics.

### Yaw strategy decided
- **Keep gyro Z as a raw feature** (twist gestures work fine).
- **Drop yaw *angle*** — never claim it's a compass.
- **Zeroing works** but must be gated correctly. See below.
- Auto-zero on stillness alone **is broken** — a hand at your side is also "still", so it silently re-zeros.
- **Fix:** zero only when `still AND level` (use accel pitch/roll to confirm reference pose). Hand at side is tilted → won't trigger. Options discussed: (A) still+level gate ✅ recommended, (B) manual button, (C) double-tap pattern.
- **TODO next session:** user has ideas for this; implement the gate.

## Wire protocol

**Firmware `glove_full.ino` emits:**
```
[0xAA 0x55] [5 x uint16 LE flex] [9 x float32 LE accel/gyro/mag]   = 48 bytes
```
The 2-byte magic header is **essential** — without it the parser drifts and misaligns. Backend scans for `0xAA 0x55` and resyncs byte-by-byte on garbage.

## Gyro calibration (done)

Measured over 299 still samples (5 min), 2026-10-16:
```
X = -5.101 dps  (std 0.181)
Y = +7.412 dps  (std 0.224)
Z = -0.495 dps  (std 0.145)
accel baseline: [-0.1366, -0.2019, -0.9363] g  (|a| = 0.966)
```
Raw data: `docs/calibration/gyro_still.jsonl`

Firmware hardcodes these AND re-measures at boot if held still 2s (`calibrateGyro()`). Result: drift went from ±7 dps → ±0.5 dps (~15x better).

## Architecture (after refactor)

Phone bridge **removed entirely**. ESP32 is the only data source.

```
backend/app/
├── device/framing.py      # NEW — pure framing, no I/O, unit-tested
├── serial_manager.py      # port lifecycle + buffers only (was 431 lines, now ~305)
└── routers/device.py      # + GET /api/device/frame  (flat frame for pipeline)

frontend/src/
├── hooks/useEspFrame.js   # NEW — shared polling, used by Record + Predict
└── components/            # RecordingUI + PredictUI now use the hook
```

`/api/device/frame` returns `{connected, frame}` where frame is flat:
`{flex_0..4, accel_x/y/z, gyro_x/y/z, mag_x/y/z, timestamp}`

## Tests

`backend/tests/test_framing.py` — **18 passing.** Run:
```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```
They caught 3 real bugs during extraction: text before a frame marker was discarded; long text lines byte-dropped; trailing text lost on flush.

## Gotchas learned the hard way

1. **BOOT + EN together = download mode.** Board stops running firmware. Only do this to flash. **EN alone** = normal reset.
2. **Two backends on one serial port** = silent zero frames. Always `fuser /dev/ttyUSB1` if data looks dead.
3. **`pkill -f uvicorn` kills your own shell** (exit 143) when run from inside the agent. Kill by explicit PID instead.
4. **`/dev/ttyUSB0` vs `ttyUSB1`** changes after re-enumeration. Backend's port must be reopened with the right path.
5. **Port must be closed** before flashing, reopen after.
6. The venv has no `pip` — use `uv pip install --python .venv/bin/python`.
7. MPU needs ~2s settle after cold boot before I²C reads succeed; firmware retries every 2s.

## What works right now

- Board: `glove_full.ino` flashed, IMU `0x70` detected, gyro calibrated, streaming.
- Backend :8000, frontend :3000. `/api/device/frame` live with real accel/gyro.
- Tests 18/18. Frontend builds clean.

## Next session

- [ ] Implement yaw zeroing with **still + level gate** (user has additional ideas)
- [ ] Add complementary filter for stable pitch/roll; emit `pitch, roll, yaw_rate` as features
- [ ] Decide final gesture set — **no two gestures may differ only by absolute heading**
- [ ] Reconnect flex sensor to D34 and re-verify 20→1000 range
- [ ] Correct `report.md` / `report.tex`: MPU-9250 → MPU-6500, remove mag claims
- [ ] Solder the IMU wires — breadboard contact was the source of hours of grief
