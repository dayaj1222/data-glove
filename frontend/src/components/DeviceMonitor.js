import React, { useEffect, useRef, useState } from 'react';
import {
  deviceStatus, devicePorts, deviceOpen, deviceClose, deviceReset, deviceSend,
  deviceCodeList, deviceCodeRead, deviceCodeWrite, deviceCodeNew,
  deviceFlash,
} from '../api';

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 74880, 115200, 230400];

function Bar({ label, value, max = 1023 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="dev-bar-row">
      <span className="dev-bar-label">{label}</span>
      <div className="dev-bar-track">
        <div className="dev-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="dev-bar-value">{typeof value === 'number' ? value.toFixed(0) : '-'}</span>
    </div>
  );
}

function Axis({ label, v }) {
  const f = (n) => (typeof n === 'number' ? n.toFixed(2) : '-');
  return (
    <div className="dev-axis">
      <span className="dev-axis-label">{label}</span>
      <span className="dev-axis-vals">{f(v?.[0])} / {f(v?.[1])} / {f(v?.[2])}</span>
    </div>
  );
}

function DeviceMonitor() {
  const [status, setStatus] = useState(null);
  const [ports, setPorts] = useState([]);
  const [port, setPort] = useState('/dev/ttyUSB0');
  const [baud, setBaud] = useState(115200);
  const [logs, setLogs] = useState([]);
  const [frame, setFrame] = useState(null);
  const [tab, setTab] = useState('logs');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sendText, setSendText] = useState('');

  // code editor
  const [files, setFiles] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [code, setCode] = useState('');
  const [dirty, setDirty] = useState(false);

  // flash
  const [flashLog, setFlashLog] = useState([]);
  const [flashing, setFlashing] = useState(false);

  const logBoxRef = useRef(null);
  const esRef = useRef(null);

  // ---- status polling + port list
  useEffect(() => {
    refreshStatus();
    loadPorts();
    const iv = setInterval(refreshStatus, 300);  // ~3 Hz status refresh
    return () => clearInterval(iv);
    // eslint-disable-next-line
  }, []);

  const refreshStatus = async () => {
    try {
      const { data } = await deviceStatus();
      setStatus(data);
      if (data.latest_frame) setFrame(data.latest_frame);
    } catch (e) {
      setStatus({ connected: false, last_error: String(e) });
    }
  };

  const loadPorts = async () => {
    try {
      const { data } = await devicePorts();
      setPorts(data.ports || []);
      if (data.default) setPort(data.default);
    } catch (e) {
      /* ignore */
    }
  };

  // ---- SSE log stream
  useEffect(() => {
    const es = new EventSource('/api/device/logs/stream');
    esRef.current = es;
    es.addEventListener('log', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        // Backend now batches log entries into one event.
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        setLogs((prev) => {
          const next = prev.concat(entries);
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch (e) { /* ignore */ }
    });
    es.addEventListener('frame', (ev) => {
      try {
        setFrame(JSON.parse(ev.data));
      } catch (e) { /* ignore */ }
    });
    es.onerror = () => { /* browser auto-reconnects */ };
    return () => es.close();
  }, []);

  // autoscroll logs
  useEffect(() => {
    if (tab === 'logs' && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs, tab]);

  const flashMsg = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 4000);
  };

  const doOpen = async () => {
    setBusy(true);
    try {
      await deviceOpen(port, baud);
      flashMsg(`Opened ${port} @ ${baud}`);
      refreshStatus();
    } catch (e) {
      flashMsg('Open failed: ' + (e.response?.data?.detail || e.message));
    } finally { setBusy(false); }
  };

  const doClose = async () => {
    setBusy(true);
    try { await deviceClose(); flashMsg('Port closed'); refreshStatus(); }
    catch (e) { flashMsg('Close failed: ' + e.message); }
    finally { setBusy(false); }
  };

  const doReset = async (bootloader) => {
    setBusy(true);
    try { await deviceReset(bootloader); flashMsg(bootloader ? 'Reset into bootloader' : 'Reset sent'); }
    catch (e) { flashMsg('Reset failed: ' + e.message); }
    finally { setBusy(false); }
  };

  const doSend = async () => {
    if (!sendText) return;
    try { await deviceSend(sendText); setSendText(''); }
    catch (e) { flashMsg('Send failed: ' + e.message); }
  };

  // ---- code tab
  const loadFiles = async () => {
    try {
      const { data } = await deviceCodeList();
      setFiles(data.files || []);
    } catch (e) { flashMsg('List files failed: ' + e.message); }
  };

  const openFile = async (path) => {
    try {
      const { data } = await deviceCodeRead(path);
      setCurrentFile(path);
      setCode(data.content);
      setDirty(false);
      setTab('code');
    } catch (e) { flashMsg('Read failed: ' + e.message); }
  };

  const saveFile = async () => {
    if (!currentFile) return;
    try {
      await deviceCodeWrite(currentFile, code);
      setDirty(false);
      flashMsg(`Saved ${currentFile}`);
    } catch (e) { flashMsg('Save failed: ' + e.message); }
  };

  const newSketch = async () => {
    try {
      const { data } = await deviceCodeNew();
      flashMsg(`Scaffolded ${data.path}`);
      loadFiles();
      openFile(data.path);
    } catch (e) { flashMsg('Scaffold failed: ' + e.message); }
  };

  // ---- flash
  const doFlash = async () => {
    setFlashing(true);
    setFlashLog([]);
    setTab('flash');
    try {
      await deviceFlash({ port });
      const es = new EventSource('/api/device/flash/stream');
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.line) setFlashLog((prev) => [...prev, d.line]);
        } catch (e) { /* ignore */ }
      };
      es.addEventListener('done', (ev) => {
        let ok = false;
        try { ok = JSON.parse(ev.data).ok; } catch (e) { /* ignore */ }
        setFlashLog((prev) => [...prev, ok ? '=== FLASH OK ===' : '=== FLASH FAILED ===']);
        setFlashing(false);
        es.close();
        refreshStatus();
      });
      es.onerror = () => { es.close(); setFlashing(false); };
    } catch (e) {
      setFlashLog((prev) => [...prev, 'Flash request failed: ' + (e.response?.data?.detail || e.message)]);
      setFlashing(false);
    }
  };

  const wifi = status?.wifi || {};
  const chip = status?.chip || {};
  const connected = status?.connected;

  return (
    <div className="card">
      <div className="dev-header">
        <h2>ESP32 Monitor</h2>
        <span className={`dev-badge ${connected ? 'on' : 'off'}`}>
          {connected ? `● ${status?.port} @ ${status?.baud}` : '○ disconnected'}
        </span>
      </div>

      {msg && <div className="dev-toast">{msg}</div>}

      {/* connection bar */}
      <div className="dev-connbar">
        <select value={port} onChange={(e) => setPort(e.target.value)}>
          {ports.length === 0 && <option value={port}>{port}</option>}
          {ports.map((p) => (
            <option key={p.device} value={p.device}>
              {p.device}{p.description ? ` — ${p.description}` : ''}
            </option>
          ))}
        </select>
        <select value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
          {BAUD_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button className="btn" disabled={busy} onClick={doOpen}>Open</button>
        <button className="btn secondary" disabled={busy || !connected} onClick={doClose}>Close</button>
        <button className="btn secondary" disabled={busy} onClick={() => doReset(false)}>Reset</button>
        <button className="btn secondary" disabled={busy} onClick={() => doReset(true)}>Bootloader</button>
        <button className="btn" disabled={flashing} onClick={doFlash}>{flashing ? 'Flashing…' : 'Flash Firmware'}</button>
      </div>

      {/* status strip */}
      <div className="dev-strip">
        <div className="dev-stat"><label>Chip</label><b>{chip.chip || '—'}</b></div>
        <div className="dev-stat"><label>Reset</label><b>{chip.reset || '—'}</b></div>
        <div className="dev-stat"><label>WiFi SSID</label><b>{wifi.ssid || '—'}</b></div>
        <div className="dev-stat"><label>WiFi</label><b className={wifi.connected ? 'ok' : 'warn'}>{wifi.connected ? 'connected' : 'not connected'}</b></div>
        <div className="dev-stat"><label>IP</label><b>{wifi.ip || '—'}</b></div>
        <div className="dev-stat"><label>Bytes</label><b>{status?.total_bytes ?? 0}</b></div>
        <div className="dev-stat"><label>Frames</label><b>{status?.frames_seen ?? 0}</b></div>
      </div>
      {status?.last_error && <div className="dev-err">Last error: {status.last_error}</div>}

      {/* tabs */}
      <div className="dev-tabs">
        {['logs', 'sensors', 'code', 'flash'].map((t) => (
          <button key={t} className={`dev-tab ${tab === t ? 'active' : ''}`} onClick={() => { setTab(t); if (t === 'code') loadFiles(); }}>
            {t === 'logs' ? 'Serial Logs' : t === 'sensors' ? 'Sensors' : t === 'code' ? 'Firmware Code' : 'Flash Output'}
          </button>
        ))}
      </div>

      {tab === 'logs' && (
        <div>
          <div className="dev-logbox" ref={logBoxRef}>
            {logs.length === 0 && <div className="dev-empty">No serial output yet. Open the port and hit Reset.</div>}
            {logs.map((l, i) => (
              <div key={i} className={`dev-logline lvl-${l.level}`}>
                <span className="dev-logtime">{new Date(l.t * 1000).toLocaleTimeString()}</span>
                <span className="dev-logtext">{l.text}</span>
              </div>
            ))}
          </div>
          <div className="dev-sendrow">
            <input value={sendText} onChange={(e) => setSendText(e.target.value)} placeholder="send a line to the device…" onKeyDown={(e) => e.key === 'Enter' && doSend()} />
            <button className="btn" onClick={doSend} disabled={!connected}>Send</button>
            <button className="btn secondary" onClick={() => setLogs([])}>Clear</button>
          </div>
        </div>
      )}

      {tab === 'sensors' && (
        <div className="dev-sensors">
          {!frame && <div className="dev-empty">No sensor frames parsed yet. Frames appear when the firmware writes the 58-byte binary packet (5×uint16 flex + 9×float32 IMU).</div>}
          {frame && (
            <>
              <div className="dev-section">
                <h4>Flex (raw ADC 0–1023)</h4>
                {frame.flex.map((v, i) => <Bar key={i} label={`F${i}`} value={v} />)}
              </div>
              <div className="dev-section">
                <h4>IMU (x / y / z)</h4>
                <Axis label="Accel" v={frame.accel} />
                <Axis label="Gyro" v={frame.gyro} />
                <Axis label="Mag" v={frame.mag} />
              </div>
              <div className="dev-raw">raw: {frame.raw_hex}</div>
            </>
          )}
        </div>
      )}

      {tab === 'code' && (
        <div className="dev-code">
          <div className="dev-coderow">
            <button className="btn secondary" onClick={loadFiles}>Refresh</button>
            <button className="btn secondary" onClick={newSketch}>Scaffold Template</button>
            <span className="dev-codefile">{currentFile || 'no file selected'}{dirty ? ' *' : ''}</span>
            <button className="btn" disabled={!currentFile || !dirty} onClick={saveFile}>Save</button>
          </div>
          <div className="dev-codebody">
            <div className="dev-filelist">
              {files.length === 0 && <div className="dev-empty small">No files</div>}
              {files.map((f) => (
                <button key={f.path} className={`dev-file ${currentFile === f.path ? 'active' : ''}`} onClick={() => openFile(f.path)}>
                  {f.path}<span className="dev-filesize">{f.size}b</span>
                </button>
              ))}
            </div>
            <textarea className="dev-editor" value={code} spellCheck={false} onChange={(e) => { setCode(e.target.value); setDirty(true); }} placeholder="Select or scaffold a firmware file…" />
          </div>
        </div>
      )}

      {tab === 'flash' && (
        <div className="dev-logbox flashbox">
          {flashLog.length === 0 && <div className="dev-empty">No flash run yet. Click “Flash Firmware”.</div>}
          {flashLog.map((l, i) => <div key={i} className="dev-logline"><span className="dev-logtext">{l}</span></div>)}
        </div>
      )}
    </div>
  );
}

export default DeviceMonitor;
