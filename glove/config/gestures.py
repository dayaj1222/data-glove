"""Gesture threshold configuration for ThresholdRecognizer.

Each gesture maps to flex thresholds (5 values, each (lo, hi)) and/or IMU thresholds.
Flex values: 0-1023 (raw ADC). IMU keys: accel_x/y/z, gyro_x/y/z, mag_x/y/z.
"""

GESTURE_CONFIG = {
    # "fist": {
    #     "flex": [(0, 300), (0, 300), (0, 300), (0, 300), (0, 300)],
    #     "imu": None
    # },
    # "open_hand": {
    #     "flex": [(700, 1023), (700, 1023), (700, 1023), (700, 1023), (700, 1023)],
    #     "imu": None
    # },
    # "point": {
    #     "flex": [(800, 1023), (0, 200), (0, 200), (0, 200), (0, 200)],
    #     "imu": None
    # },
    # "swipe_left": {
    #     "flex": None,
    #     "imu": {"gyro_z": (-5.0, -0.5)}
    # },
    # "swipe_right": {
    #     "flex": None,
    #     "imu": {"gyro_z": (0.5, 5.0)}
    # },
}
