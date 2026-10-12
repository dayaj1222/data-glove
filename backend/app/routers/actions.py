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


@router.post("/", response_model=schemas.Action)
def create_action(action: schemas.ActionCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Action).filter(models.Action.name == action.name).first()
    if existing:
        raise HTTPException(400, "Action with this name already exists")
    db_action = models.Action(
        name=action.name,
        action_type=action.action_type,
        config=action.config
    )
    db.add(db_action)
    db.commit()
    db.refresh(db_action)
    return db_action


@router.get("/", response_model=List[schemas.Action])
def list_actions(db: Session = Depends(get_db)):
    return db.query(models.Action).all()


@router.get("/{action_id}", response_model=schemas.Action)
def get_action(action_id: int, db: Session = Depends(get_db)):
    action = db.query(models.Action).filter(models.Action.id == action_id).first()
    if not action:
        raise HTTPException(404, "Action not found")
    return action


@router.delete("/{action_id}")
def delete_action(action_id: int, db: Session = Depends(get_db)):
    action = db.query(models.Action).filter(models.Action.id == action_id).first()
    if not action:
        raise HTTPException(404, "Action not found")
    db.delete(action)
    db.commit()
    return {"status": "deleted"}
