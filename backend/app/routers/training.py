from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import pickle
import os
import numpy as np
import logging
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.svm import SVC
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

from ..database import SessionLocal
from .. import models, schemas
from ..actions import registry

logger = logging.getLogger(__name__)

router = APIRouter()
MODEL_DIR = "models"
os.makedirs(MODEL_DIR, exist_ok=True)


_model_cache: dict = {}


def load_model(path: str):
    """Unpickle a model once and reuse it until the file changes on disk.

    predict() used to reopen the .pkl on every call (about 1.5 ms of the 4 Hz
    inference tick); keying on mtime keeps a retrained model visible at once.
    """
    mtime = os.path.getmtime(path)
    hit = _model_cache.get(path)
    if hit is not None and hit[0] == mtime:
        return hit[1]
    with open(path, "rb") as f:
        model = pickle.load(f)
    _model_cache[path] = (mtime, model)
    return model


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def extract_features(frames) -> np.ndarray:
    if not frames:
        return np.array([])

    all_flex = []
    all_accel = []
    all_gyro = []
    all_mag = []

    for f in frames:
        if hasattr(f, "flex_0"):
            all_flex.append([f.flex_0, f.flex_1, f.flex_2, f.flex_3, f.flex_4])
            all_accel.append([f.accel_x, f.accel_y, f.accel_z])
            all_gyro.append([f.gyro_x, f.gyro_y, f.gyro_z])
            all_mag.append([f.mag_x, f.mag_y, f.mag_z])
        else:
            all_flex.append([f.get("flex_0", 0), f.get("flex_1", 0), f.get("flex_2", 0),
                           f.get("flex_3", 0), f.get("flex_4", 0)])
            all_accel.append([f.get("accel_x", 0), f.get("accel_y", 0), f.get("accel_z", 0)])
            all_gyro.append([f.get("gyro_x", 0), f.get("gyro_y", 0), f.get("gyro_z", 0)])
            all_mag.append([f.get("mag_x", 0), f.get("mag_y", 0), f.get("mag_z", 0)])

    features = []
    for sensor_data in [all_flex, all_accel, all_gyro, all_mag]:
        sensor_arr = np.array(sensor_data)
        if sensor_arr.shape[0] == 0:
            features.extend([0.0] * 4 * sensor_arr.shape[1] if sensor_arr.shape[1] > 0 else [0.0] * 4)
            continue
        for axis_idx in range(sensor_arr.shape[1]):
            axis_vals = sensor_arr[:, axis_idx]
            features.append(np.mean(axis_vals))
            features.append(np.std(axis_vals))
            features.append(np.min(axis_vals))
            features.append(np.max(axis_vals))

    return np.array(features)


@router.post("/train", response_model=schemas.TrainResponse)
def train_model(req: schemas.TrainRequest, db: Session = Depends(get_db)):
    logger.info(f"Training request: gesture_ids={req.gesture_ids}, model_type={req.model_type}")

    if len(req.gesture_ids) < 2:
        raise HTTPException(400, "Select at least 2 gestures to train")

    X, y, gesture_names = [], [], []

    for gesture_id in req.gesture_ids:
        gesture = db.query(models.Gesture).filter(models.Gesture.id == gesture_id).first()
        if not gesture:
            raise HTTPException(404, f"Gesture {gesture_id} not found")
        gesture_names.append(gesture.name)
        logger.info(f"Processing gesture '{gesture.name}'")

        recordings = db.query(models.Recording).filter(models.Recording.gesture_id == gesture_id).all()
        if not recordings:
            raise HTTPException(400, f"No recordings found for gesture '{gesture.name}'. Record some data first.")

        for rec in recordings:
            frames = db.query(models.Frame).filter(
                models.Frame.recording_id == rec.id
            ).order_by(models.Frame.frame_index).all()

            if len(frames) < 5:
                logger.warning(f"Skipping recording {rec.id}: only {len(frames)} frames")
                continue

            features = extract_features(frames)
            if features.shape[0] == 0:
                continue

            X.append(features)
            y.append(gesture_id)

    if len(X) < 2:
        raise HTTPException(400, f"Need at least 2 valid recordings. Got {len(X)}. Record more data.")

    try:
        X_arr = np.array(X)
    except Exception as e:
        shapes = [x.shape[0] for x in X]
        if len(set(shapes)) > 1:
            raise HTTPException(500, f"Inconsistent feature lengths: {shapes}")
        raise HTTPException(500, f"Feature extraction error: {str(e)}")

    y_arr = np.array(y)

    test_size = min(0.2, 1.0 / len(X_arr)) if len(X_arr) > 2 else 0.0
    if test_size > 0:
        X_train, X_test, y_train, y_test = train_test_split(X_arr, y_arr, test_size=test_size, random_state=42)
    else:
        X_train, y_train = X_arr, y_arr
        y_test = []

    model_type = req.model_type or "random_forest"
    
    if model_type == "gradient_boosting":
        model = GradientBoostingClassifier(n_estimators=100, learning_rate=0.1, max_depth=3, random_state=42)
    elif model_type == "mlp":
        model = MLPClassifier(hidden_layer_sizes=(128, 64), max_iter=500, random_state=42, early_stopping=True)
    elif model_type == "svm":
        model = SVC(kernel='rbf', C=1.0, gamma='scale', probability=True, random_state=42)
    else:
        model = RandomForestClassifier(n_estimators=200, max_depth=10, random_state=42)
    
    model.fit(X_train, y_train)

    accuracy = 1.0
    if len(y_test) > 0:
        y_pred = model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)

    model_name = req.name or f"model_{len(gesture_names)}gestures"
    model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(model, f)

    db_model = models.TrainedModel(
        name=model_name,
        model_type=model_type,
        path=model_path,
        accuracy=accuracy,
        gesture_ids=req.gesture_ids
    )
    db.add(db_model)
    db.commit()
    db.refresh(db_model)

    return schemas.TrainResponse(
        model_id=db_model.id,
        name=model_name,
        accuracy=accuracy,
        gesture_count=len(req.gesture_ids)
    )


