from typing import Dict, Type, Any

_registry: Dict[str, Type] = {}


def register(name: str, cls: Type) -> None:
    _registry[name] = cls


def get(name: str) -> Type:
    return _registry.get(name)
