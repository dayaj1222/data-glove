"""Data Glove gesture recognition system.

Modular architecture:
    transport (UDP) -> protocol (frame parser) -> recognition (stub) -> actions -> input (uinput)
    Each layer is an ABC. Dependencies point inward.
"""

__version__ = "0.1.0"