@router.get("/models", response_model=List[dict])
def list_models(db: Session = Depends(get_db)):
    models = db.query(models.TrainedModel).all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "model_type": m.model_type,
            "accuracy": m.accuracy,
            "gesture_count": len(m.gesture_ids) if m.gesture_ids else 0,
            "created_at": m.created_at
        }
        for m in models
    ]


@router.post("/predict")
def predict(req: schemas.PredictRequest, db: Session = Depends(get_db)):
    latest_model = db.query(models.TrainedModel).order_by(models.TrainedModel.created_at.desc()).first()
    if not latest_model:
        raise HTTPException(404, "No trained model found. Train a model first.")

    try:
        model = load_model(latest_model.path)
    except Exception as e:
        raise HTTPException(500, f"Failed to load model: {str(e)}")

    frame_data = req.frame

    if isinstance(frame_data, list):
        frames = frame_data
    elif isinstance(frame_data, dict):
        frames = [frame_data]
    else:
        raise HTTPException(400, "frame must be a dict or list of dicts")

    if len(frames) == 0:
        raise HTTPException(400, "No frames provided")

    features = extract_features(frames)
    if features.shape[0] == 0:
        raise HTTPException(400, "Failed to extract features from frames")

    features = features.reshape(1, -1)

    expected_features = model.n_features_in_
    if features.shape[1] != expected_features:
        raise HTTPException(
            400,
            f"Feature mismatch: got {features.shape[1]} features, model expects {expected_features}."
        )

    try:
        pred_id = model.predict(features)[0]
        confidences = model.predict_proba(features)[0]
        confidence = max(confidences) if len(confidences) > 0 else 0
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {str(e)}")

    gesture = db.query(models.Gesture).filter(models.Gesture.id == int(pred_id)).first()

    return schemas.PredictResponse(
        gesture_id=int(pred_id),
        gesture_name=gesture.name if gesture else None,
        confidence=float(confidence)
    )


@router.post("/predict-and-act")
def predict_and_act(req: schemas.PredictRequest, db: Session = Depends(get_db)):
    threshold = req.threshold if hasattr(req, 'threshold') else 0.6
    
    result = predict(req, db)
    
    if result.confidence >= threshold and result.gesture_id:
        action_binding = db.query(models.ActionBinding).filter(
            models.ActionBinding.gesture_id == result.gesture_id
        ).first()
        
        if action_binding:
            action_record = db.query(models.Action).filter(
                models.Action.id == action_binding.action_id
            ).first()
            if action_record:
                action_cls = registry.get(action_record.action_type)
                if action_cls:
                    action = action_cls.from_config(action_record.config)
                    action.execute()
                    return {"executed": True, "gesture": result.gesture_name, "action": action_record.name}
    
    return {"executed": False, "gesture": result.gesture_name, "confidence": result.confidence}
