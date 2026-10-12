from typing import Dict, List, Type, Optional

from glove.actions.base import Action
from glove.actions.registry import get as get_action


class GestureBinding:
    """A gesture ID mapped to an action."""

    def __init__(self, gesture_id: str, action: Action):
        self.gesture_id = gesture_id
        self.action = action


class ConfigLoader:
    """Loads gesture -> action bindings from Python config files."""

    @staticmethod
    def load_config(config_module: str) -> Dict[str, List[GestureBinding]]:
        """Load a config module and extract BINDINGS."""
        import importlib
        module = importlib.import_module(config_module)
        raw_bindings = getattr(module, "BINDINGS", [])
        bindings = []
        for item in raw_bindings:
            gesture_id = item["gesture"]
            action_config = item["action"]
            action_cls = get_action(action_config["type"])
            if action_cls is None:
                raise ValueError(f"Unknown action type: {action_config['type']}")
            action = action_cls.from_config(action_config)
            bindings.append(GestureBinding(gesture_id, action))
        return {"default": bindings}
