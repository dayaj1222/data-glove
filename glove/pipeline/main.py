import time
from typing import Optional, Dict, List

from glove.transport.base import Transport
from glove.protocol.base import Protocol, Frame
from glove.recognition.base import Recognizer
from glove.config.loader import ConfigLoader, GestureBinding


class Pipeline:
    """Main pull loop: transport -> protocol -> recognizer -> action."""

    def __init__(
        self,
        transport: Transport,
        protocol: Protocol,
        recognizer: Recognizer,
        config_module: str = "glove.config.default",
        debug: bool = False,
    ):
        self.transport = transport
        self.protocol = protocol
        self.recognizer = recognizer
        self.bindings: Dict[str, List[GestureBinding]] = {}
        self._running = False
        self.debug = debug
        self._load_bindings(config_module)

    def _load_bindings(self, config_module: str) -> None:
        self.bindings = ConfigLoader.load_config(config_module)

    def run(self, loop_delay: float = 0.01) -> None:
        """Main loop. Pulls frames, recognizes, executes actions."""
        self._running = True
        self.transport.connect()
        print("Pipeline running. Press Ctrl+C to stop.")
        try:
            while self._running:
                raw = self.transport.recv(timeout=0.1)
                if raw is None:
                    continue
                frame = self.protocol.parse(raw)
                if frame is None:
                    continue
                if self.debug:
                    print(f"[DEBUG] Frame: flex={frame.flex}, imu_accel={frame.imu['accel']}")
                gesture_id = self.recognizer.recognize(frame)
                if gesture_id is None:
                    continue
                if self.debug:
                    print(f"[DEBUG] Gesture: {gesture_id}")
                self._execute(gesture_id)
                time.sleep(loop_delay)
        except KeyboardInterrupt:
            self.stop()
        finally:
            self.transport.close()

    def _execute(self, gesture_id: str) -> None:
        bindings = self.bindings.get("default", [])
        for binding in bindings:
            if binding.gesture_id == gesture_id:
                binding.action.execute()
                break

    def stop(self) -> None:
        self._running = False

    def reload_config(self, config_module: str) -> None:
        """Reload gesture bindings at runtime."""
        self._load_bindings(config_module)
