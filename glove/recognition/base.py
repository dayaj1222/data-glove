from abc import ABC, abstractmethod
from typing import Optional

from glove.protocol.base import Frame


class Recognizer(ABC):
    """Abstract recognizer: maps frames to gesture IDs."""

    @abstractmethod
    def recognize(self, frame: Frame) -> Optional[str]:
        """Return a gesture identifier, or None if no gesture."""
        ...
