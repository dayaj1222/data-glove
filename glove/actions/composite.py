from typing import List

from .base import Action


class CompositeAction(Action):
    """Execute multiple actions in sequence."""

    def __init__(self, actions: List[Action]):
        self.actions = actions

    def execute(self) -> None:
        for action in self.actions:
            action.execute()

    @classmethod
    def from_config(cls, config: dict) -> "CompositeAction":
        from . import registry
        actions = []
        for action_config in config["actions"]:
            action_cls = registry.get(action_config["type"])
            if action_cls is None:
                raise ValueError(f"Unknown action type: {action_config['type']}")
            actions.append(action_cls.from_config(action_config))
        return cls(actions)
