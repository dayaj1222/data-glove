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


@router.post("/bindings")
def create_binding(gesture_id: int, action_id: int, threshold: float = 0.6, db: Session = Depends(get_db)):
    gesture = db.query(models.Gesture).filter(models.Gesture.id == gesture_id).first()
    if not gesture:
        raise HTTPException(404, "Gesture not found")
    action = db.query(models.Action).filter(models.Action.id == action_id).first()
    if not action:
        raise HTTPException(404, "Action not found")
    
    binding = models.ActionBinding(gesture_id=gesture_id, action_id=action_id, threshold=threshold)
    db.add(binding)
    db.commit()
    db.refresh(binding)
    return binding


@router.get("/bindings", response_model=List[dict])
def list_bindings(db: Session = Depends(get_db)):
    bindings = db.query(models.ActionBinding).all()
    return [
        {
            "id": b.id,
            "gesture": b.gesture.name,
            "action": b.action.name,
            "threshold": b.threshold
        }
        for b in bindings
    ]


@router.delete("/bindings/{binding_id}")
def delete_binding(binding_id: int, db: Session = Depends(get_db)):
    binding = db.query(models.ActionBinding).filter(models.ActionBinding.id == binding_id).first()
    if not binding:
        raise HTTPException(404, "Binding not found")
    db.delete(binding)
    db.commit()
    return {"status": "deleted"}
