import React, { useState, useEffect } from 'react';

function BridgeUI() {
  const [status, setStatus] = useState(null);
  const [latest, setLatest] = useState(null);
  const [recording, setRecording] = useState(false);
  const [frames, setFrames] = useState([]);
  const [, setLoading] = useState(false);
  const [gestures, setGestures] = useState([]);
  const [selectedGesture, setSelectedGesture] = useState('');

  useEffect(() => {
    checkStatus();
    loadGestures();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadGestures = async () => {
    try {
      const res = await fetch('/api/gestures');
      const data = await res.json();
      setGestures(data);
      if (data.length > 0) setSelectedGesture(data[0].id);
    } catch (e) {
      console.error('Failed to load gestures', e);
    }
  };

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/bridge/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      setStatus({ connected: false, error: e.message });
    }
  };

  const getLatest = async () => {
    try {
      const res = await fetch('/api/bridge/latest');
      const data = await res.json();
      setLatest(data);
    } catch (e) {
      console.error('Failed to get latest', e);
    }
  };

  const startRecording = async () => {
    if (!selectedGesture) {
      alert('Select a gesture first');
      return;
    }
    setRecording(true);
    setFrames([]);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/bridge/record?duration=5.0&gesture_id=${selectedGesture}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (res.ok) {
        setFrames(data.frames || []);
        alert(`Saved ${data.count} frames for gesture "${data.gesture}"`);
      } else {
        alert('Error: ' + (data.detail || 'Unknown error'));
      }
    } catch (e) {
      console.error('Recording failed', e);
      alert('Recording failed');
    } finally {
      setLoading(false);
      setRecording(false);
    }
  };

  return (
    <div className="card">
      <h2>Phone Sensor Bridge</h2>
      <p>Record phone IMU data directly to the training database.</p>

      <div className="flex mb-12">
        <div style={{ flex: 1 }}>
          <div><strong>Status:</strong> {status?.connected ? '✅ Connected' : '❌ Disconnected'}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {status?.connected ? `sensor-lab at ${status.sensor_lab_url}` : status?.error || 'Not available'}
          </div>
        </div>
        <button onClick={checkStatus}>Refresh</button>
      </div>

      <div className="flex mb-12">
        <select
          value={selectedGesture}
          onChange={(e) => setSelectedGesture(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">Select a gesture...</option>
          {gestures.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button className="primary" onClick={getLatest} disabled={!status?.connected}>
          Get Latest
        </button>
        <button className="primary" onClick={startRecording} disabled={recording || !status?.connected || !selectedGesture}>
          {recording ? 'Recording...' : 'Record 5s'}
        </button>
      </div>

      {latest && (
        <div className="card" style={{ background: 'var(--bg-primary)', padding: '12px 16px' }}>
          <h3>Latest Frame</h3>
          <pre style={{ fontSize: '11px', margin: 0, maxHeight: '150px', overflow: 'auto' }}>
            {JSON.stringify(latest, null, 2)}
          </pre>
        </div>
      )}

      {frames.length > 0 && (
        <div className="card" style={{ background: 'var(--bg-primary)', padding: '12px 16px' }}>
          <h3>Recorded {frames.length} frames</h3>
          <pre style={{ fontSize: '11px', margin: 0, maxHeight: '200px', overflow: 'auto' }}>
            {JSON.stringify(frames.slice(0, 5), null, 2)}
            {frames.length > 5 && `\n... and ${frames.length - 5} more`}
          </pre>
        </div>
      )}
    </div>
  );
}

export default BridgeUI;
