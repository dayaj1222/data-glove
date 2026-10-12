from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
import time
import uuid

from sqlalchemy.orm import Session

from ..bridge import SensorLabBridge
from ..database import SessionLocal
from .. import models, schemas

router = APIRouter()
bridge = SensorLabBridge()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/bridge/status")
def bridge_status():
    """Check if sensor-lab is reachable."""
    try:
        import requests
        resp = requests.get(f"{bridge.base_url}/api/health", timeout=2)
        return {"status": "ok", "sensor_lab_url": bridge.base_url, "connected": resp.status_code == 200}
    except Exception as e:
        return {"status": "error", "sensor_lab_url": bridge.base_url, "connected": False, "error": str(e)}


@router.get("/bridge/latest")
def bridge_latest():
    """Get the latest frame from sensor-lab."""
    frame = bridge.get_latest_frame()
    if frame is None:
        raise HTTPException(404, "No readings available from sensor-lab")
    return frame


@router.post("/bridge/record")
def bridge_record(duration: float = 5.0, gesture_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Record frames from sensor-lab and save them to the database."""
    if gesture_id is None:
        raise HTTPException(400, "gesture_id is required")
    
    # Verify gesture exists
    gesture = db.query(models.Gesture).filter(models.Gesture.id == gesture_id).first()
    if not gesture:
        raise HTTPException(404, f"Gesture {gesture_id} not found")
    
    # Create a new session ID for this recording batch
    session_id = str(uuid.uuid4())
    
    # Record frames
    frames_data = []
    for frame_data in bridge.stream_frames(duration=duration):
        frames_data.append(frame_data)
    
    if len(frames_data) < 5:
        raise HTTPException(400, f"Only {len(frames_data)} frames recorded (need at least 5)")
    
    # Create recording
    db_recording = models.Recording(
        gesture_id=gesture_id,
        session_id=session_id
    )
    db.add(db_recording)
    db.commit()
    db.refresh(db_recording)
    
    # Add frames
    for i, f in enumerate(frames_data):
        frame = models.Frame(
            recording_id=db_recording.id,
            frame_index=i,
            timestamp=f.get("timestamp", time.time()),
            flex_0=f.get("flex_0", 500),
            flex_1=f.get("flex_1", 500),
            flex_2=f.get("flex_2", 500),
            flex_3=f.get("flex_3", 500),
            flex_4=f.get("flex_4", 500),
            accel_x=f.get("accel_x", 0.0),
            accel_y=f.get("accel_y", 0.0),
            accel_z=f.get("accel_z", 0.0),
            gyro_x=f.get("gyro_x", 0.0),
            gyro_y=f.get("gyro_y", 0.0),
            gyro_z=f.get("gyro_z", 0.0),
            mag_x=f.get("mag_x", 0.0),
            mag_y=f.get("mag_y", 0.0),
            mag_z=f.get("mag_z", 0.0),
        )
        db.add(frame)
    db.commit()
    
    return {
        "count": len(frames_data),
        "recording_id": db_recording.id,
        "gesture": gesture.name,
        "session_id": session_id
    }
