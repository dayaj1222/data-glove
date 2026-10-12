try:
    from evdev import UInput, ecodes as e
    HAS_EVDEV = True
except ImportError:
    HAS_EVDEV = False


class MouseInput:
    """Mouse input via uinput (Linux)."""

    def __init__(self):
        if not HAS_EVDEV:
            raise RuntimeError("evdev not installed")
        self._device = UInput()

    def move(self, dx: int, dy: int) -> None:
        self._device.write(e.EV_REL, e.REL_X, dx)
        self._device.write(e.EV_REL, e.REL_Y, dy)
        self._device.syn()

    def click(self, button: str = "left") -> None:
        btn_map = {"left": e.BTN_LEFT, "right": e.BTN_RIGHT, "middle": e.BTN_MIDDLE}
        code = btn_map[button]
        self._device.write(e.EV_KEY, code, 1)
        self._device.write(e.EV_KEY, code, 0)
        self._device.syn()

    def double_click(self, button: str = "left") -> None:
        self.click(button)
        self.click(button)

    def scroll(self, dy: int) -> None:
        self._device.write(e.EV_REL, e.REL_WHEEL, dy)
        self._device.syn()

    def close(self) -> None:
        self._device.close()
