from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Dict, Any


# Gesture schemas
class GestureBase(BaseModel):
    name: str


class GestureCreate(GestureBase):
    pass


class Gesture(GestureBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


# Frame schemas
class FrameBase(BaseModel):
    frame_index: int
    timestamp: float
    flex_0: float
    flex_1: float
    flex_2: float
    flex_3: float
    flex_4: float
    accel_x: float
    accel_y: float
    accel_z: float
    gyro_x: float
    gyro_y: float
    gyro_z: float
    mag_x: float
    mag_y: float
    mag_z: float


class FrameCreate(FrameBase):
    pass


class Frame(FrameBase):
    id: int
    recording_id: int
    
    class Config:
        from_attributes = True


# Recording schemas
class RecordingBase(BaseModel):
    gesture_id: int
    session_id: str


class RecordingCreate(RecordingBase):
    frames: List[FrameCreate]


class Recording(RecordingBase):
    id: int
    created_at: datetime
    frames: List[Frame] = []
    
    class Config:
        from_attributes = True


# Action schemas
class ActionBase(BaseModel):
    name: str
    action_type: str
    config: Dict[str, Any]


class ActionCreate(ActionBase):
    pass


class Action(ActionBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


# Training schemas
class TrainRequest(BaseModel):
    gesture_ids: List[int]
    model_type: str = "random_forest"
    name: Optional[str] = None


class TrainResponse(BaseModel):
    model_id: int
    name: str
    accuracy: float
    gesture_count: int


# Prediction schemas
class PredictRequest(BaseModel):
    frame: Dict[str, float] | List[Dict[str, float]]  # single frame or list of frames


class PredictResponse(BaseModel):
    gesture_id: Optional[int]
    gesture_name: Optional[str]
    confidence: Optional[float]
