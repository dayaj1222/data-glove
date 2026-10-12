from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

from .database import Base


class Gesture(Base):
    __tablename__ = "gestures"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    recordings = relationship("Recording", back_populates="gesture")
    bindings = relationship("ActionBinding", back_populates="gesture")


class Recording(Base):
    __tablename__ = "recordings"

    id = Column(Integer, primary_key=True, index=True)
    gesture_id = Column(Integer, ForeignKey("gestures.id"))
    session_id = Column(String, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    gesture = relationship("Gesture", back_populates="recordings")
    frames = relationship("Frame", back_populates="recording", cascade="all, delete-orphan")


class Frame(Base):
    __tablename__ = "frames"

    id = Column(Integer, primary_key=True, index=True)
    recording_id = Column(Integer, ForeignKey("recordings.id"))
    frame_index = Column(Integer)
    timestamp = Column(Float)
    
    flex_0 = Column(Float)
    flex_1 = Column(Float)
    flex_2 = Column(Float)
    flex_3 = Column(Float)
    flex_4 = Column(Float)
    
    accel_x = Column(Float)
    accel_y = Column(Float)
    accel_z = Column(Float)
    gyro_x = Column(Float)
    gyro_y = Column(Float)
    gyro_z = Column(Float)
    mag_x = Column(Float)
    mag_y = Column(Float)
    mag_z = Column(Float)
    
    recording = relationship("Recording", back_populates="frames")


class Action(Base):
    __tablename__ = "actions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    action_type = Column(String)
    config = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    bindings = relationship("ActionBinding", back_populates="action")


class ActionBinding(Base):
    __tablename__ = "action_bindings"

    id = Column(Integer, primary_key=True, index=True)
    gesture_id = Column(Integer, ForeignKey("gestures.id"))
    action_id = Column(Integer, ForeignKey("actions.id"))
    threshold = Column(Float, default=0.6)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    gesture = relationship("Gesture", back_populates="bindings")
    action = relationship("Action", back_populates="bindings")


class TrainedModel(Base):
    __tablename__ = "trained_models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    model_type = Column(String)
    path = Column(String)
    accuracy = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    gesture_ids = Column(JSON)
