import socket
from typing import Optional

from .base import Transport


class UDPTransport(Transport):
    """UDP transport: receives raw bytes from a specific port."""

    def __init__(self, port: int = 5005, buffer_size: int = 1024):
        self.port = port
        self.buffer_size = buffer_size
        self._socket: Optional[socket.socket] = None
        self._connected = False

    def connect(self) -> None:
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._socket.bind(("0.0.0.0", self.port))
        self._socket.settimeout(1.0)
        self._connected = True

    def recv(self, timeout: Optional[float] = None) -> Optional[bytes]:
        if not self._connected or self._socket is None:
            raise RuntimeError("Transport not connected")
        orig_timeout = self._socket.gettimeout()
        if timeout is not None:
            self._socket.settimeout(timeout)
        try:
            data, _ = self._socket.recvfrom(self.buffer_size)
            return data
        except socket.timeout:
            return None
        finally:
            if timeout is not None:
                self._socket.settimeout(orig_timeout)

    def close(self) -> None:
        if self._socket:
            self._socket.close()
            self._socket = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected
