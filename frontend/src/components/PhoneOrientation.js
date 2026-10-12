import React from 'react';

function PhoneOrientation({ accel, gyro, size = 80 }) {
  const getOrientation = () => {
    if (!accel) return { roll: 0, pitch: 0 };
    const ax = accel.accel_x || 0;
    const ay = accel.accel_y || 0;
    const az = accel.accel_z || 0;
    const roll = Math.atan2(ay, az) * 180 / Math.PI;
    const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * 180 / Math.PI;
    return { roll, pitch };
  };

  const { roll, pitch } = getOrientation();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      background: 'var(--bg-primary)',
      borderRadius: '12px',
      padding: '16px',
      border: '1px solid var(--border)',
      minWidth: size + 40,
    }}>
      <div style={{
        width: size,
        height: size * 1.5,
        background: 'linear-gradient(145deg, #1a1a2e, #0f0f1a)',
        borderRadius: '12px',
        border: '2px solid #6366f1',
        position: 'relative',
        transform: `rotateX(${pitch}deg) rotateZ(${roll}deg)`,
        transition: 'transform 0.1s ease-out',
        boxShadow: '0 8px 32px rgba(99,102,241,0.15)'
      }}>
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: size * 0.25,
          height: '6px',
          background: '#22c55e',
          borderRadius: '3px',
          boxShadow: '0 0 12px rgba(34,197,94,0.3)'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: size * 0.35,
          height: '6px',
          background: '#ef4444',
          borderRadius: '3px',
          boxShadow: '0 0 12px rgba(239,68,68,0.2)'
        }} />
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: '10px',
          color: 'var(--text-muted)',
          textAlign: 'center'
        }}>
          {gyro && gyro.gyro_z !== undefined && (
            <span>ω: {(gyro.gyro_z * 10).toFixed(1)}</span>
          )}
        </div>
      </div>
      <div style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        marginTop: '8px',
        display: 'flex',
        gap: '12px'
      }}>
        <span>roll: {roll.toFixed(1)}°</span>
        <span>pitch: {pitch.toFixed(1)}°</span>
      </div>
    </div>
  );
}

export default PhoneOrientation;
