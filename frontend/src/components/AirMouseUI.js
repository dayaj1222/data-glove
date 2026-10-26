import { useCallback, useEffect, useRef, useState } from 'react';
import { useEspFrame } from '../hooks/useEspFrame';

const POLL_MS = 200;
const DEBOUNCE_MS = 150;
const FALLBACK_ACTIONS = [
  'none', 'left', 'right', 'middle', 'mod_left', 'mod_right',
  'scroll', 'back', 'forward', 'escape',
];
const ACTION_LABELS = {
  none: 'Nothing',
  left: 'Left click/drag',
  right: 'Right click',
  middle: 'Middle click',
  mod_left: 'Drag window (Super+left)',
  mod_right: 'Resize window (Super+right)',
  scroll: 'Scroll',
  back: 'Back (Alt+Left)',
  forward: 'Forward (Alt+Right)',
  escape: 'Escape',
};
const MOD_KEYS = ['SUPER', 'ALT', 'CTRL', 'SHIFT'];
const CHANNELS = [
  { value: 0, label: 'flex_0 (D34)' },
  { value: 1, label: 'flex_1 (D35)' },
];
const MODES = [
  { value: 'above', label: 'flex above threshold' },
  { value: 'below', label: 'flex below threshold' },
];
// 3x3 gesture grid: palm zone (row) x finger gesture (column).
const ZONES = [
  { zone: 'down', label: 'Palm DOWN', capture: 'Capture palm DOWN' },
  { zone: 'side', label: 'Palm SIDEWAYS', capture: 'Capture palm SIDEWAYS (left)' },
  { zone: 'up', label: 'Palm UP', capture: 'Capture palm UP' },
];
// Config keys the backend rewrites when both finger poses are captured.
const FINGER_KEYS = [
  'primary_threshold', 'secondary_threshold', 'primary_mode', 'secondary_mode',
  'primary_margin', 'secondary_margin',
];
const GESTURES = [
  { gesture: 'A', suffix: 'a', label: 'A alone' },
  { gesture: 'B', suffix: 'b', label: 'B alone' },
  { gesture: 'AB', suffix: 'ab', label: 'A + B' },
];
const IDLE = {
  enabled: false, error: null, mode: 'down', zone: 'down', gesture: '-', action: 'none',
  held: false, pitch: 0, roll: 0, rate_x: 0, rate_y: 0, moved: 0,
  calibrated: { down: false, side: false, up: false },
  angles: { down: null, side: null, up: null },
  a_bent: false, b_bent: false, flex_a: 0, flex_b: 0,
};

/** POST helper: throws with the server's {detail} message on HTTP errors. */
async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail ? String(data.detail) : `HTTP ${res.status}`);
  }
  return data;
}

