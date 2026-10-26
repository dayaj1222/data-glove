# Data Glove — Session Findings

> Last updated: 2026-10-27
> Continue from here next session. Section "Session 2026-10-26/27" is the newest and lists open problems first.

## Hardware reality (important)

| Component | Actual part | Notes |
|---|---|---|
| IMU | **MPU-6500** (NOT MPU-9250) | `WHO_AM_I = 0x70`. 6-axis. **No magnetometer.** |
| Flex sensors | **2x**, on **D34** (`flex_0`) and **D35** (`flex_1`) | Each is a divider: 3V3 – flex – pin – resistor – GND. Reads ~50–300 when straight, rises when bent (old note said 20→1000, now outdated). **White side up is the active side on this sensor** (black side did nothing). |
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

## Session 2026-10-26/27 — what changed and what is OPEN

### OPEN PROBLEMS (fix these first)
1. **ESP32 dies / USB drops intermittently.** Seen: kernel `over-current condition` on all USB ports, repeated `cp210x ... disconnected`, and once the UART line stuck low (8685 bytes of `0x00` in 4 s, no boot text) = board not running. Cause is **wiring on the 3V3 rail** (IMU was once connected reversed and got hot; wires are bare, no breadboard, 3V3 junction shared by IMU + 2 flex dividers). Procedure that worked: unplug everything except USB, confirm board boots alone, add IMU, then flex 1, then flex 2, watching `journalctl -k | grep -i over-current`. **Solder the joints / insulate the 3V3 junction.** Software cannot fix this.
2. **Flex readings are noisy/floating when a divider joint is loose.** Floating pins swing 0↔4095. Needs a firm 10k resistor to GND at each pin; a larger resistor (22k–47k) would widen the 0–300 range. Not yet tried.
3. **Air mouse and both games are untested with the real glove.** Directions (invert toggles), roll/clutch angles, flex thresholds all need tuning on hardware.
4. **Nothing from this session is committed.** `frontend/src/components/{SniperUI,PuzzleUI,AirMouseUI}.js`, `frontend/src/lib/`, `backend/app/aircursor.py`, `backend/app/routers/cursor.py`, `backend/tests/test_aircursor.py` are untracked/modified. Review `git status`, then commit.
5. `firmware/glove_full/glove_full.ino` shows as modified but was edited by the user (2 flex D34+D35, median-of-N ADC, I2C retry); not changed by the assistant.

### Gotchas added this session
- **Stale backend processes.** `kill $(ss -ltnp | grep :8000 ...)` only kills the listener; an older uvicorn kept holding `/dev/ttyUSB0` and the two fought, producing an endless `[host] reconnected` loop (200 log lines in 3 s) and frozen frame counts. **Always `fuser -v /dev/ttyUSB*` and kill the extra PID.** Start the backend with `setsid nohup .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` (no `--reload`, so code changes need a restart).
- **Port renumbering.** After any USB glitch the board returns as `ttyUSB0` or `ttyUSB1`. The backend now (a) swaps a missing port for whichever `ttyUSB*/ttyACM*` exists in `SerialManager.open()` and (b) the reader thread keeps retrying/reconnecting (`_reconnect`). The ESP Monitor UI used to hard-code `/dev/ttyUSB0`; `/api/device/ports` now returns the real default.
- **Board stops streaming after re-plug** until reset: `POST /api/device/reset {"bootloader": false}`.
- **uinput works without sudo** here (`/dev/uinput` is `root:wheel 0660`, user is in `wheel`). `evdev==2.0.0` installed in the venv and added to `requirements.txt`.
- Chrome ignores F1; sniper fires on Space/Enter/click.

### Pointing maths (frontend `lib/pointer.js`, backend `aircursor.py` — same formulas)
Board mounting for pointing: **+X along the index finger (at the screen), +Y up, +Z to the user's right.**
```
u = unit accel vector (board frame, points up at rest), w = gyro (deg/s, bias removed)
pitch (absolute)  = asin(u_x)                      # finger elevation, drift-free
roll  (absolute)  = atan2(u_z, u_y)                # wrist twist about finger, drift-free
pitch rate (up)   = (w_z*u_y - w_y*u_z) / cos(pitch)
yaw rate (right)  = -(w_y*u_y + w_z*u_z) / (1 - u_x^2)
```
Rolling about the finger moves neither rate. Yaw **angle** is gyro-only and drifts; the games integrate it and offer Recenter (`C`); the air mouse avoids it entirely by using rates (relative, like a mouse). Gyro bias is learned online while still (<4 deg/s). The old sniper code used `-gyro` for pitch, which was a sign bug (fused gyro fought accel). Signs are derived from physics, **not yet verified on hardware**; every UI has Invert H/V toggles.

