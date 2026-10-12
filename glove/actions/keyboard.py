from typing import List, Union

from .base import Action
from glove.input.keyboard import KeyboardInput


class KeyboardAction(Action):
    """Send key press/release."""

    def __init__(self, keys: Union[str, List[str]], hold: bool = False):
        self.keys = [keys] if isinstance(keys, str) else keys
        self.hold = hold
        self._input = KeyboardInput()

    def execute(self) -> None:
        if self.hold:
            self._input.press(self.keys)
        else:
            self._input.tap(self.keys)

    @classmethod
    def from_config(cls, config: dict) -> "KeyboardAction":
        return cls(keys=config["keys"], hold=config.get("hold", False))