/** Numeric slider. Optional `live` shows a current reading next to the value. */
function Slider({ label, value, min, max, step, digits = 0, unit = '', live, onChange }) {
  return (
    <label className='arc-slider'>
      {label} <b>{Number(value).toFixed(digits)}</b>{unit && ` ${unit}`}
      {live !== undefined && <> (now {live})</>}
      <input type='range' min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}

/** Dropdown with a label in front. */
function Select({ label, value, options, onChange }) {
  return (
    <label className='arc-slider'>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Checkbox row. */
function Toggle({ label, checked, onChange }) {
  return (
    <label className='arc-toggle'>
      <input type='checkbox' checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Small plain heading that spans the whole settings grid. */
function GroupTitle({ children }) {
  return <h4 style={{ gridColumn: '1 / -1', margin: '6px 0 0' }}>{children}</h4>;
}

function AirMouseUI() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [actions, setActions] = useState(FALLBACK_ACTIONS);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(null); // key of the calibration request in flight
  const [localError, setLocalError] = useState(null);
  const { frame } = useEspFrame(true);

  const loadedRef = useRef(false);
  const pendingRef = useRef({});
  const timerRef = useRef(null);

  const live = status || IDLE;
  const flexOf = (channel) => (frame ? frame[`flex_${channel}`] : undefined) ?? '—';

  /** Send all queued config changes in one POST. Response updates status only, never the sliders. */
  const flush = useCallback(async () => {
    const body = pendingRef.current;
    pendingRef.current = {};
    timerRef.current = null;
    if (Object.keys(body).length === 0) return;
    try {
      setStatus(await postJson('/api/cursor/config', body));
      setLocalError(null);
    } catch (err) {
      setLocalError(err.message);
    }
  }, []);

  /** Update a setting locally right away, and send it debounced. */
  const updateConfig = useCallback((patch) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    pendingRef.current = { ...pendingRef.current, ...patch };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  const set = (key) => (value) => updateConfig({ [key]: value });

  // Action list for the dropdowns: fetched once on mount, fallback list kept on failure.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cursor/actions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.actions) && data.actions.length > 0) {
          setActions(data.actions);
        }
      })
      .catch(() => {
        // keep the fallback list
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll live status. Config is only copied from the server on the first load.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/cursor');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStatus(data);
        if (!loadedRef.current) {
          loadedRef.current = true;
          setConfig(data.config);
        }
      } catch {
        // keep the last known status
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // On unmount, drop the debounce timer but still send any queued change.
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (Object.keys(pendingRef.current).length > 0) flush();
  }, [flush]);

  /** Enable or disable the cursor. Also re-syncs settings from the server. */
  const setEnabled = async (on) => {
    setBusy(true);
    setLocalError(null);
    try {
      await flush(); // do not lose a setting that is still waiting on the debounce
      const data = await postJson(on ? '/api/cursor/enable' : '/api/cursor/disable');
      setStatus(data);
      setConfig(data.config);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /** Run one calibration request. `key` marks the clicked button while it is in flight. */
  const runCapture = async (key, path, onDone) => {
    setCapturing(key);
    setLocalError(null);
    try {
      const data = await postJson(path);
      setStatus(data);
      if (onDone) onDone(data);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setCapturing(null);
    }
  };

  const captureZone = (zone) => runCapture(`zone:${zone}`, `/api/cursor/calibrate/${zone}`);
  const resetPoses = () => runCapture('reset', '/api/cursor/calibrate/reset');

  /** Backend sets thresholds, modes and margins itself; copy those back into the sliders. */
  const captureFingers = async (kind) => {
    await flush(); // send queued slider changes first so they do not overwrite the new thresholds
    await runCapture(`fingers:${kind}`, `/api/cursor/fingers/${kind}`, (data) => {
      const c = data.config;
      if (c) setConfig((prev) => ({ ...prev, ...Object.fromEntries(FINGER_KEYS.map((k) => [k, c[k]])) }));
    });
  };

  const errorText = localError || live.error;
  const fmt = (n, digits = 1) => (typeof n === 'number' ? n.toFixed(digits) : '—');
  const clutch = live.mode === 'clutch';
  const calibrated = live.calibrated || {};
  const angles = live.angles || {};
  const actionOptions = actions.map((a) => ({ value: a, label: ACTION_LABELS[a] || a }));
  const channelOptions = CHANNELS.map((c) => ({ value: c.value, label: c.label }));
  const modeOptions = MODES;
  const modOptions = MOD_KEYS.map((k) => ({ value: k, label: k }));

  return (
    <div className='arc-wrap'>
      <div className='card arc-card'>
        <div className='arc-head'>
          <div>
            <h2>Air Mouse</h2>
            <p>
              Nine gestures = three palm positions x three finger gestures.
              Palm position is read when a gesture starts: DOWN, SIDEWAYS (either side) or UP, judged from wrist roll.
              Finger gestures: A = primary finger bent, B = secondary finger bent, AB = both bent.
              The palm position is held until the fingers relax.
              Point the finger down to clutch: the cursor and buttons freeze, like lifting a mouse.
              The cursor follows how fast the finger turns. Each cell below picks the action for that gesture.
            </p>
          </div>
        </div>

        <div className='arc-controls'>
          {live.enabled ? (
            <button className='btn secondary' onClick={() => setEnabled(false)} disabled={busy}>Disable</button>
          ) : (
            <button className='btn' onClick={() => setEnabled(true)} disabled={busy}>Enable</button>
          )}
          <span className='arc-stat'>
            <label>status</label>
            <b className={live.enabled ? 'ok' : ''}>{live.enabled ? 'ENABLED' : 'DISABLED'}</b>
          </span>
          <button
            className='btn'
            style={{ background: '#b91c1c' }}
            onClick={() => setEnabled(false)}
            disabled={busy}
          >
            Release all
          </button>
        </div>
        {errorText && <p className='arc-dead'>{errorText}</p>}
        {clutch && <p className='arc-dead' style={{ fontWeight: 700 }}>CLUTCH: finger pointing down, cursor frozen</p>}

        <div className='arc-sensor'>
          <div className='arc-stat' style={clutch ? { borderColor: '#f87171' } : undefined}>
            <label>mode</label>
            <b className={clutch ? 'warn' : ''}>{clutch ? 'CLUTCH' : live.mode}</b>
          </div>
          <div className='arc-stat'><label>zone</label><b>{live.zone}</b></div>
          <div className='arc-stat'><label>gesture</label><b>{live.gesture}</b></div>
          <div className='arc-stat'>
            <label>action</label>
            <b>{ACTION_LABELS[live.action] || live.action}</b>
          </div>
          <div className='arc-stat'><label>held</label><b className={live.held ? 'ok' : ''}>{live.held ? 'down' : 'up'}</b></div>
          <div className='arc-stat'>
            <label>finger A (flex {fmt(live.flex_a, 0)})</label>
            <b className={live.a_bent ? 'ok' : ''}>{live.a_bent ? 'BENT' : 'straight'}</b>
          </div>
          <div className='arc-stat'>
            <label>finger B (flex {fmt(live.flex_b, 0)})</label>
            <b className={live.b_bent ? 'ok' : ''}>{live.b_bent ? 'BENT' : 'straight'}</b>
          </div>
          <div className='arc-stat'><label>pitch</label><b>{fmt(live.pitch)}</b></div>
          <div className='arc-stat'><label>roll</label><b>{fmt(live.roll)}</b></div>
          <div className='arc-stat'><label>rate_x</label><b>{fmt(live.rate_x)}</b></div>
          <div className='arc-stat'><label>rate_y</label><b>{fmt(live.rate_y)}</b></div>
          <div className='arc-stat'><label>moved</label><b>{live.moved}</b></div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <h4 style={{ margin: 0 }}>Setup (do this first)</h4>

          <div>
            <b>1. Palm poses.</b> Hold the hand still in a pose, then click. The palm zone is whichever captured pose the hand is closest to.
            <div className='arc-controls'>
              {ZONES.map((z) => (
                <button
                  key={z.zone}
                  className='btn secondary'
                  onClick={() => captureZone(z.zone)}
                  disabled={capturing !== null}
                >
                  {capturing === `zone:${z.zone}` ? 'Hold still...' : z.capture}
                </button>
              ))}
              <button className='btn secondary' onClick={resetPoses} disabled={capturing !== null}>
                Reset poses
              </button>
            </div>
            <div className='arc-sensor'>
              {ZONES.map((z) => {
                const done = !!calibrated[z.zone];
                const deg = typeof angles[z.zone] === 'number' ? `${Math.round(angles[z.zone])} deg` : '—';
                return (
                  <div key={z.zone} className='arc-stat'>
                    <label>{z.label}, angle {deg}</label>
                    <b className={done ? 'ok' : ''}>{done ? '✓ captured' : 'not set'}</b>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <b>2. Fingers.</b> Hold both fingers straight and click, then hold both bent and click.
            Thresholds are then set automatically halfway between.
            <div className='arc-controls'>
              <button
                className='btn secondary'
                onClick={() => captureFingers('straight')}
                disabled={capturing !== null}
              >
                {capturing === 'fingers:straight' ? 'Hold still...' : 'Capture both fingers STRAIGHT'}
              </button>
              <button
                className='btn secondary'
                onClick={() => captureFingers('bent')}
                disabled={capturing !== null}
              >
                {capturing === 'fingers:bent' ? 'Hold still...' : 'Capture both fingers BENT'}
              </button>
            </div>
          </div>

          <div>
            <b>3. Enable.</b> The cursor stays off until Enable is clicked.
          </div>
        </div>

        {config && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) repeat(3, minmax(0, 1fr))', gap: 8, alignItems: 'center', marginTop: 16 }}>
              <span />
              {GESTURES.map((g) => (
                <div key={g.gesture} style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>{g.label}</div>
              ))}
              {ZONES.map((z) => {
                const rowActive = live.zone === z.zone;
                return (
                  <div key={z.zone} style={{ display: 'contents' }}>
                    <div style={{ fontSize: 13, fontWeight: rowActive ? 700 : 400, color: rowActive ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      {z.label}
                    </div>
                    {GESTURES.map((g) => {
                      const key = `${z.zone}_${g.suffix}`;
                      const active = rowActive && live.gesture === g.gesture;
                      return (
                        <div
                          key={key}
                          style={{
                            border: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                            background: active ? 'var(--bg-primary)' : 'transparent',
                            borderRadius: 8,
                            padding: 4,
                          }}
                        >
                          <select value={config[key]} onChange={(e) => set(key)(e.target.value)} style={{ width: '100%' }}>
                            {actionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className='arc-settings'>
              <GroupTitle>Cursor</GroupTitle>
              <Slider label='Gain' value={config.gain} min={2} max={80} step={1} onChange={set('gain')} />
              <Slider label='Accel' value={config.accel} min={0} max={0.05} step={0.001} digits={3} onChange={set('accel')} />
              <Slider label='Gate' value={config.gate} min={0} max={6} step={0.1} digits={1} onChange={set('gate')} />
              <Toggle label='Invert horizontal' checked={config.invert_x} onChange={set('invert_x')} />
              <Toggle label='Invert vertical' checked={config.invert_y} onChange={set('invert_y')} />

              <GroupTitle>Fingers</GroupTitle>
              <Select label='Primary channel' value={config.primary_channel} options={channelOptions}
                onChange={(v) => set('primary_channel')(parseInt(v, 10))} />
              <Select label='Primary mode' value={config.primary_mode} options={modeOptions} onChange={set('primary_mode')} />
              <Slider label='Primary threshold' value={config.primary_threshold} min={0} max={4095} step={10}
                live={flexOf(config.primary_channel)} onChange={set('primary_threshold')} />
              <Slider label='Primary margin' value={config.primary_margin} min={0} max={100} step={1} onChange={set('primary_margin')} />
              <Select label='Secondary channel' value={config.secondary_channel} options={channelOptions}
                onChange={(v) => set('secondary_channel')(parseInt(v, 10))} />
              <Select label='Secondary mode' value={config.secondary_mode} options={modeOptions} onChange={set('secondary_mode')} />
              <Slider label='Secondary threshold' value={config.secondary_threshold} min={0} max={4095} step={10}
                live={flexOf(config.secondary_channel)} onChange={set('secondary_threshold')} />
              <Slider label='Secondary margin' value={config.secondary_margin} min={0} max={100} step={1} onChange={set('secondary_margin')} />

              <GroupTitle>Palm zones</GroupTitle>
              <Slider label='Sideways from' value={config.roll_side} min={20} max={80} step={1} unit='deg' onChange={set('roll_side')} />
              <Slider label='Palm up from' value={config.roll_up} min={100} max={170} step={1} unit='deg' onChange={set('roll_up')} />
              <Select label='Modifier key' value={config.mod_key} options={modOptions} onChange={set('mod_key')} />

              <GroupTitle>Clutch (finger pointing down)</GroupTitle>
              <Toggle label='Clutch enabled' checked={config.clutch_enabled} onChange={set('clutch_enabled')} />
              <Slider label='Clutch pitch' value={config.clutch_pitch} min={15} max={80} step={1} unit='deg' onChange={set('clutch_pitch')} />

              <GroupTitle>Scroll</GroupTitle>
              <Slider label='Scroll gain' value={config.scroll_gain} min={0.02} max={1} step={0.01} digits={2} onChange={set('scroll_gain')} />
              <Toggle label='Invert scroll' checked={config.invert_scroll} onChange={set('invert_scroll')} />

              <GroupTitle>Click feel</GroupTitle>
              <Slider label='Stabilize' value={config.stabilize_ms} min={0} max={500} step={10} unit='ms' onChange={set('stabilize_ms')} />
              <Slider label='Chord window' value={config.chord_ms} min={30} max={200} step={5} unit='ms' onChange={set('chord_ms')} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AirMouseUI;
