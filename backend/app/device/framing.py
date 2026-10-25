"""Pure byte-stream framing for the ESP32 sensor protocol.

No I/O, no threads, no global state: given bytes in, give parsed events out.
This is deliberately standalone so it can be unit-tested without a serial port.

Wire format (firmware 'glove_full'):
    [0xAA 0x55] [5 x uint16 LE flex] [9 x float32 LE accel/gyro/mag] = 48 bytes
Older firmware sends the 46-byte payload with no magic; we still accept it.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

FRAME_MAGIC = b"\xAA\x55"
FLEX_COUNT = 5
IMU_FLOAT_COUNT = 9
PAYLOAD_SIZE = FLEX_COUNT * 2 + IMU_FLOAT_COUNT * 4  # 46
FRAME_SIZE = len(FRAME_MAGIC) + PAYLOAD_SIZE          # 48

# Plausibility bounds. Values outside these mean we are misaligned, not that
# the sensor is extreme, so the parser resyncs rather than emitting garbage.
MAX_ADC = 4095
MAX_ABS_FLOAT = 1e4
MAX_LOOKAHEAD = 4096


def decode_line(raw: bytes) -> str:
    """Decode one serial line, replacing non-printable bytes."""
    text = raw.rstrip(b"\r")
    try:
        s = text.decode("utf-8")
    except UnicodeDecodeError:
        s = text.decode("latin-1", errors="replace")
    printable = "".join(c if (c.isprintable() or c == "\t") else "\ufffd" for c in s)
    return printable.rstrip()


def parse_binary_frame(data: bytes) -> Optional[Dict[str, Any]]:
    """Parse a 46-byte payload into a frame dict, or None if implausible."""
    if len(data) < PAYLOAD_SIZE:
        return None
    try:
        vals = struct.unpack("<5H9f", data[:PAYLOAD_SIZE])
    except struct.error:
        return None
    flex = vals[:FLEX_COUNT]
    rest = vals[FLEX_COUNT:]
    if any(v > MAX_ADC for v in flex):
        return None
    if any(not (-MAX_ABS_FLOAT < f < MAX_ABS_FLOAT) for f in rest):
        return None
    return {
        "flex": list(flex),
        "accel": list(rest[0:3]),
        "gyro": list(rest[3:6]),
        "mag": list(rest[6:9]),
        "raw_hex": data[:PAYLOAD_SIZE].hex(),
        "source": "binary",
    }


def parse_text_frame(text: str) -> Optional[Dict[str, Any]]:
    """Parse a text line like '410\t470\t60213' into a minimal frame.

    Lets the monitor show live data from firmware that prints text instead of
    emitting the binary packet. Only the first field (raw ADC) is used.
    """
    parts = text.replace(",", " ").split()
    if len(parts) < 2 or len(parts) > 5:
        return None
    nums: List[float] = []
    for p in parts:
        try:
            nums.append(float(p))
        except ValueError:
            return None
    raw = nums[0]
    if not (0.0 <= raw <= MAX_ADC):
        return None
    return {
        "flex": [int(raw)] + [0] * (FLEX_COUNT - 1),
        "accel": [0.0, 0.0, 0.0],
        "gyro": [0.0, 0.0, 0.0],
        "mag": [0.0, 0.0, 0.0],
        "raw_hex": "",
        "source": "text",
        "mv": nums[1] if len(nums) > 1 else None,
        "rflex": nums[2] if len(nums) > 2 else None,
    }


@dataclass
class DrainResult:
    """Outcome of feeding a chunk into the framer."""

    frames: List[Dict[str, Any]] = field(default_factory=list)
    lines: List[str] = field(default_factory=list)


class FrameDecoder:
    """Stateful, incremental decoder: feed bytes, get frames and log lines.

    Keeps its own buffer so callers can feed arbitrary chunk sizes. Resyncs
    byte-by-byte on garbage instead of flushing, so a single bad byte cannot
    permanently desync a live stream.
    """

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, chunk: bytes) -> DrainResult:
        self._buf.extend(chunk)
        return self._drain(final=False)

    def flush(self) -> DrainResult:
        return self._drain(final=True)

    def _drain(self, final: bool) -> DrainResult:
        out = DrainResult()
        buf = self._buf
        while buf:
            # 1) Prefer a magic-prefixed frame; scan so one bad byte cannot
            #    permanently desync the stream.
            if len(buf) >= len(FRAME_MAGIC):
                mi = buf.find(FRAME_MAGIC)
                if mi > 0:
                    # Text before a frame marker is a real log line, not junk.
                    prefix = bytes(buf[:mi])
                    if prefix and all(
                        0x20 <= c < 0x7F or c in (0x09, 0x0A, 0x0D) for c in prefix
                    ):
                        for text in decode_line(prefix).split("\n"):
                            if text.strip():
                                out.lines.append(text)
                                tf = parse_text_frame(text)
                                if tf is not None:
                                    out.frames.append(tf)
                    del buf[:mi]
                    continue
                if mi == 0:
                    if len(buf) < FRAME_SIZE:
                        break
                    frame = parse_binary_frame(bytes(buf[len(FRAME_MAGIC):FRAME_SIZE]))
                    if frame is not None:
                        del buf[:FRAME_SIZE]
                        out.frames.append(frame)
                        continue
                    del buf[:1]
                    continue

            # 1b) Headerless fallback for older firmware.
            if len(buf) >= PAYLOAD_SIZE:
                frame = parse_binary_frame(bytes(buf[:PAYLOAD_SIZE]))
                if frame is not None:
                    del buf[:PAYLOAD_SIZE]
                    out.frames.append(frame)
                    continue

            # 2) A newline means we are in text territory: emit the line, and
            #    try to interpret it as a text sensor frame. Any newline ends a
            #    line -- binary candidates were already ruled out above.
            nl = buf.find(b"\n")
            if nl >= 0:
                raw = bytes(buf[:nl])
                del buf[: nl + 1]
                text = decode_line(raw)
                out.lines.append(text)
                tf = parse_text_frame(text)
                if tf is not None:
                    out.frames.append(tf)
                continue

            # 3) Head looks like printable ASCII: probably a line in flight.
            if 0x20 <= buf[0] < 0x7F:
                if not final and len(buf) < MAX_LOOKAHEAD:
                    break          # wait for more data
                # Flushing, or the line is absurdly long: emit it as text now.
                out.lines.append(decode_line(bytes(buf)))
                buf.clear()
                break

            # 4) Misaligned: drop ONE byte and resync.
            del buf[:1]

        if final and buf:
            out.lines.append(decode_line(bytes(buf)))
            buf.clear()
        return out
