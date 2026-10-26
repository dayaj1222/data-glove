import React, { useState, useEffect, useRef } from 'react';
import { getGestures } from '../api';
import { useEspFrame } from '../hooks/useEspFrame';

function PredictUI() {
  const [gestures, setGestures] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('idle');
  const [frameCount, setFrameCount] = useState(0);
  const [bufferSize, setBufferSize] = useState(60);
  const [useEsp, setUseEsp] = useState(true);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  const [, setLatestFrame] = useState(null);
  const [history, setHistory] = useState([]);
  const [actionTriggered, setActionTriggered] = useState(false);
  const [smoothConfidence, setSmoothConfidence] = useState(0);
  const bufferRef = useRef([]);
  const confidenceBufferRef = useRef([]);
  const intervalRef = useRef(null);
  const predictIntervalRef = useRef(null);

  useEffect(() => {
    loadGestures();
    return () => stopPrediction();
  }, []);

  const loadGestures = async () => {
    try {
      const res = await getGestures();
      setGestures(res.data);
    } catch (e) {
      console.error('Failed to load gestures', e);
    }
  };


  const generateMockFrame = () => ({
    flex_0: 500 + 400 * Math.random(),
    flex_1: 500 + 400 * Math.random(),
    flex_2: 500 + 400 * Math.random(),
    flex_3: 500 + 400 * Math.random(),
    flex_4: 500 + 400 * Math.random(),
    accel_x: (Math.random() - 0.5) * 2,
    accel_y: -9.8 + (Math.random() - 0.5),
    accel_z: (Math.random() - 0.5) * 2,
    gyro_x: (Math.random() - 0.5) * 0.5,
    gyro_y: (Math.random() - 0.5) * 0.5,
    gyro_z: (Math.random() - 0.5) * 0.5,
    mag_x: 0.5 + (Math.random() - 0.5) * 0.2,
    mag_y: 0.2 + (Math.random() - 0.5) * 0.2,
    mag_z: 0.8 + (Math.random() - 0.5) * 0.2,
  });

  const runPrediction = async () => {
    const frames = bufferRef.current;
    if (frames.length < 10) {
      setStatus(`Buffering ${frames.length}/${bufferSize}`);
      return;
    }

    try {
      const res = await fetch('/api/training/predict-and-act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame: frames, threshold: confidenceThreshold })
      });
      const data = await res.json();
      
      // Smooth confidence (average of last 3)
      confidenceBufferRef.current.push(data.confidence || 0);
      if (confidenceBufferRef.current.length > 3) {
        confidenceBufferRef.current.shift();
      }
      const avgConfidence = confidenceBufferRef.current.reduce((a, b) => a + b, 0) / confidenceBufferRef.current.length;
      setSmoothConfidence(avgConfidence);
      
      const displayName = avgConfidence >= confidenceThreshold && data.gesture ? data.gesture : '—';
      
      setPrediction({ 
        displayName: displayName,
        confidence: avgConfidence,
        rawConfidence: data.confidence,
        executed: data.executed || false,
        gesture: data.gesture
      });
      
      setStatus(`Confidence: ${(avgConfidence * 100).toFixed(0)}%`);
      
      if (data.executed) {
        setActionTriggered(true);
        setTimeout(() => setActionTriggered(false), 2000);
        setHistory(prev => {
          const newHistory = [data.gesture, ...prev.filter(h => h !== data.gesture)].slice(0, 5);
          return newHistory;
        });
      }
    } catch (e) {
      setStatus('Error');
    }
  };

  const addFrame = (frame) => {
    bufferRef.current.push(frame);
    if (bufferRef.current.length > bufferSize) {
      bufferRef.current.shift();
    }
    setFrameCount(prev => prev + 1);
    setLatestFrame(frame);
  };

  // Live frames from the ESP, polled only while prediction is running.
  const { frame: liveFrame } = useEspFrame(isRunning && useEsp);

  useEffect(() => {
    if (isRunning && useEsp && liveFrame) addFrame(liveFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFrame, isRunning, useEsp]);

  const startPrediction = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setPrediction(null);
    setHistory([]);
    setActionTriggered(false);
    setSmoothConfidence(0);
    confidenceBufferRef.current = [];
    bufferRef.current = [];
    setFrameCount(0);
    setStatus('Starting...');

    // If the ESP is disabled, fall back to mock frames at the same rate.
    if (!useEsp) {
      intervalRef.current = setInterval(() => addFrame(generateMockFrame()), 33);
    }

    // Predict every 250ms (slower, more stable)
    predictIntervalRef.current = setInterval(runPrediction, 250);
  };

  const stopPrediction = () => {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (predictIntervalRef.current) {
      clearInterval(predictIntervalRef.current);
      predictIntervalRef.current = null;
    }
    setStatus('Stopped');
  };

  const getConfidenceColor = (conf) => {
    if (conf >= 0.8) return '#22c55e';
    if (conf >= 0.6) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Live Prediction</h2>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {status} {actionTriggered && '⚡ Action triggered'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
        <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input type="checkbox" checked={useEsp} onChange={e => setUseEsp(e.target.checked)} />
          ESP32
        </label>
        <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          Window: <input type="number" value={bufferSize} onChange={e => setBufferSize(Math.max(20, parseInt(e.target.value) || 60))} style={{ width: '48px' }} />
        </label>
        <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          Threshold: <input type="range" min="0" max="100" value={confidenceThreshold * 100} onChange={e => setConfidenceThreshold(parseInt(e.target.value) / 100)} style={{ width: '80px' }} />
          <span style={{ minWidth: '36px' }}>{(confidenceThreshold * 100).toFixed(0)}%</span>
        </label>
        {!isRunning ? (
          <button className="primary" onClick={startPrediction}>Start</button>
        ) : (
          <button className="danger" onClick={stopPrediction}>Stop</button>
        )}
        <button onClick={() => { bufferRef.current = []; setFrameCount(0); setPrediction(null); confidenceBufferRef.current = []; setSmoothConfidence(0); }}>Clear</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
        <span>Frames: {frameCount}</span>
        <span>Buffer: {bufferRef.current.length}/{bufferSize}</span>
        <span>History: {history.join(' → ') || '—'}</span>
      </div>

      <div style={{ marginTop: '12px' }}>
        <div style={{ 
          fontSize: '48px', 
          fontWeight: 'bold',
          padding: '16px',
          background: prediction?.executed ? '#1a3a1a' : 'var(--bg-primary)',
          borderRadius: '8px',
          border: prediction?.executed ? '2px solid #22c55e' : '1px solid var(--border)',
          textAlign: 'center',
          minHeight: '80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s'
        }}>
          {prediction?.displayName || '—'}
          {prediction?.executed && <span style={{ fontSize: '20px', marginLeft: '12px' }}>✓</span>}
        </div>
        <div style={{ marginTop: '4px', height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(smoothConfidence * 100, 100)}%`,
            background: getConfidenceColor(smoothConfidence),
            transition: 'width 0.3s ease'
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          <span>0%</span>
          <span>threshold {(confidenceThreshold * 100).toFixed(0)}%</span>
          <span>{(smoothConfidence * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {gestures.map(g => (
          <span key={g.id} style={{
            padding: '2px 10px',
            borderRadius: '12px',
            background: prediction?.displayName === g.name ? '#6366f1' : 'var(--bg-primary)',
            color: prediction?.displayName === g.name ? 'white' : 'var(--text-secondary)',
            fontSize: '12px',
            border: '1px solid var(--border)'
          }}>
            {g.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default PredictUI;
