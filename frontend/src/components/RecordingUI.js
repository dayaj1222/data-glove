import React, { useState, useEffect, useRef } from 'react';
import { getGestures, startSession, saveRecording, getGestureRecordings, deleteRecording, deleteAllRecordings } from '../api';
import PhoneOrientation from './PhoneOrientation';

function RecordingUI() {
  const [gestures, setGestures] = useState([]);
  const [selectedGesture, setSelectedGesture] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [status, setStatus] = useState('idle');
  const [frameCount, setFrameCount] = useState(0);
  const [latestFrame, setLatestFrame] = useState(null);
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const bufferRef = useRef([]);
  const intervalRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    loadGestures();
    startNewSession();
    checkBridge();
    const bridgeInterval = setInterval(checkBridge, 3000);
    return () => {
      clearInterval(bridgeInterval);
      stopRecording();
    };
  }, []);

  const checkBridge = async () => {
    try {
      const res = await fetch('/api/bridge/status');
      const data = await res.json();
      setBridgeStatus(data);
    } catch {
      setBridgeStatus({ connected: false });
    }
  };

  const loadGestures = async () => {
    try {
      const res = await getGestures();
      setGestures(res.data);
      if (res.data.length > 0) {
        setSelectedGesture(res.data[0].id);
        await loadRecordings(res.data[0].id);
      }
    } catch (e) {
      console.error('Failed to load gestures', e);
    }
  };

  const startNewSession = async () => {
    try {
      const res = await startSession();
      setSessionId(res.data.session_id);
    } catch (e) {
      console.error('Failed to start session', e);
    }
  };

  const loadRecordings = async (gestureId) => {
    if (!gestureId) return;
    try {
      const res = await getGestureRecordings(parseInt(gestureId));
      setRecordings(res.data);
    } catch (e) {
      console.error('Failed to load recordings', e);
    }
  };

  const fetchFrameFromBridge = async () => {
    try {
      const res = await fetch('/api/bridge/latest');
      if (res.ok) {
        const data = await res.json();
        return data;
      }
      return null;
    } catch {
      return null;
    }
  };

  const startRecording = async () => {
    if (!selectedGesture) {
      alert('Select a gesture first');
      return;
    }
    if (!bridgeStatus?.connected) {
      alert('Phone not connected. Start sensor-lab and open the tunnel on your phone.');
      return;
    }

    setIsRecording(true);
    setStatus('Recording...');
    setFrameCount(0);
    setRecordingTime(0);
    bufferRef.current = [];

    timerRef.current = setInterval(() => {
      setRecordingTime(t => t + 0.1);
    }, 100);

    intervalRef.current = setInterval(async () => {
      const frame = await fetchFrameFromBridge();
      if (frame) {
        bufferRef.current.push(frame);
        setLatestFrame(frame);
        setFrameCount(bufferRef.current.length);
      }
    }, 33);
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setStatus('Saving...');
    
    clearInterval(intervalRef.current);
    clearInterval(timerRef.current);
    intervalRef.current = null;
    timerRef.current = null;

    const frames = bufferRef.current;
    if (frames.length < 5) {
      setStatus('Too short (need at least 5 frames)');
      return;
    }

    try {
      const framesWithIndex = frames.map((f, i) => ({
        ...f,
        frame_index: i,
        timestamp: f.timestamp || i / 30
      }));
      
      await saveRecording(parseInt(selectedGesture), sessionId, framesWithIndex);
      setStatus(`Saved ${frames.length} frames`);
      await loadRecordings(selectedGesture);
    } catch (e) {
      console.error('Failed to save', e);
      setStatus('Error saving');
    }

    bufferRef.current = [];
  };

  const handleDeleteRecording = async (id) => {
    if (!window.confirm('Delete this recording?')) return;
    setDeleting(true);
    try {
      await deleteRecording(id);
      await loadRecordings(selectedGesture);
    } catch (e) {
      alert('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!selectedGesture) return;
    if (!window.confirm('Delete ALL recordings for this gesture?')) return;
    setDeleting(true);
    try {
      await deleteAllRecordings(parseInt(selectedGesture));
      await loadRecordings(selectedGesture);
    } catch (e) {
      alert('Failed to delete all');
    } finally {
      setDeleting(false);
    }
  };

  const handleGestureChange = async (gestureId) => {
    setSelectedGesture(gestureId);
    await loadRecordings(gestureId);
  };

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Record Data</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            {bridgeStatus?.connected ? 'Phone connected' : 'Phone disconnected'}
          </p>
        </div>
        <PhoneOrientation accel={latestFrame} gyro={latestFrame} size={60} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '16px', alignItems: 'center' }}>
        <select 
          value={selectedGesture} 
          onChange={(e) => handleGestureChange(e.target.value)} 
          style={{ flex: 1, minWidth: '140px' }}
        >
          <option value="">Select gesture...</option>
          {gestures.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button onClick={startNewSession} style={{ padding: '6px 12px' }}>
          New Session
        </button>
      </div>

      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '20px', 
        marginTop: '16px',
        padding: '16px',
        background: 'var(--bg-primary)',
        borderRadius: '8px',
        border: isRecording ? '2px solid #ef4444' : '1px solid var(--border)'
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
            {isRecording ? 'Recording...' : 'Ready'}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            {isRecording ? `${formatTime(recordingTime)} · ${frameCount} frames` : status}
          </div>
        </div>
        <div>
          {!isRecording ? (
            <button 
              className="primary" 
              onClick={startRecording} 
              disabled={!selectedGesture || !bridgeStatus?.connected || deleting}
              style={{ padding: '10px 28px' }}
            >
              Start
            </button>
          ) : (
            <button 
              className="danger" 
              onClick={stopRecording}
              style={{ padding: '10px 28px' }}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>
            Recordings ({recordings.length})
          </h3>
          {recordings.length > 0 && (
            <button 
              onClick={handleDeleteAll}
              disabled={deleting}
              style={{ padding: '4px 12px', fontSize: '12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px' }}
            >
              Delete All
            </button>
          )}
        </div>
        {recordings.length === 0 ? (
          <div className="empty" style={{ padding: '20px' }}>No recordings for this gesture.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
            {recordings.slice().reverse().map((r, idx) => {
              const date = new Date(r.created_at);
              return (
                <div key={r.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'var(--bg-primary)',
                  borderRadius: '6px',
                  border: '1px solid var(--border)'
                }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '13px' }}>
                    <span style={{ fontWeight: '500', color: 'var(--text-muted)' }}>#{recordings.length - idx}</span>
                    <span>{r.gesture?.name || 'Unknown'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{r.frames?.length || 0} frames</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      {date.toLocaleTimeString()}
                    </span>
                  </div>
                  <button 
                    onClick={() => handleDeleteRecording(r.id)}
                    disabled={deleting}
                    style={{ 
                      padding: '2px 10px', 
                      fontSize: '12px', 
                      background: 'transparent', 
                      border: '1px solid #ef4444', 
                      color: '#ef4444',
                      borderRadius: '4px'
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default RecordingUI;
