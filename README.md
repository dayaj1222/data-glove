# Data Glove

A wearable input glove: an ESP-32 reads two flex sensors (thumb, index) and an MPU-6500 IMU at 50 Hz and streams
them to a Linux PC over USB serial. The PC turns the data into a live 3D hand, games, a recogniser, and a real
desktop mouse (cursor, clicks, scroll, window drag) through uinput.

## Run the demo

```bash
./run-demo.sh            # starts everything, connects the glove, opens http://localhost:8000/#blocks
./run-demo.sh hand3d     # open another tab (device gestures actions record train predict arcade sniper puzzle airmouse hand3d blocks)
./run-demo.sh --check    # run the test suite first
./run-demo.sh stop       # stop everything
```

The script clears stale servers, builds the web UI if it is out of date, starts one backend that also serves the UI,
resets the glove into run mode, waits for sensor frames and opens the browser. If the backend dies it is restarted.
Plug the glove in before or after starting; the backend keeps looking for it. Logs are in `.run/`.

First run needs `backend/.venv` (Python 3.12, `pip install -r backend/requirements.txt`) and `npm`.

## What is in the UI

| Tab | What it does |
|---|---|
| ESP Monitor | serial logs, raw sensor bars, flash firmware |
| Hand 3D | live 3D hand: tilt and roll from the IMU, thumb and index curl from the flex sensors |
| Blocks 3D | stack blocks into a tower with the glove: turn = left/right, pitch = depth, wrist twist = height, pinch = grab |
| Air Mouse | desktop mouse from 3 palm positions x 3 finger gestures (see below) |
| Sniper, Puzzle | pointing games |
| Record, Train, Predict | gesture recording and a RandomForest recogniser |

### Air mouse
Do the Setup block first (3 palm poses, fingers straight and bent), then Enable.

| | A alone | B alone | A + B |
|---|---|---|---|
| palm down | left click / drag | right click | scroll |
| palm sideways | drag window (Super+left) | resize window (Super+right) | middle click |
| palm up | back | forward | Escape |

Pointing the finger down freezes the cursor and releases every button; a glove that goes silent does the same.

## Hardware

ESP-32 DevKit; flex sensors on GPIO34 (flex_0, thumb) and GPIO35 (flex_1, index), each in a divider with 10 kOhm to GND;
MPU-6500 on I2C (SDA GPIO21, SCL GPIO22). Firmware: `firmware/glove_full/glove_full.ino`
(`arduino-cli compile/upload --fqbn esp32:esp32:esp32`). The MPU-6500 has no magnetometer, so heading is gyro-only.

## Development

```bash
cd backend && .venv/bin/python -m pytest tests -q      # backend tests
cd frontend && node tools/check_block_world.mjs        # block physics scenarios
cd frontend && npm start                               # dev server on :3000 (proxy to :8000)
```

Project notes, findings and open problems are in `AGENTS.md`.
