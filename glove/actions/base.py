from abc import ABC, abstractmethod


class Action(ABC):
    """Abstract action: execute a command."""

    @abstractmethod
    def execute(self) -> None:
        """Perform the action."""
        ...

    @classmethod
    @abstractmethod
    def from_config(cls, config: dict) -> "Action":
        """Construct from a config dict."""
        ...
