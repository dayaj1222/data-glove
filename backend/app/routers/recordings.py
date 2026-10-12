from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import uuid

from ..database import SessionLocal
from .. import models, schemas


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/", response_model=schemas.Recording)
def create_recording(recording: schemas.RecordingCreate, db: Session = Depends(get_db)):
    gesture = db.query(models.Gesture).filter(models.Gesture.id == recording.gesture_id).first()
    if not gesture:
        raise HTTPException(404, "Gesture not found")
    
    db_recording = models.Recording(
        gesture_id=recording.gesture_id,
        session_id=recording.session_id
    )
    db.add(db_recording)
    db.commit()
    db.refresh(db_recording)
    
    for frame_data in recording.frames:
        frame = models.Frame(
            recording_id=db_recording.id,
            frame_index=frame_data.frame_index,
            timestamp=frame_data.timestamp,
            flex_0=frame_data.flex_0,
            flex_1=frame_data.flex_1,
            flex_2=frame_data.flex_2,
            flex_3=frame_data.flex_3,
            flex_4=frame_data.flex_4,
            accel_x=frame_data.accel_x,
            accel_y=frame_data.accel_y,
            accel_z=frame_data.accel_z,
            gyro_x=frame_data.gyro_x,
            gyro_y=frame_data.gyro_y,
            gyro_z=frame_data.gyro_z,
            mag_x=frame_data.mag_x,
            mag_y=frame_data.mag_y,
            mag_z=frame_data.mag_z,
        )
        db.add(frame)
    db.commit()
    db.refresh(db_recording)
    return db_recording


@router.get("/session/{session_id}", response_model=List[schemas.Recording])
def get_session_recordings(session_id: str, db: Session = Depends(get_db)):
    return db.query(models.Recording).filter(models.Recording.session_id == session_id).all()


@router.get("/gesture/{gesture_id}", response_model=List[schemas.Recording])
def get_gesture_recordings(gesture_id: int, db: Session = Depends(get_db)):
    return db.query(models.Recording).filter(models.Recording.gesture_id == gesture_id).all()


@router.delete("/{recording_id}")
def delete_recording(recording_id: int, db: Session = Depends(get_db)):
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(404, "Recording not found")
    db.delete(recording)
    db.commit()
    return {"status": "deleted"}


@router.delete("/gesture/{gesture_id}/all")
def delete_all_recordings(gesture_id: int, db: Session = Depends(get_db)):
    gesture = db.query(models.Gesture).filter(models.Gesture.id == gesture_id).first()
    if not gesture:
        raise HTTPException(404, "Gesture not found")
    
    recordings = db.query(models.Recording).filter(models.Recording.gesture_id == gesture_id).all()
    count = len(recordings)
    for rec in recordings:
        db.delete(rec)
    db.commit()
    return {"status": "deleted", "count": count}


@router.post("/session/start")
def start_session():
    return {"session_id": str(uuid.uuid4())}
