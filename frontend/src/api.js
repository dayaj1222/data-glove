import axios from 'axios';

const API = axios.create({
  baseURL: '/api',
});

// Gestures
export const getGestures = () => API.get('/gestures');
export const createGesture = (name) => API.post('/gestures', { name });
export const deleteGesture = (id) => API.delete(`/gestures/${id}`);

// Actions
export const getActions = () => API.get('/actions/');
export const createAction = (name, actionType, config) => 
  API.post('/actions/', { name, action_type: actionType, config });
export const deleteAction = (id) => API.delete(`/actions/${id}/`);

// Recordings
export const startSession = () => API.post('/recordings/session/start');
export const saveRecording = (gestureId, sessionId, frames) =>
  API.post('/recordings', { gesture_id: gestureId, session_id: sessionId, frames });
export const getSessionRecordings = (sessionId) => API.get(`/recordings/session/${sessionId}`);
export const getGestureRecordings = (gestureId) => API.get(`/recordings/gesture/${gestureId}`);
export const deleteRecording = (id) => API.delete(`/recordings/${id}`);
export const deleteAllRecordings = (gestureId) => API.delete(`/recordings/gesture/${gestureId}/all`);

// Training
export const trainModel = (gestureIds, modelType = 'random_forest', name = null) =>
  API.post('/training/train', { gesture_ids: gestureIds, model_type: modelType, name });
export const getModels = () => API.get('/training/models');
export const predict = (frame) => API.post('/training/predict', { frame });
