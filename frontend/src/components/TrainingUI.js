import React, { useState, useEffect } from 'react';
import { getGestures, trainModel, getModels } from '../api';

function TrainingUI() {
  const [gestures, setGestures] = useState([]);
  const [selectedGestures, setSelectedGestures] = useState([]);
  const [modelType, setModelType] = useState('random_forest');
  const [models, setModels] = useState([]);
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    loadGestures();
    loadModels();
  }, []);

  const loadGestures = async () => {
    try {
      const res = await getGestures();
      setGestures(res.data);
    } catch (e) {
      console.error('Failed to load gestures', e);
    }
  };

  const loadModels = async () => {
    try {
      const res = await getModels();
      setModels(res.data);
    } catch (e) {
      console.error('Failed to load models', e);
    }
  };

  const handleTrain = async () => {
    if (selectedGestures.length < 2) {
      alert('Select at least 2 gestures to train');
      return;
    }
    setTraining(true);
    setResult(null);
    try {
      const res = await trainModel(selectedGestures, modelType);
      setResult(res.data);
      await loadModels();
    } catch (e) {
      alert('Training failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setTraining(false);
    }
  };

  const toggleGesture = (id) => {
    setSelectedGestures(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  return (
    <div className="card">
      <h2>Train Model</h2>
      <p>Select gestures to include in the model, then train.</p>

      <div className="mb-12">
        <h3>Select Gestures</h3>
        <div className="grid">
          {gestures.map((g) => (
            <div key={g.id} className="item" onClick={() => toggleGesture(g.id)} style={{ cursor: 'pointer' }}>
              <span className="name">{g.name}</span>
              <input
                type="checkbox"
                checked={selectedGestures.includes(g.id)}
                onChange={() => toggleGesture(g.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ))}
        </div>
        {gestures.length === 0 && <div className="empty">No gestures defined. Create some first.</div>}
      </div>

      <div className="flex">
        <select value={modelType} onChange={e => setModelType(e.target.value)} style={{ padding: '10px 14px' }}>
          <option value="random_forest">Random Forest</option>
          <option value="gradient_boosting">Gradient Boosting</option>
          <option value="mlp">Neural Network (MLP)</option>
          <option value="svm">SVM</option>
        </select>
        <button className="primary" onClick={handleTrain} disabled={training || selectedGestures.length < 2}>
          {training ? 'Training...' : 'Train Model'}
        </button>
        <button onClick={loadModels}>Refresh Models</button>
      </div>

      {result && (
        <div className="card mt-12" style={{ background: '#2a2a2a' }}>
          <h3>Training Complete</h3>
          <div><strong>Model:</strong> {result.name}</div>
          <div><strong>Accuracy:</strong> {(result.accuracy * 100).toFixed(1)}%</div>
          <div><strong>Gestures:</strong> {result.gesture_count}</div>
        </div>
      )}

      {models.length > 0 && (
        <div className="mt-12">
          <h3>Trained Models</h3>
          <div className="grid">
            {models.map((m) => (
              <div key={m.id} className="item">
                <span className="name">{m.name}</span>
                <div className="flex">
                  <span className="badge">{m.gesture_count} gestures</span>
                  <span className="badge">{m.accuracy ? (m.accuracy * 100).toFixed(1) + '%' : 'N/A'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TrainingUI;
