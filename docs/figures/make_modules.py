"""Layered module diagram (firmware + host). Writes fig_final_modules.png."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle

INK, FILL, ACC, GREY = "#1c1b19", "#f4f2ec", "#e3dccb", "#6b675f"
fig, ax = plt.subplots(figsize=(14, 9.6), dpi=200)
ax.set_xlim(0, 30)
ax.set_ylim(-0.4, 18.4)
ax.axis("off")

for name, y0, y1 in [("APPLICATION", 12.7, 17.0), ("SERVICE", 7.9, 12.3), ("DRIVER", 0.2, 7.5)]:
    ax.add_patch(Rectangle((0.2, y0), 29.6, y1 - y0, fc="#faf9f6", ec="#c9c4b8", lw=1.0, ls=(0, (4, 3)), zorder=0))
    ax.text(0.45, y1 - 0.2, name, ha="left", va="top", fontsize=10.5, color=GREY, fontstyle="italic", fontweight="bold")
ax.text(7.4, 17.7, "Firmware (glove_full.ino, ESP-32)", ha="center", va="center", fontsize=13, fontweight="bold")
ax.text(22.0, 17.7, "Host software (Linux PC)", ha="center", va="center", fontsize=13, fontweight="bold")
ax.plot([15.0, 15.0], [0.2, 17.0], color="#c9c4b8", lw=1.0, ls=(0, (4, 3)))


def box(cx, cy, w, h, title, sub="", fill=FILL):
    ax.add_patch(FancyBboxPatch((cx - w / 2, cy - h / 2), w, h, boxstyle="round,pad=0,rounding_size=0.15",
                                fc=fill, ec=INK, lw=1.5, zorder=3))
    if sub:
        ax.text(cx, cy + h * 0.24, title, ha="center", va="center", fontsize=10.5, fontweight="bold", zorder=4)
        ax.text(cx, cy - h * 0.14, sub, ha="center", va="center", fontsize=9.5, zorder=4, linespacing=1.2)
    else:
        ax.text(cx, cy, title, ha="center", va="center", fontsize=10.5, fontweight="bold", zorder=4)


def arrow(p, q, lw=1.5, ls="-"):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=14, lw=lw, color=INK, zorder=2,
                                 linestyle=ls, shrinkA=0, shrinkB=0))


def line(xs, ys, lw=1.5, ls="-"):
    ax.plot(xs, ys, color=INK, lw=lw, ls=ls, zorder=2, solid_capstyle="butt")


# ---- firmware
box(7.4, 14.8, 12.0, 2.2, "loop()  cyclic executive", "fixed 20 ms deadline (50 Hz)\nresync after a stall", ACC)
box(3.9, 10.1, 6.4, 2.4, "calibrateGyro", "boot offsets (2 s still)\nstored offsets as fallback")
box(10.9, 10.1, 6.4, 2.4, "frame packer", "0xAA 0x55 + 5 x u16\n+ 9 x f32 = 48 B")
box(3.9, 5.2, 6.4, 2.4, "imuInit / readIMU", "I2C 400 kHz, 14 B burst\nWHO_AM_I 0x70, retry 2 s")
box(10.9, 5.2, 6.4, 2.4, "readFlex", "median of 9 ADC reads\nGPIO34 / GPIO35, 12-bit")
box(7.4, 1.5, 10.0, 1.1, "Serial.write  (UART0, 115200 baud)")
arrow((3.9, 6.4), (3.9, 8.9))
arrow((10.9, 6.4), (10.9, 8.9))
arrow((3.9, 11.3), (5.2, 13.7))
arrow((10.9, 11.3), (9.6, 13.7))

# ---- host
box(22.0, 14.8, 13.0, 2.2, "React web UI", "AirMouseUI, SniperUI, PuzzleUI, Record / Predict\nlib/pointer.js: finger pitch and yaw", FILL)
box(17.2, 10.1, 4.0, 2.4, "routers/\ncursor.py", "/api/cursor", FILL)
box(22.0, 10.1, 4.0, 2.4, "aircursor.py", "pose, zone, gesture\nFSM, safe state", ACC)
box(26.8, 10.1, 4.0, 2.4, "routers/\ntraining.py", "RandomForest,\nmodel cache", FILL)
box(19.0, 5.2, 7.0, 2.4, "serial_manager.py", "port lifecycle, auto-reconnect\nframes deque", FILL)
box(26.4, 5.2, 5.0, 2.4, "device/framing.py", "FrameDecoder:\nresync on 0xAA 0x55", FILL)
box(22.5, 1.5, 12.5, 1.1, "evdev UInput  ->  uinput virtual device  ->  Hyprland")
arrow((17.2, 11.3), (17.2, 13.7))
arrow((22.0, 11.3), (22.0, 13.7))
arrow((26.8, 11.3), (26.8, 13.7))
arrow((19.2, 6.4), (19.2, 8.9)) if False else None
arrow((21.0, 6.4), (21.0, 8.9))
arrow((19.2, 8.9), (19.2, 8.9), lw=0)
arrow((19.2, 10.1), (17.2 + 2.0, 10.1), lw=0)
arrow((20.0, 10.1), (19.2, 10.1))              # cursor.py <- aircursor? control flows right-to-left
arrow((23.9, 5.2), (21.9 + 0.7, 5.2), lw=0)
arrow((23.9, 5.2), (22.5, 5.2))                # serial_manager feeds the decoder
# AirCursor -> uinput (dashed, between serial_manager and framing)
arrow((23.2, 8.9), (23.2, 2.05), ls=(0, (5, 3)))

# UART link between the two driver layers
line([12.4, 14.4], [1.5, 1.5], lw=3.0)
line([14.4, 14.4], [1.5, 5.2], lw=3.0)
ax.add_patch(FancyArrowPatch((14.4, 5.2), (15.5, 5.2), arrowstyle="-|>", mutation_scale=16, lw=3.0, color=INK, zorder=2,
                             shrinkA=0, shrinkB=0))
ax.text(14.3, 3.4, "UART\nframes", ha="right", va="center", fontsize=10.5, fontweight="bold",
        bbox=dict(fc="white", ec="none", pad=1.5), zorder=5)
ax.text(15.0, -0.2, "Data moves upward inside each column. Thick line: serial frames. Dashed line: injected input events.",
        ha="center", va="center", fontsize=10.5)
fig.savefig("fig_final_modules.png", bbox_inches="tight", facecolor="white", dpi=200)
print("ok")
