import random
import time
from typing import Optional

from .base import Transport


class MockTransport(Transport):
    """Mock transport: generates synthetic sensor frames for testing."""

    def __init__(self, frame_rate: float = 30.0):
        self.frame_rate = frame_rate
        self._connected = False
        self._start_time = 0.0
        self._counter = 0

    def connect(self) -> None:
        self._connected = True
        self._start_time = time.time()
        self._counter = 0

    def recv(self, timeout: Optional[float] = None) -> Optional[bytes]:
        if not self._connected:
            return None
        
        # Generate a synthetic frame in the SimpleBinaryProtocol format
        # 5 uint16 flex + 12 floats (accel, gyro, mag)
        import struct
        
        self._counter += 1
        t = time.time() - self._start_time
        
        # Flex: sine waves to simulate finger bending
        flex = [
            int(500 + 400 * (1 + (i % 2) * 0.5) * (0.5 + 0.5 * (t * 0.5 + i * 1.2) ** 2 % 1.0))
            for i in range(5)
        ]
        # Clamp to 0-1023
        flex = [min(1023, max(0, v)) for v in flex]
        
        # IMU: slight motion
        accel = (0.0, -9.8 + 0.5 * (t * 0.3) % 1.0, 0.0)
        gyro = (0.0, 0.0, 0.2 * (t * 0.7) % 1.0)
        mag = (0.5, 0.2, 0.8)
        
        # Pack: <5H12f
        imu_flat = list(accel) + list(gyro) + list(mag)
        data = struct.pack("<5H9f", *flex, *imu_flat)
        return data

    def close(self) -> None:
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected
