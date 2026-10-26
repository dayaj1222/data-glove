"""Serial manager: owns the ESP32 USB-UART port and its reader thread.

Byte-level framing and parsing live in `device.framing`; this module is
concerned only with port lifecycle, threading, and the bounded buffers the
API serves. If the device is absent or unplugged the API must not crash.

Runs one background reader thread per open port.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

from .device.framing import FrameDecoder, PAYLOAD_SIZE, parse_binary_frame, parse_text_frame

DEFAULT_PORT = "/dev/ttyUSB0"
DEFAULT_BAUD = 115200
# Kept for backwards compatibility with callers that reference it.
SIMPLE_FRAME_SIZE = PAYLOAD_SIZE


def find_usb_port(preferred: Optional[str] = None) -> Optional[str]:
    """`preferred` if it exists, else the first ttyUSB*/ttyACM* device, else None.

    The CP210x re-enumerates as ttyUSB0 or ttyUSB1, so a fixed path goes stale.
    """
    import glob
    found = sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))
    if preferred in found:
        return preferred
    return found[0] if found else None


class SerialManager:
    """Owns the serial port and the background reader thread."""

    def __init__(self, max_log_lines: int = 2000, max_frames: int = 1000) -> None:
        # Monotonic per-entry sequence. time.time() collides under fast serial
        # reads, which made SSE dedup-by-timestamp replay duplicates forever.
        self._seq = 0
        self.port: Optional[str] = None
        self.baud: int = DEFAULT_BAUD
        self._serial: Any = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

        self.log_lines: Deque[Dict[str, Any]] = deque(maxlen=max_log_lines)
        self.frames: Deque[Dict[str, Any]] = deque(maxlen=max_frames)
        self.latest_frame: Optional[Dict[str, Any]] = None
        self.last_error: Optional[str] = None
        self.connected: bool = False
        self.total_bytes: int = 0
        self.frames_total: int = 0
        self._boot_lines: List[str] = []

    # ---------------------------------------------------------------- lifecycle
    def list_ports(self) -> List[Dict[str, str]]:
        """Enumerate serial ports without pyserial's help (works headless)."""
        ports: List[Dict[str, str]] = []
        try:
            from serial.tools import list_ports as _lp  # type: ignore
            for p in _lp.comports():
                ports.append({
                    "device": p.device,
                    "description": p.description or "",
                    "hwid": p.hwid or "",
                })
        except Exception:
            # Fallback: scan /dev for typical USB-UART names.
            import glob
            for dev in sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*")):
                ports.append({"device": dev, "description": "", "hwid": ""})
        return ports

    def open(self, port: Optional[str] = None, baud: int = DEFAULT_BAUD) -> bool:
        import serial  # imported lazily so the module loads without pyserial

        with self._lock:
            target_port = port or self.port or DEFAULT_PORT
            # A stale path (board came back on the other ttyUSB number) is
            # swapped for whichever port actually exists.
            target_port = find_usb_port(target_port) or target_port
            if self.connected and self.port == target_port and self.baud == baud:
                return True
            # Always tear down any previous reader FIRST, and wait for it to
            # actually die. Otherwise two reader threads parse the same byte
            # stream at different offsets and produce flickering garbage.
            self._stop_reader(wait=True)
            self.port = target_port
            self.baud = baud
            try:
                self._serial = serial.Serial(
                    self.port,
                    baud,
                    timeout=0.2,
                    dsrdtr=False,
                    rtscts=False,
                )
                # Do NOT toggle DTR on open: that resets many boards. Leave as-is.
                self._serial.dtr = True
                self._serial.rts = False
                self.connected = True
                self.last_error = None
            except Exception as e:  # noqa: BLE001
                self._serial = None
                self.connected = False
                self.last_error = str(e)
                return False

            # Fresh session: drop stale frames so the UI cannot show a mix
            # of an old parse and a new one.
            self.frames.clear()
            self.latest_frame = None
            self.frames_total = 0
            self.total_bytes = 0

            self._stop.clear()
            self._thread = threading.Thread(
                target=self._reader_loop, daemon=True, name="serial-reader"
            )
            self._thread.start()

        self._append_log(f"[host] opened {self.port} @ {self.baud}", level="system")
        return True

    def _stop_reader(self, wait: bool = True) -> None:
        """Signal the reader thread to stop and (optionally) join it."""
        self._stop.set()
        t = self._thread
        self._thread = None
        if t is not None and t.is_alive() and threading.current_thread() is not t:
            t.join(timeout=3.0 if wait else 0.1)

    def close(self) -> None:
        with self._lock:
            self.close_locked()

    def close_locked(self) -> None:
        self._stop_reader(wait=True)
        s = self._serial
        self._serial = None
        self.connected = False
        if s is not None:
            try:
                s.close()
            except Exception:
                pass

    @property
    def is_open(self) -> bool:
        return self.connected and self._serial is not None

    # ---------------------------------------------------------------- reading
    def _reader_loop(self) -> None:
        decoder = FrameDecoder()
        while not self._stop.is_set():
            s = self._serial
            if s is None:
                # Port is gone (unplugged); keep looking until it returns.
                if self._reconnect():
                    decoder = FrameDecoder()
                else:
                    time.sleep(0.5)
                continue
            try:
                chunk = s.read(256)
            except Exception as e:  # noqa: BLE001
                # Unplug / USB re-enumeration: the port number can change
                # (ttyUSB0 <-> ttyUSB1), so find the board again.
                self.last_error = str(e)
                if self._reconnect():
                    decoder = FrameDecoder()
                else:
                    time.sleep(0.5)
                continue
            if not chunk:
                continue
            self.total_bytes += len(chunk)
            self._consume(decoder.feed(chunk))
        self._consume(decoder.flush())

    def _reconnect(self) -> bool:
        """Reopen the USB-UART after it vanished; called from the reader thread.

        Prefers the previous path, then any other ttyUSB*/ttyACM* device.
        """
        import glob
        import serial  # imported lazily so the module loads without pyserial

        old = self._serial
        self._serial = None
        if old is not None:
            try:
                old.close()
            except Exception:
                pass
        candidates = sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))
        if self.port in candidates:
            candidates.remove(self.port)
            candidates.insert(0, self.port)
        for path in candidates:
            try:
                ser = serial.Serial(path, self.baud, timeout=0.2, dsrdtr=False, rtscts=False)
                ser.dtr = True
                ser.rts = False
            except Exception as e:  # noqa: BLE001
                self.last_error = str(e)
                continue
            with self._lock:
                if self._stop.is_set():
                    ser.close()
                    return False
                self._serial = ser
                self.port = path
                self.connected = True
                self.last_error = None
            self._append_log(f"[host] reconnected {path} @ {self.baud}", level="system")
            return True
        self.connected = False
        return False

    def _consume(self, result) -> None:
        """Apply a decoder result to the manager's buffers."""
        for text in result.lines:
            self._append_log(text)
        for frame in result.frames:
            self._record_frame(frame)


    def _record_frame(self, frame: Dict[str, Any]) -> None:
        self.frames.append(frame)
        self.frames_total += 1
        self.latest_frame = frame
        f = frame["flex"]
        self._append_log(
            f"[frame] flex=({f[0]},{f[1]},{f[2]},{f[3]},{f[4]})",
            level="frame",
            data=frame,
        )

    def _append_log(self, text: str, level: str = "info", data: Optional[Dict[str, Any]] = None) -> None:
        with self._lock:
            self._seq += 1
            entry = {
                "t": time.time(),
                "seq": self._seq,
                "level": level,
                "text": text,
            }
            if data is not None:
                entry["data"] = data
            self.log_lines.append(entry)
            if level in ("info", "system") and text:
                self._boot_lines.append(text)
                if len(self._boot_lines) > 200:
                    self._boot_lines = self._boot_lines[-200:]

    def log(self, text: str, level: str = "system") -> None:
        self._append_log(text, level=level)

    # ---------------------------------------------------------------- writing
    def write(self, data: bytes) -> bool:
        s = self._serial
        if s is None:
            return False
        try:
            s.write(data)
            s.flush()
            self._append_log(f"[host] -> {data!r}", level="system")
            return True
        except Exception as e:  # noqa: BLE001
            self.last_error = str(e)
            return False

    def send_line(self, text: str) -> bool:
        return self.write(text.encode("utf-8") + b"\n")

    # ---------------------------------------------------------------- control
    def reset(self, bootloader: bool = False) -> bool:
        """Pulse EN (and optionally IO0) to reset the ESP32.

        Uses pyserial's DTR/RTS which are wired EN/IO0 on typical
        ESP32 dev boards. bootloader=True enters download mode.
        """
        s = self._serial
        if s is None:
            return False
        try:
            if bootloader:
                s.dtr = True   # IO0 low -> bootloader
                s.rts = True   # EN low
                time.sleep(0.1)
                s.rts = False  # release EN -> boot
                time.sleep(0.05)
                s.dtr = False  # release IO0
            else:
                s.dtr = False
                s.rts = True   # EN low -> reset
                time.sleep(0.15)
                s.rts = False  # release -> run
            self._append_log(
                f"[host] reset (bootloader={bootloader})", level="system"
            )
            return True
        except Exception as e:  # noqa: BLE001
            self.last_error = str(e)
            return False

    # ---------------------------------------------------------------- state
    def state(self) -> Dict[str, Any]:
        with self._lock:
            logs = list(self.log_lines)[-200:]
        return {
            "connected": self.is_open,
            "port": self.port,
            "baud": self.baud,
            "total_bytes": self.total_bytes,
            "frames_seen": self.frames_total,
            "last_error": self.last_error,
            "ports": self.list_ports(),
            "wifi": self.detect_wifi(),
            "latest_frame": self.latest_frame,
            "log_tail": logs,
        }

    def detect_wifi(self) -> Dict[str, Any]:
        """Best-effort WiFi/chip state inferred from the serial log."""
        with self._lock:
            lines = list(self._boot_lines)[-200:]
        wifi: Dict[str, Any] = {"ssid": None, "connected": False, "ip": None, "raw": None}
        import re
        for line in lines:
            m = re.search(r"Connecting to (.+?)\.\.\.", line)
            if m:
                wifi["ssid"] = m.group(1).strip()
                wifi["connected"] = False
                wifi["raw"] = line
            m = re.search(r"(?:got ip|IP address|ip:)\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})", line, re.I)
            if m:
                wifi["ip"] = m.group(1)
                wifi["connected"] = True
                wifi["raw"] = line
            if re.search(r"WiFi connected|Connected to WiFi|GOT IP", line, re.I):
                wifi["connected"] = True
                wifi["raw"] = line
        return wifi

    def chip_info(self) -> Dict[str, Any]:
        """Chip family inferred from the boot banner."""
        with self._lock:
            lines = list(self._boot_lines)
        info: Dict[str, Any] = {"chip": None, "boot": None, "reset": None, "raw": []}
        import re
        for line in lines:
            if "ets " in line and "rst:" not in line:
                info["chip"] = "ESP32"
                info["boot"] = line.strip()
                info["raw"].append(line.strip())
            m = re.search(r"rst:(0x[0-9a-f]+) \(([^)]+)\)", line)
            if m:
                info["reset"] = m.group(2)
                info["raw"].append(line.strip())
            if "SPI_FAST_FLASH_BOOT" in line and info.get("chip") is None:
                info["chip"] = "ESP32"
        return info


# Module-level singleton used by the API.
serial_manager = SerialManager()
