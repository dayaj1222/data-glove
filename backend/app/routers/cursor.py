"""Air-mouse control: enable the uinput cursor and tune it."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..aircursor import ACTIONS, ZONES, air_cursor

router = APIRouter()


class CursorConfig(BaseModel):
    gain: Optional[float] = None
    accel: Optional[float] = None
    gate: Optional[float] = None
    invert_x: Optional[bool] = None
    invert_y: Optional[bool] = None
    primary_channel: Optional[int] = None
    primary_threshold: Optional[float] = None
    primary_mode: Optional[str] = None
    primary_margin: Optional[float] = None
    secondary_channel: Optional[int] = None
    secondary_threshold: Optional[float] = None
    secondary_mode: Optional[str] = None
    secondary_margin: Optional[float] = None
    roll_side: Optional[float] = None
    roll_up: Optional[float] = None
    mod_key: Optional[str] = None
    clutch_enabled: Optional[bool] = None
    clutch_pitch: Optional[float] = None
    scroll_gain: Optional[float] = None
    invert_scroll: Optional[bool] = None
    stabilize_ms: Optional[int] = None
    chord_ms: Optional[int] = None
    down_a: Optional[str] = None
    down_b: Optional[str] = None
    down_ab: Optional[str] = None
    side_a: Optional[str] = None
    side_b: Optional[str] = None
    side_ab: Optional[str] = None
    up_a: Optional[str] = None
    up_b: Optional[str] = None
    up_ab: Optional[str] = None


@router.get("/cursor")
def cursor_state() -> Dict[str, Any]:
    return air_cursor.state()


@router.get("/cursor/actions")
def cursor_actions() -> Dict[str, Any]:
    return {"actions": list(ACTIONS)}


@router.post("/cursor/enable")
def cursor_enable() -> Dict[str, Any]:
    if not air_cursor.enable():
        raise HTTPException(500, air_cursor.error or "cannot enable air cursor")
    return air_cursor.state()


@router.post("/cursor/disable")
def cursor_disable() -> Dict[str, Any]:
    air_cursor.disable()
    return air_cursor.state()


@router.post("/cursor/config")
def cursor_config(cfg: CursorConfig) -> Dict[str, Any]:
    air_cursor.update_config(cfg.model_dump(exclude_none=True))
    return air_cursor.state()


@router.post("/cursor/calibrate/reset")
def cursor_calibrate_reset() -> Dict[str, Any]:
    air_cursor.reset_poses()
    return air_cursor.state()


@router.post("/cursor/calibrate/{zone}")
def cursor_calibrate(zone: str) -> Dict[str, Any]:
    """Hold the hand in the `zone` pose (down | side | up) and call this."""
    if zone not in ZONES:
        raise HTTPException(404, f"zone must be one of {list(ZONES)}")
    try:
        got = air_cursor.capture_pose(zone)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {**air_cursor.state(), "captured": got}


@router.post("/cursor/fingers/{kind}")
def cursor_fingers(kind: str) -> Dict[str, Any]:
    """Hold both fingers `straight`, call; hold both `bent`, call. Thresholds are then set."""
    if kind not in ("straight", "bent"):
        raise HTTPException(404, "kind must be straight or bent")
    try:
        got = air_cursor.capture_fingers(kind)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {**air_cursor.state(), "captured": got}
