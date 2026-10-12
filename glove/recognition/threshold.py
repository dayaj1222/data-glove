from typing import Optional, Dict, List, Tuple

from .base import Recognizer
from glove.protocol.base import Frame


class ThresholdRecognizer(Recognizer):
    """Threshold-based recognizer. Config: gesture_id -> (flex_thresholds, imu_thresholds)."""

    def __init__(self, config: Dict[str, Dict[str, any]]):
        """
        config = {
            "fist": {
                "flex": [(0, 200), (0, 200), (0, 200), (0, 200), (0, 200)],  # all fingers curled
                "imu": None  # no IMU constraint
            },
            "point": {
                "flex": [(800, 1023), (0, 200), (0, 200), (0, 200), (0, 200)],  # index extended
                "imu": None
            },
            "swipe_left": {
                "flex": None,
                "imu": {"gyro_z": (-10.0, -2.0)}  # fast rotation around Z
            }
        }
        """
        self.config = config

    def recognize(self, frame: Frame) -> Optional[str]:
        for gesture_id, constraints in self.config.items():
            if self._matches(frame, constraints):
                return gesture_id
        return None

    def _matches(self, frame: Frame, constraints: Dict) -> bool:
        flex_ok = True
        imu_ok = True

        if constraints.get("flex"):
            flex_thresholds = constraints["flex"]
            for i, (lo, hi) in enumerate(flex_thresholds):
                if i >= len(frame.flex):
                    flex_ok = False
                    break
                if not (lo <= frame.flex[i] <= hi):
                    flex_ok = False
                    break

        if constraints.get("imu") and flex_ok:
            for key, (lo, hi) in constraints["imu"].items():
                # key like "accel_x", "gyro_z", "mag_y"
                axis, component = key.split("_")
                val = getattr(frame.imu.get(axis), component, None)
                if val is None:
                    imu_ok = False
                    break
                if not (lo <= val <= hi):
                    imu_ok = False
                    break

        return flex_ok and imu_ok
