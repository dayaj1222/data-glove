from typing import List, Union

try:
    from evdev import UInput, ecodes as e
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False


class KeyboardInput:
    """Keyboard input via uinput (Linux)."""

    def __init__(self):
        if not HAS_EVDEV:
            raise RuntimeError("evdev not installed")
        # Map string keys to evdev codes
        self._key_map = {
            "a": e.KEY_A, "b": e.KEY_B, "c": e.KEY_C,
            "d": e.KEY_D, "e": e.KEY_E, "f": e.KEY_F,
            "g": e.KEY_G, "h": e.KEY_H, "i": e.KEY_I,
            "j": e.KEY_J, "k": e.KEY_K, "l": e.KEY_L,
            "m": e.KEY_M, "n": e.KEY_N, "o": e.KEY_O,
            "p": e.KEY_P, "q": e.KEY_Q, "r": e.KEY_R,
            "s": e.KEY_S, "t": e.KEY_T, "u": e.KEY_U,
            "v": e.KEY_V, "w": e.KEY_W, "x": e.KEY_X,
            "y": e.KEY_Y, "z": e.KEY_Z,
            "space": e.KEY_SPACE, "enter": e.KEY_ENTER,
            "shift": e.KEY_LEFTSHIFT, "ctrl": e.KEY_LEFTCTRL,
            "alt": e.KEY_LEFTALT, "super": e.KEY_LEFTMETA,
            "tab": e.KEY_TAB, "escape": e.KEY_ESC,
            "up": e.KEY_UP, "down": e.KEY_DOWN,
            "left": e.KEY_LEFT, "right": e.KEY_RIGHT,
        }
        self._device = UInput()

    def press(self, keys: List[str]) -> None:
        codes = [self._key_map[k] for k in keys]
        for code in codes:
            self._device.write(e.EV_KEY, code, 1)
        self._device.syn()

    def release(self, keys: List[str]) -> None:
        codes = [self._key_map[k] for k in keys]
        for code in codes:
            self._device.write(e.EV_KEY, code, 0)
        self._device.syn()

    def tap(self, keys: List[str]) -> None:
        self.press(keys)
        self.release(keys)

    def close(self) -> None:
        self._device.close()
