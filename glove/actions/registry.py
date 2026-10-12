"""Registry for action types."""
from typing import Dict, Type

from .base import Action

_registry: Dict[str, Type[Action]] = {}


def register(name: str, cls: Type[Action]) -> None:
    _registry[name] = cls


def get(name: str) -> Type[Action]:
    return _registry.get(name)


# Import after registry to avoid circular imports
from .keyboard import KeyboardAction
from .mouse import MouseMoveAction, MouseClickAction
from .composite import CompositeAction

register("keyboard", KeyboardAction)
register("mouse_move", MouseMoveAction)
register("mouse_click", MouseClickAction)
register("composite", CompositeAction)
