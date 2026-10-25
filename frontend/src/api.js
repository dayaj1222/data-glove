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

// Device (ESP32 serial)
export const deviceStatus = () => API.get('/device/status');
export const devicePorts = () => API.get('/device/ports');
export const deviceOpen = (port, baud = 115200) => API.post('/device/open', { port, baud });
export const deviceClose = () => API.post('/device/close');
export const deviceReset = (bootloader = false) => API.post('/device/reset', { bootloader });
export const deviceSend = (text) => API.post('/device/send', { text });
export const deviceSensors = (limit = 200) => API.get('/device/sensors', { params: { limit } });
export const deviceCodeList = () => API.get('/device/code');
export const deviceCodeRead = (filename) => API.get(`/device/code/${filename}`);
export const deviceCodeWrite = (filename, content) => API.put('/device/code', { filename, content });
export const deviceCodeNew = () => API.post('/device/code/new');
export const deviceFlash = (payload = {}) => API.post('/device/flash', payload);
export const deviceFlashStatus = () => API.get('/device/flash/status');
export const getModels = () => API.get('/training/models');
export const predict = (frame) => API.post('/training/predict', { frame });