### Games (frontend tabs)
- **Sniper** (`SniperUI.js`): aim = finger pitch/yaw, fire = flex bend / Space / click. Rewrote graphics (dusk scene, parallax layers, posts/shadows, particles, mil-dot reticle). Uniform px-per-degree on both axes.
- **Puzzle** (`PuzzleUI.js`): procedural pictures cut into jigsaw pieces (3 scenes, 6/9/16 pieces), grab = flex bend or hold Space, drop near slot to snap.
- **Air Mouse** (`AirMouseUI.js` + backend `aircursor.py`, API under `/api/cursor`): relative real desktop cursor via uinput on **Hyprland 0.56 (lua config)**. Hyprland binds used: `SUPER + mouse:272` drag window, `SUPER + mouse:273` resize.

### Air mouse control scheme (final design: 3 palm zones x 3 finger gestures = 9)
Zone = hand pose from gravity (drift-free); gesture = finger A (`flex_1`, primary), B (`flex_0`, secondary), or A+B.
| | A alone | B alone | A + B |
|---|---|---|---|
| palm DOWN | left click/drag | right click | scroll (finger up/down, cursor frozen) |
| palm SIDEWAYS (left) | drag window (Super+left) | resize window (Super+right) | middle click |
| palm UP | back (Alt+Left) | forward (Alt+Right) | Escape |
Every cell is remappable (`down_a` … `up_ab`, actions in `ACTIONS` in `aircursor.py`). Zone is **locked while a gesture is held**; a second finger joining late is ignored; a bend shorter than `chord_ms` (120) is delivered as a tap; clutch = finger pitched below `-clutch_pitch` (40°) freezes + releases everything; cursor holds still `stabilize_ms` (180) after a press. Safety: all buttons/mod key released on disable, stale frames (>0.5 s), thread death, `atexit`.
**Calibration (do this before Enable; endpoints under `/api/cursor`):**
- `POST /calibrate/{down|side|up}` — hold the pose still; stores the gravity direction in `backend/aircursor_calibration.json` (gitignored). Zone = nearest captured pose (10° switch margin). Without it the zone falls back to |roll| thresholds `roll_side`/`roll_up`, which assumed a mounting that did NOT match the user's glove (zones came out wrong).
- `POST /fingers/straight` then `/fingers/bent` — sets each finger's threshold (midpoint), mode (above/below) and hysteresis margin (20% of the gap). Default threshold 100 sat inside the sensor's resting noise (50–340), and hysteresis (was 30) made 115 "not above 100" — this is why A+B never triggered.
- The Air Mouse tab has a Setup block with buttons for all of the above.

### Frame bursts (important)
USB-serial delivers ~5 frames at once, ~10 times/s. Code that looks only at `latest_frame` sees ~10 Hz. `AirCursor._new_frames()` reads every new frame from `serial_manager.frames` using `frames_total`; use it (or the deque) for anything time-sensitive.

### Tests
`cd backend && .venv/bin/python -m pytest tests/ -q` → **41 passing** (18 framing + 23 aircursor). Frontend: `cd frontend && CI=false BUILD_PATH=<tmp> npx react-scripts build` compiles with no warnings.

### Next steps (ordered)
- [ ] Fix the hardware power fault (item 1 above) and solder; confirm no over-current for 10+ min.
- [ ] On hardware: run the Setup block (3 palm poses, fingers straight/bent), then verify cursor/pitch/yaw directions and the 9 gestures; tune `clutch_pitch`/`chord_ms`. Not yet validated with a real hand after the calibration redesign.
- [ ] Try a larger divider resistor (22k/47k) for a wider flex range; consider per-finger min/max calibration in software.
- [ ] Optional: stable udev name (`/dev/glove`) for the CP2102 so port numbers never matter.
- [ ] Commit the untracked work after a review.
- [ ] Earlier TODOs still open: yaw zero gate (still AND level), complementary-filter feature export, final gesture set, solder IMU, fix report docs if any MPU-9250 mentions remain.

## Next session (older list, 2026-10-16)

- [ ] Implement yaw zeroing with **still + level gate** (user has additional ideas)
- [ ] Add complementary filter for stable pitch/roll; emit `pitch, roll, yaw_rate` as features
- [ ] Decide final gesture set — **no two gestures may differ only by absolute heading**
- [ ] Reconnect flex sensor to D34 and re-verify 20→1000 range
- [ ] Correct `report.md` / `report.tex`: MPU-9250 → MPU-6500, remove mag claims
- [ ] Solder the IMU wires — breadboard contact was the source of hours of grief
