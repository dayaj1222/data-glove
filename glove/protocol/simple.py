import struct
from typing import Optional

from .base import Protocol, Frame


class SimpleBinaryProtocol(Protocol):
    """Simple binary protocol: 
    Format: [flex0:uint16][flex1:uint16][flex2:uint16][flex3:uint16][flex4:uint16]
            [accel_x:float][accel_y:float][accel_z:float]
            [gyro_x:float][gyro_y:float][gyro_z:float]
            [mag_x:float][mag_y:float][mag_z:float]
    Total: 10 + 12*4 = 58 bytes.
    """

    EXPECTED_SIZE = 10 + 9 * 4  # 5 uint16 + 9 floats (accel 3 + gyro 3 + mag 3)

    def parse(self, data: bytes) -> Optional[Frame]:
        if len(data) < self.EXPECTED_SIZE:
            return None
        # Cut exactly expected size
        data = data[:self.EXPECTED_SIZE]
        unpacked = struct.unpack("<5H9f", data)
        flex = unpacked[:5]
        accel = unpacked[5:8]
        gyro = unpacked[8:11]
        mag = unpacked[11:14]
        imu = {
            "accel": (accel[0], accel[1], accel[2]),
            "gyro": (gyro[0], gyro[1], gyro[2]),
            "mag": (mag[0], mag[1], mag[2]),
        }
        return Frame(flex=flex, imu=imu, timestamp=0.0, raw=data)
