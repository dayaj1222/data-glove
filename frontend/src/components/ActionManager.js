import React, { useState, useEffect } from 'react';
import { getActions, getGestures } from '../api';

function ActionManager() {
  const [actions, setActions] = useState([]);
  const [gestures, setGestures] = useState([]);
  const [bindings, setBindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    try {
      const [a, g] = await Promise.all([getActions(), getGestures()]);
      setActions(a.data || []);
      setGestures(g.data || []);
      
      const resp = await fetch('/api/bindings');
      const b = resp.ok ? await resp.json() : [];
      setBindings(Array.isArray(b) ? b : []);
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const setBinding = async (gestureId, actionId) => {
    if (saving) return;
    setSaving(true);
    
    try {
      const existing = bindings.find(b => b.gesture_id === gestureId);
      if (existing) {
        await fetch(`/api/bindings/${existing.id}`, { method: 'DELETE' });
      }
      
      if (actionId && actionId !== '') {
        const res = await fetch(
          `/api/bindings?gesture_id=${Number(gestureId)}&action_id=${Number(actionId)}&threshold=0.7`,
          { method: 'POST' }
        );
        if (!res.ok) {
          const text = await res.text();
          console.error('Bind error:', text);
          alert('Failed to bind: ' + text);
        }
      }
      
      const resp = await fetch('/api/bindings');
      const b = resp.ok ? await resp.json() : [];
      setBindings(Array.isArray(b) ? b : []);
    } catch (e) {
      console.error('Error:', e);
      alert('Failed to save binding');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card">Loading...</div>;

  const getBoundAction = (gestureId) => {
    const b = bindings.find(b => b.gesture_id === gestureId);
    return b ? b.action_id : '';
  };

  return (
    <div className="card">
      <h2>Bind Gestures to Actions</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
        Select an action for each gesture. When the gesture is detected, the action runs.
      </p>

      <div style={{ marginTop: '12px' }}>
        {gestures.map(g => (
          <div key={g.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            borderRadius: '4px',
            marginBottom: '4px'
          }}>
            <span style={{ width: '120px', fontWeight: '500' }}>{g.name}</span>
            <select
              value={getBoundAction(g.id)}
              onChange={e => setBinding(g.id, e.target.value)}
              disabled={saving}
              style={{ flex: 1, padding: '6px 10px' }}
            >
              <option value="">— None —</option>
              {actions.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {saving && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>saving...</span>}
          </div>
        ))}
        {gestures.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No gestures. Create one first.</p>}
        {actions.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No actions. Create one in the Actions tab.</p>}
      </div>
    </div>
  );
}

export default ActionManager;
