# ESP32 Monitor

The **ESP Monitor** tab in the Glove Trainer UI is a full control panel for the
glove's ESP32: serial logs, live sensor data, WiFi/chip status, firmware code
editing, and one-click flashing.

## Run it

```bash
cd ~/Development/data-glove
./run-monitor.sh
```

Then open <http://localhost:3000> → **ESP Monitor** tab.

- Backend API: <http://localhost:8000> (docs at `/docs`)
- Frontend: <http://localhost:3000>

### Manual start

```bash
# backend
cd backend
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt requests pyserial
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# frontend (separate shell)
cd frontend && npm start
```

## What the tab does

| Section | Purpose |
|---|---|
| **Connection bar** | Pick port + baud, Open/Close, Reset, Bootloader, Flash |
| **Status strip** | Chip, reset reason, WiFi SSID/state/IP, bytes, frames |
| **Serial Logs** | Live boot + firmware output (SSE stream), send lines to the device |
| **Sensors** | Flex bars (F0–F4) and IMU x/y/z, parsed from binary frames |
| **Firmware Code** | List/read/edit/scaffold files under `firmware/` |
| **Flash Output** | Live `arduino-cli compile` + `upload` output |

## Data paths

There are **two** ways sensor data can reach the host. The monitor supports both:

1. **USB serial (implemented).** The ESP32 writes the 58-byte packet —
   `5×uint16 LE flex` + `9×float32 LE` (accel xyz, gyro xyz, mag xyz) — and the
   monitor parses it tolerantly alongside text log lines.
2. **WiFi → sensor-lab (existing).** The stock firmware connects to the `vivo`
   hotspot and posts JSON to the Go `sensor-lab` server; the backend `bridge`
   polls that. See `backend/app/bridge.py`.

## Backend API (`/api/device/*`)

| Method | Path | Description |
|---|---|---|
| GET | `/device/status` | Connection, ports, WiFi, chip, latest frame |
| GET | `/device/ports` | Enumerate serial ports |
| GET | `/device/logs?since=` | Recent log lines (poll) |
| GET | `/device/logs/stream` | SSE live log + frame stream |
| GET | `/device/sensors?limit=` | Latest frame + history |
| POST | `/device/open` | `{port, baud}` |
| POST | `/device/close` | Close port |
| POST | `/device/reset` | `{bootloader: bool}` |
| POST | `/device/send` | `{text}` — write a line |
| GET | `/device/code` | List firmware files |
| GET | `/device/code/{path}` | Read a file |
| PUT | `/device/code` | `{filename, content}` |
| POST | `/device/code/new` | Scaffold the template sketch |
| POST | `/device/flash` | Compile + upload via arduino-cli |
| GET | `/device/flash/stream` | SSE flash output |

## Firmware requirement

For the **Sensors** tab to show live values, the ESP32 firmware must emit the
binary packet over serial. The scaffolded template (`firmware/glove_esp32/`)
does this:

```cpp
uint16_t flex[5];
for (int i = 0; i < 5; i++) flex[i] = analogRead(32 + i);
float imu[9] = {0};
Serial.write((uint8_t*)flex, sizeof(flex));
Serial.write((uint8_t*)imu, sizeof(imu));
```

Edit it in the **Firmware Code** tab, then hit **Flash Firmware**.

## Notes

- The stock firmware on the board only prints `Connecting to vivo...` and sends
  data over WiFi — it does **not** emit serial frames. Flash the template (or add
  `Serial.write` to your sketch) to use the Sensors tab over USB.
- Opening the port does **not** reset the board. Use the **Reset** button when you
  want a fresh boot log.
- `arduino-cli` must have the ESP32 core (`arduino-cli core list` → `esp32:esp32`).
