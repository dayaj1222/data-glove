from typing import Optional

from .base import Recognizer
from glove.protocol.base import Frame


class StubRecognizer(Recognizer):
    """Placeholder recognizer. Replace with ML later."""

    def recognize(self, frame: Frame) -> Optional[str]:
        # TODO: actual ML / threshold logic with real sensor data
        return None
