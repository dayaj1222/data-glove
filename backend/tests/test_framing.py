import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.device.framing import (
    FRAME_MAGIC,
    FRAME_SIZE,
    PAYLOAD_SIZE,
    FrameDecoder,
    decode_line,
    parse_binary_frame,
    parse_text_frame,
)


def make_payload(flex=(100, 200, 300, 400, 500), accel=(0.1, 0.2, 1.0),
                 gyro=(1.0, 2.0, 3.0), mag=(0.0, 0.0, 0.0)) -> bytes:
    return struct.pack("<5H9f", *flex, *accel, *gyro, *mag)


def make_frame(**kw) -> bytes:
    return FRAME_MAGIC + make_payload(**kw)


# --- parse_binary_frame -----------------------------------------------------

def test_parses_valid_payload():
    frame = parse_binary_frame(make_payload())
    assert frame is not None
    assert frame["flex"] == [100, 200, 300, 400, 500]
    assert frame["accel"] == pytest.approx([0.1, 0.2, 1.0], abs=1e-6)
    assert frame["source"] == "binary"


def test_rejects_short_payload():
    assert parse_binary_frame(b"\x00" * (PAYLOAD_SIZE - 1)) is None


def test_rejects_out_of_range_adc():
    assert parse_binary_frame(make_payload(flex=(9999, 0, 0, 0, 0))) is None


def test_rejects_absurd_floats():
    assert parse_binary_frame(make_payload(accel=(1e9, 0.0, 0.0))) is None


# --- parse_text_frame -------------------------------------------------------

def test_parses_text_sensor_line():
    f = parse_text_frame("410\t470\t60213")
    assert f is not None
    assert f["flex"][0] == 410
    assert f["source"] == "text"
    assert f["mv"] == 470.0


def test_rejects_boot_banner():
    assert parse_text_frame("ets Jul 29 2019") is None


def test_rejects_out_of_range_text():
    assert parse_text_frame("9999 100") is None


# --- FrameDecoder -----------------------------------------------------------

def test_decodes_one_whole_frame():
    d = FrameDecoder()
    out = d.feed(make_frame())
    assert len(out.frames) == 1
    assert out.frames[0]["flex"][0] == 100


def test_decodes_frame_split_across_chunks():
    d = FrameDecoder()
    data = make_frame()
    assert d.feed(data[:10]).frames == []
    out = d.feed(data[10:])
    assert len(out.frames) == 1


def test_recovers_from_leading_garbage():
    d = FrameDecoder()
    out = d.feed(b"\xff\xfe\x01" + make_frame())
    assert len(out.frames) == 1


def test_decodes_two_back_to_back_frames():
    d = FrameDecoder()
    out = d.feed(make_frame() + make_frame())
    assert len(out.frames) == 2


def test_emits_text_lines():
    d = FrameDecoder()
    out = d.feed(b"hello world\n")
    assert "hello world" in out.lines


def test_text_frame_becomes_frame():
    d = FrameDecoder()
    out = d.feed(b"410\t470\t60213\n")
    assert len(out.frames) == 1
    assert out.frames[0]["source"] == "text"


def test_mixed_text_and_binary():
    d = FrameDecoder()
    out = d.feed(b"boot ok\n" + make_frame() + b"another line\n")
    assert len(out.frames) == 1
    assert any("boot ok" in l for l in out.lines)


def test_flush_drains_trailing_text():
    d = FrameDecoder()
    d.feed(b"no newline yet")
    out = d.flush()
    assert any("no newline yet" in l for l in out.lines)


def test_headerless_frame_still_parses():
    d = FrameDecoder()
    out = d.feed(make_payload())
    assert len(out.frames) == 1


# --- desync recovery --------------------------------------------------------

def test_long_printable_garbage_does_not_stall_frames():
    """A desynced stream must keep parsing frames, not pile up bytes.

    Regression: a printable-but-not-a-frame run used to be buffered until
    MAX_LOOKAHEAD and then cleared wholesale, so no frame was ever emitted
    again while total_bytes kept climbing.
    """
    d = FrameDecoder()
    d.feed(b"junk" * 400)              # 1600 printable bytes, no newline
    out = d.feed(make_frame(flex=(11, 22, 33, 44, 55)))
    assert len(out.frames) == 1
    assert out.frames[0]["flex"][0] == 11


def test_binary_garbage_before_magic_is_dropped():
    d = FrameDecoder()
    out = d.feed(b"\x00\xff\x01" + make_frame(flex=(7, 8, 9, 10, 11)))
    assert len(out.frames) == 1
    assert out.frames[0]["flex"] == [7, 8, 9, 10, 11]


def test_frames_keep_coming_after_text_burst():
    d = FrameDecoder()
    d.feed(b"[imu] ready\n" * 50)
    frames = []
    for _ in range(5):
        frames += d.feed(make_frame()).frames
    assert len(frames) == 5


# --- decode_line ------------------------------------------------------------

def test_decode_line_strips_cr():
    assert decode_line(b"hello\r") == "hello"


def test_decode_line_replaces_nonprintable():
    assert "\ufffd" in decode_line(b"a\x00b")
