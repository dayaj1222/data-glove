from abc import ABC, abstractmethod
from typing import Optional, Dict, Any


class Frame:
    """A parsed sensor frame."""

    def __init__(self, flex: tuple, imu: Dict[str, float], timestamp: float, raw: Optional[bytes] = None):
        self.flex = flex          # (f0, f1, f2, f3, f4) normalized or raw
        self.imu = imu            # {'accel': (x,y,z), 'gyro': ..., 'mag': ...}
        self.timestamp = timestamp
        self.raw = raw

    def __repr__(self) -> str:
        return f"Frame(flex={self.flex}, imu=..., ts={self.timestamp:.3f})"


class Protocol(ABC):
    """Abstract protocol: parses raw bytes into frames."""

    @abstractmethod
    def parse(self, data: bytes) -> Optional[Frame]:
        """Parse raw bytes into a Frame. Returns None if invalid."""
        ...
