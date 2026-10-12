import React, { useState, useEffect } from 'react';
import { getGestures, createGesture, deleteGesture } from '../api';

function GestureManager() {
  const [gestures, setGestures] = useState([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadGestures(); }, []);

  const loadGestures = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getGestures();
      setGestures(res.data);
    } catch (e) {
      setError(e.message || 'Failed to load gestures');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await createGesture(newName.trim());
      setNewName('');
      await loadGestures();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to create gesture');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this gesture?')) return;
    try {
      await deleteGesture(id);
      await loadGestures();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to delete');
    }
  };

  if (loading) return <div className="card"><div className="empty">Loading...</div></div>;

  return (
    <div className="card">
      <h2>Gestures</h2>
      <p>Define the gestures you want to train. Each gesture needs 10-20 recordings.</p>
      {error && <div style={{color:'#ef4444', marginBottom:'12px'}}>⚠ {error}</div>}
      <div className="flex mb-12">
        <input type="text" placeholder="Gesture name (e.g., fist, point)" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
        <button className="primary" onClick={handleCreate}>Add Gesture</button>
      </div>
      {gestures.length === 0 ? <div className="empty">No gestures defined yet.</div> : (
        <div className="grid">
          {gestures.map(g => (
            <div key={g.id} className="item">
              <span className="name">{g.name}</span>
              <div className="flex" style={{gap:'6px'}}>
                <span className="badge">{g.recordings?.length || 0} recs</span>
                <button className="danger" onClick={() => handleDelete(g.id)} style={{padding:'2px 8px', fontSize:'12px'}}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GestureManager;
