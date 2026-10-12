from abc import ABC, abstractmethod
from typing import Optional


class Transport(ABC):
    """Abstract transport: receives raw bytes from the glove."""

    @abstractmethod
    def connect(self) -> None:
        """Establish the transport connection."""
        ...

    @abstractmethod
    def recv(self, timeout: Optional[float] = None) -> Optional[bytes]:
        """Receive one frame of raw bytes. Returns None on timeout."""
        ...

    @abstractmethod
    def close(self) -> None:
        """Close the transport."""
        ...

    @property
    @abstractmethod
    def connected(self) -> bool:
        ...
