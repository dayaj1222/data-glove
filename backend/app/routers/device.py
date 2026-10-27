"""Device router: ESP32 monitoring + control over USB serial.

Endpoints:
  GET  /api/device/status        -> connection, ports, wifi, chip, latest frame
  GET  /api/device/logs          -> recent log lines (polling fallback)
  GET  /api/device/logs/stream   -> Server-Sent Events live log stream
  GET  /api/device/sensors       -> latest parsed sensor frame + history
  POST /api/device/open          -> open a port at a baud
  POST /api/device/close         -> close the port
  POST /api/device/reset         -> reset (optionally into bootloader)
  POST /api/device/send          -> write a line to the device
  GET  /api/device/code          -> list firmware files + read one
  PUT  /api/device/code          -> write a firmware file
  POST /api/device/flash         -> compile + upload with arduino-cli
  GET  /api/device/flash/stream  -> SSE stream of a flash in progress
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..serial_manager import serial_manager, DEFAULT_BAUD, DEFAULT_PORT, find_usb_port

router = APIRouter()

# Where firmware sketches live. Created on demand.
FIRMWARE_DIR = Path(__file__).resolve().parents[3] / "firmware"
FIRMWARE_DIR.mkdir(exist_ok=True)
SKETCH_NAME = "glove_esp32"


class OpenRequest(BaseModel):
    port: Optional[str] = None
    baud: int = DEFAULT_BAUD


class ResetRequest(BaseModel):
    bootloader: bool = False


class SendRequest(BaseModel):
    text: str


class CodeWrite(BaseModel):
    filename: str
    content: str


class FlashRequest(BaseModel):
    fqbn: str = "esp32:esp32:esp32"
    port: Optional[str] = None
    sketch: Optional[str] = None


@router.get("/device/status")
def device_status() -> Dict[str, Any]:
    st = serial_manager.state()
    st["chip"] = serial_manager.chip_info()
    st["firmware_dir"] = str(FIRMWARE_DIR)
    return st


@router.get("/device/ports")
def device_ports() -> Dict[str, Any]:
    return {"ports": serial_manager.list_ports(), "default": find_usb_port(DEFAULT_PORT) or DEFAULT_PORT}


@router.get("/device/logs")
def device_logs(since: float = 0.0, limit: int = 400) -> Dict[str, Any]:
    logs = [e for e in serial_manager.state()["log_tail"] if e["t"] > since]
    return {"logs": logs[-limit:]}


@router.get("/device/frame")
def device_frame() -> Dict[str, Any]:
    """Latest ESP frame in the training pipeline's frame shape.

    The trainer/predictor consume flat frames with flex_N / accel_X / gyro_X /
    mag_X keys. This adapts the ESP binary frame to that shape so the glove
    can feed Record and Predict directly, with no phone in the loop.
    """
    f = serial_manager.latest_frame
    if f is None:
        return {"connected": serial_manager.is_open, "frame": None}

    flex = list(f.get("flex") or [0] * 5)
    accel = list(f.get("accel") or [0.0] * 3)
    gyro = list(f.get("gyro") or [0.0] * 3)
    mag = list(f.get("mag") or [0.0] * 3)

    frame: Dict[str, float] = {}
    for i in range(5):
        frame[f"flex_{i}"] = float(flex[i]) if i < len(flex) else 0.0
    for i, ax in enumerate(("x", "y", "z")):
        frame[f"accel_{ax}"] = float(accel[i]) if i < len(accel) else 0.0
        frame[f"gyro_{ax}"] = float(gyro[i]) if i < len(gyro) else 0.0
        frame[f"mag_{ax}"] = float(mag[i]) if i < len(mag) else 0.0
    frame["timestamp"] = float(f.get("timestamp") or 0.0)

    return {"connected": serial_manager.is_open, "frame": frame}


def _flat(f: Dict[str, Any]) -> Dict[str, float]:
    flex = list(f.get("flex") or [0] * 5)
    accel = list(f.get("accel") or [0.0] * 3)
    gyro = list(f.get("gyro") or [0.0] * 3)
    out: Dict[str, float] = {}
    for i in range(5):
        out[f"flex_{i}"] = float(flex[i]) if i < len(flex) else 0.0
    for i, ax in enumerate(("x", "y", "z")):
        out[f"accel_{ax}"] = float(accel[i]) if i < len(accel) else 0.0
        out[f"gyro_{ax}"] = float(gyro[i]) if i < len(gyro) else 0.0
    return out


@router.get("/device/frames")
def device_frames(since: int = 0, limit: int = 200) -> Dict[str, Any]:
    """Every frame received after counter `since`, oldest first, plus the new counter.

    Frames arrive in bursts, so polling only the latest one drops most of them; a
    consumer that integrates the gyro (the 3D hand view) needs all of them. Pass
    back the returned `total` as `since` on the next call. If the counter went
    backwards (port reopened) the newest few frames are returned.
    """
    total = serial_manager.frames_total
    buf = list(serial_manager.frames)
    if since > total:
        n = min(len(buf), 5)
    else:
        n = min(total - since, len(buf), max(1, limit))
    frames = [_flat(f) for f in buf[-n:]] if n > 0 else []
    return {"connected": serial_manager.is_open, "total": total, "frames": frames}


@router.get("/device/sensors")
def device_sensors(limit: int = 200) -> Dict[str, Any]:
    frames = list(serial_manager.frames)[-limit:]
    return {
        "latest": serial_manager.latest_frame,
        "frames": frames,
        "count": len(frames),
        "wifi": serial_manager.detect_wifi(),
    }


@router.post("/device/open")
def device_open(req: OpenRequest) -> Dict[str, Any]:
    ok = serial_manager.open(req.port, req.baud)
    if not ok:
        raise HTTPException(400, f"Could not open port: {serial_manager.last_error}")
    return {"ok": True, "port": serial_manager.port, "baud": serial_manager.baud}


@router.post("/device/close")
def device_close() -> Dict[str, Any]:
    serial_manager.close()
    return {"ok": True}


@router.post("/device/reset")
def device_reset(req: ResetRequest) -> Dict[str, Any]:
    if not serial_manager.is_open:
        serial_manager.open(None, DEFAULT_BAUD)
    ok = serial_manager.reset(bootloader=req.bootloader)
    return {"ok": ok, "bootloader": req.bootloader}


@router.post("/device/send")
def device_send(req: SendRequest) -> Dict[str, Any]:
    ok = serial_manager.send_line(req.text)
    if not ok:
        raise HTTPException(400, "Device not open")
    return {"ok": True}


@router.get("/device/logs/stream")
async def device_logs_stream(request: Request) -> StreamingResponse:
    """SSE stream: pushes new log lines and sensor snapshots as they arrive."""

    async def gen():
        # Start at the CURRENT end of the buffer. Replaying all history to every
        # new client flooded the browser with thousands of events at 30 Hz.
        last_seq = serial_manager.log_lines[-1]["seq"] if serial_manager.log_lines else 0
        yield ": connected\n\n"
        while True:
            if await request.is_disconnected():
                break
            batch = [e for e in list(serial_manager.log_lines) if e["seq"] > last_seq]
            if batch:
                last_seq = batch[-1]["seq"]
                # One SSE event carrying the batch, instead of N events.
                yield f"event: log\ndata: {json.dumps(batch)}\n\n"
            if serial_manager.latest_frame is not None:
                payload = json.dumps(serial_manager.latest_frame)
                yield f"event: frame\ndata: {payload}\n\n"
            await asyncio.sleep(0.1)  # 10 Hz is plenty for text logs

    return StreamingResponse(gen(), media_type="text/event-stream")


# --------------------------------------------------------------------- code
@router.get("/device/code")
def device_code_list() -> Dict[str, Any]:
    files: List[Dict[str, Any]] = []
    for p in sorted(FIRMWARE_DIR.rglob("*")):
        if p.is_file():
            files.append({
                "path": str(p.relative_to(FIRMWARE_DIR)),
                "size": p.stat().st_size,
            })
    return {"dir": str(FIRMWARE_DIR), "files": files, "sketch": SKETCH_NAME}


@router.get("/device/code/{filename:path}")
def device_code_read(filename: str) -> Dict[str, Any]:
    p = _safe_firmware_path(filename)
    if not p.exists():
        raise HTTPException(404, f"Not found: {filename}")
    return {"path": filename, "content": p.read_text(errors="replace")}


@router.put("/device/code")
def device_code_write(req: CodeWrite) -> Dict[str, Any]:
    p = _safe_firmware_path(req.filename)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(req.content)
    return {"ok": True, "path": req.filename, "size": p.stat().st_size}


@router.post("/device/code/new")
def device_code_new() -> Dict[str, Any]:
    """Scaffold a minimal ESP32 sketch that streams flex+IMU frames."""
    sketch_dir = FIRMWARE_DIR / SKETCH_NAME
    sketch_dir.mkdir(parents=True, exist_ok=True)
    ino = sketch_dir / f"{SKETCH_NAME}.ino"
    if not ino.exists():
        ino.write_text(TEMPLATE_SKETCH)
    return {"ok": True, "path": str(ino.relative_to(FIRMWARE_DIR))}


def _safe_firmware_path(filename: str) -> Path:
    p = (FIRMWARE_DIR / filename).resolve()
    if not str(p).startswith(str(FIRMWARE_DIR.resolve())):
        raise HTTPException(400, "Path escapes firmware directory")
    return p


# --------------------------------------------------------------------- flash
_flash_state: Dict[str, Any] = {"running": False, "log": [], "ok": None}
_flash_lock = threading.Lock()


@router.post("/device/flash")
def device_flash(req: FlashRequest) -> Dict[str, Any]:
    """Compile + upload the firmware sketch using arduino-cli."""
    with _flash_lock:
        if _flash_state["running"]:
            raise HTTPException(409, "A flash is already running")
    sketch_dir = FIRMWARE_DIR / (req.sketch or SKETCH_NAME)
    if not sketch_dir.exists():
        raise HTTPException(404, f"Sketch not found: {sketch_dir}")
    port = req.port or serial_manager.port or DEFAULT_PORT

    serial_manager.close()
    _flash_state.update({"running": True, "log": [], "ok": None})

    def run() -> None:
        def emit(line: str) -> None:
            with _flash_lock:
                _flash_state["log"].append(line)
        try:
            emit(f"$ arduino-cli compile --fqbn {req.fqbn} {sketch_dir}")
            c = subprocess.run(
                ["arduino-cli", "compile", "--fqbn", req.fqbn, str(sketch_dir)],
                capture_output=True, text=True, timeout=600,
            )
            for line in (c.stdout + c.stderr).splitlines():
                emit(line)
            if c.returncode != 0:
                emit(f"[compile failed: exit {c.returncode}]")
                with _flash_lock:
                    _flash_state["ok"] = False
                return
            emit("$ arduino-cli upload -p %s --fqbn %s %s" % (port, req.fqbn, sketch_dir))
            u = subprocess.run(
                ["arduino-cli", "upload", "-p", port, "--fqbn", req.fqbn, str(sketch_dir)],
                capture_output=True, text=True, timeout=300,
            )
            for line in (u.stdout + u.stderr).splitlines():
                emit(line)
            with _flash_lock:
                _flash_state["ok"] = (u.returncode == 0)
            emit("[done]" if u.returncode == 0 else f"[upload failed: exit {u.returncode}]")
        except Exception as e:  # noqa: BLE001
            emit(f"[error] {e}")
            with _flash_lock:
                _flash_state["ok"] = False
        finally:
            with _flash_lock:
                _flash_state["running"] = False

    threading.Thread(target=run, daemon=True, name="flash").start()
    return {"ok": True, "started": True, "port": port, "sketch": str(sketch_dir)}


@router.get("/device/flash/stream")
async def device_flash_stream(request: Request) -> StreamingResponse:
    async def gen():
        sent = 0
        yield ": connected\n\n"
        while True:
            if await request.is_disconnected():
                break
            with _flash_lock:
                log = list(_flash_state["log"])
                running = _flash_state["running"]
                ok = _flash_state["ok"]
            while sent < len(log):
                yield f"data: {json.dumps({'line': log[sent]})}\n\n"
                sent += 1
            if not running:
                yield f"event: done\ndata: {json.dumps({'ok': ok})}\n\n"
                break
            await asyncio.sleep(0.3)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/device/flash/status")
def device_flash_status() -> Dict[str, Any]:
    with _flash_lock:
        return {
            "running": _flash_state["running"],
            "ok": _flash_state["ok"],
            "log": list(_flash_state["log"])[-200:],
        }


TEMPLATE_SKETCH = r"""// glove_esp32 - stream 5 flex + IMU frames over USB serial.
// Frame: 5x uint16 LE flex, then 9x float32 LE (accel xyz, gyro xyz, mag xyz).
#include <WiFi.h>

static const char* WIFI_SSID = "vivo";
static const char* WIFI_PASS = "";

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("glove_esp32 booting");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting to %s...\n", WIFI_SSID);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    static bool told = false;
    if (!told) {
      Serial.print("WiFi connected, IP: ");
      Serial.println(WiFi.localIP());
      told = true;
    }
  }

  uint16_t flex[5];
  for (int i = 0; i < 5; i++) flex[i] = analogRead(32 + i);
  float imu[9] = {0};

  Serial.write((uint8_t*)flex, sizeof(flex));
  Serial.write((uint8_t*)imu, sizeof(imu));
  delay(20);
}
"""
