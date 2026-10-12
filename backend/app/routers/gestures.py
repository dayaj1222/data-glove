from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import SessionLocal
from .. import models, schemas


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/", response_model=schemas.Gesture)
def create_gesture(gesture: schemas.GestureCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Gesture).filter(models.Gesture.name == gesture.name).first()
    if existing:
        raise HTTPException(400, "Gesture with this name already exists")
    db_gesture = models.Gesture(name=gesture.name)
    db.add(db_gesture)
    db.commit()
    db.refresh(db_gesture)
    return db_gesture


@router.get("/", response_model=List[schemas.Gesture])
def list_gestures(db: Session = Depends(get_db)):
    return db.query(models.Gesture).all()


@router.get("/{gesture_id}", response_model=schemas.Gesture)
def get_gesture(gesture_id: int, db: Session = Depends(get_db)):
    gesture = db.query(models.Gesture).filter(models.Gesture.id == gesture_id).first()
    if not gesture:
        raise HTTPException(404, "Gesture not found")
    return gesture


@router.delete("/{gesture_id}")
def delete_gesture(gesture_id: int, db: Session = Depends(get_db)):
    gesture = db.query(models.Gesture).filter(models.Gesture.id == gesture_id).first()
    if not gesture:
        raise HTTPException(404, "Gesture not found")
    db.delete(gesture)
    db.commit()
    return {"status": "deleted"}
