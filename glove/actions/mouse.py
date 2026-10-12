from .base import Action
from glove.input.mouse import MouseInput


class MouseMoveAction(Action):
    def __init__(self, dx: int, dy: int):
        self.dx = dx
        self.dy = dy
        self._input = MouseInput()

    def execute(self) -> None:
        self._input.move(self.dx, self.dy)

    @classmethod
    def from_config(cls, config: dict) -> "MouseMoveAction":
        return cls(dx=config["dx"], dy=config["dy"])


class MouseClickAction(Action):
    def __init__(self, button: str = "left", double: bool = False):
        self.button = button
        self.double = double
        self._input = MouseInput()

    def execute(self) -> None:
        if self.double:
            self._input.double_click(self.button)
        else:
            self._input.click(self.button)

    @classmethod
    def from_config(cls, config: dict) -> "MouseClickAction":
        return cls(button=config.get("button", "left"), double=config.get("double", False))
