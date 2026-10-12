import requests
import time
from typing import Optional, Dict, Any

class SensorLabBridge:
    """Bridge from sensor-lab HTTP API to glove frame format."""

    def __init__(self, base_url: str = "http://localhost:8001"):
        self.base_url = base_url

    def get_readings(self, limit: int = 50) -> list:
        try:
            resp = requests.get(f"{self.base_url}/api/readings", params={"limit": limit}, timeout=2)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
            return []
        except Exception as e:
            print(f"[Bridge] Error: {e}")
            return []

    def get_latest_grouped(self) -> Optional[Dict[str, Any]]:
        readings = self.get_readings(limit=50)
        if not readings:
            return None

        latest = {}
        for r in readings:
            sensor_type = r.get("type")
            if sensor_type in ["accelerometer", "gyroscope", "magnetometer"]:
                t = r.get("t", 0)
                if sensor_type not in latest or latest[sensor_type].get("t", 0) < t:
                    latest[sensor_type] = r

        if not latest:
            return None

        frame = {
            "flex_0": 500,
            "flex_1": 500,
            "flex_2": 500,
            "flex_3": 500,
            "flex_4": 500,
            "accel_x": 0.0,
            "accel_y": 0.0,
            "accel_z": 0.0,
            "gyro_x": 0.0,
            "gyro_y": 0.0,
            "gyro_z": 0.0,
            "mag_x": 0.0,
            "mag_y": 0.0,
            "mag_z": 0.0,
            "timestamp": time.time()
        }

        for sensor_type, data in latest.items():
            values = data.get("values", {})
            t = data.get("t", 0) / 1000.0
            frame["timestamp"] = t

            if sensor_type == "accelerometer":
                frame["accel_x"] = values.get("x", 0.0)
                frame["accel_y"] = values.get("y", 0.0)
                frame["accel_z"] = values.get("z", 0.0)
            elif sensor_type == "gyroscope":
                frame["gyro_x"] = values.get("x", 0.0)
                frame["gyro_y"] = values.get("y", 0.0)
                frame["gyro_z"] = values.get("z", 0.0)
            elif sensor_type == "magnetometer":
                frame["mag_x"] = values.get("x", 0.0)
                frame["mag_y"] = values.get("y", 0.0)
                frame["mag_z"] = values.get("z", 0.0)

        return frame

    def stream_frames(self, duration: float = 5.0, interval: float = 0.033):
        start = time.time()
        while time.time() - start < duration:
            frame = self.get_latest_grouped()
            if frame:
                yield frame
            time.sleep(interval)

    def get_latest_frame(self) -> Optional[Dict[str, Any]]:
        return self.get_latest_grouped()
