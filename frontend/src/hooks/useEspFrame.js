import { useEffect, useRef, useState } from 'react';

/**
 * Live ESP32 sensor frame, polled from the backend.
 *
 * Both the recording and prediction views need the same thing: the newest
 * glove frame, as fast as the backend can serve it. This hook owns that
 * polling so the components stay presentational.
 *
 * @param {boolean} enabled - pause polling when false
 * @param {number}  intervalMs - poll interval (default 33ms ~ 30Hz)
 */
export function useEspFrame(enabled = true, intervalMs = 33) {
  const [frame, setFrame] = useState(null);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/device/frame');
        if (!res.ok) {
          if (!cancelled) setConnected(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setConnected(!!data.connected);
        if (data.frame) setFrame(data.frame);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };

    timerRef.current = setInterval(poll, intervalMs);
    poll(); // immediate first sample

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [enabled, intervalMs]);

  return { frame, connected };
}

/** Latest frame as a flat object, or null. */
export function useLatestFrame(enabled = true) {
  return useEspFrame(enabled).frame;
}
