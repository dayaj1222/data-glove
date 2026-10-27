import json
"""Generate the four final report figures for the data-glove project.

Outputs (written next to this script):
    fig_final_block.png, fig_final_schematic.png,
    fig_final_modules.png, fig_final_sched.png

Units: every figure axes spans its figure exactly, so 1 data unit = 1 inch.
"""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Arc, Circle, FancyArrowPatch, FancyBboxPatch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

INK = "#1c1b19"
BOX = "#f4f2ec"
ACC = "#e3dccb"
GREY = "#6b6860"
GRID = "#e6e3dc"
FW = "#2f4b7c"
UART = "#d0782a"
HOST = "#3d7a5a"
FS = 11

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": FS,
    "text.color": INK,
    "savefig.facecolor": "white",
})


# ---------------------------------------------------------------- primitives
def new_fig(height):
    fig = plt.figure(figsize=(12, height), dpi=200, facecolor="white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 12)
    ax.set_ylim(0, height)
    ax.axis("off")
    return fig, ax


def label(ax, x, y, s, ha="left", va="center", **kw):
    kw.setdefault("fontsize", FS)
    kw.setdefault("color", INK)
    kw.setdefault("zorder", 6)
    return ax.text(x, y, s, ha=ha, va=va, linespacing=1.3, **kw)


def box(ax, x, y, w, h, s, fill=BOX, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.05",
                                fc=fill, ec=INK, lw=1.5, zorder=3))
    t = label(ax, x + w / 2, y + h / 2, s, ha="center",
              fontweight="bold" if bold else "normal")
    t._container = (x, y, w, h)
    return t


def group(ax, x, y, w, h, title):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.08",
                                fc="none", ec=GREY, lw=1.0, ls=(0, (5, 3)), zorder=1))
    t = label(ax, x + 0.15, y + h - 0.15, title, va="top", style="italic", color=GREY)
    t._container = (x, y, w, h)


def arrow(ax, p0, p1, lw=1.5, both=False):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="<|-|>" if both else "-|>",
                                 mutation_scale=14, lw=lw, color="black",
                                 shrinkA=0, shrinkB=0, zorder=2))


def wire(ax, pts, lw=1.5, arrow_end=False):
    """Orthogonal polyline; optional arrowhead on the last segment."""
    if arrow_end:
        seg = pts[:-1]
        ax.plot([p[0] for p in seg], [p[1] for p in seg], color="black", lw=lw,
                solid_capstyle="butt", zorder=2)
        arrow(ax, pts[-2], pts[-1], lw=lw)
    else:
        ax.plot([p[0] for p in pts], [p[1] for p in pts], color="black", lw=lw,
                solid_capstyle="butt", zorder=2)


def dot(ax, x, y):
    ax.add_patch(Circle((x, y), 0.045, fc=INK, ec=INK, zorder=7))


def zigzag(ax, x, y0, y1, n=7, amp=0.12):
    """Vertical zig-zag resistor symbol from (x, y0) to (x, y1)."""
    pts = [(x, y0)]
    span = y1 - y0
    for k in range(1, n + 1):
        pts.append((x + (amp if k % 2 else -amp), y0 + span * k / (n + 1)))
    pts.append((x, y1))
    ax.plot([p[0] for p in pts], [p[1] for p in pts], color="black", lw=1.5, zorder=3)


def check(fig, ax, name):
    """Report text that overlaps other text, leaves the figure, or overflows its box."""
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    W, H = fig.canvas.get_width_height()
    texts = [t for t in ax.texts if t.get_text()]
    bbs = [t.get_window_extent(rend) for t in texts]
    problems = []
    for i, (t, b) in enumerate(zip(texts, bbs)):
        s = t.get_text().replace("\n", " | ")
        if b.x0 < 0 or b.y0 < 0 or b.x1 > W or b.y1 > H:
            problems.append(f"outside figure: {s}")
        cont = getattr(t, "_container", None)
        if cont is not None:
            x, y, w, h = cont
            p0 = ax.transData.transform((x, y))
            p1 = ax.transData.transform((x + w, y + h))
            if (b.x0 < min(p0[0], p1[0]) or b.x1 > max(p0[0], p1[0]) or
                    b.y0 < min(p0[1], p1[1]) or b.y1 > max(p0[1], p1[1])):
                problems.append(f"overflows container: {s}")
        for j in range(i + 1, len(texts)):
            if b.overlaps(bbs[j]):
                s2 = texts[j].get_text().replace("\n", " | ")
                problems.append(f"text overlap: {s} <> {s2}")
    print(f"[{name}] " + ("OK" if not problems else "; ".join(problems)))


def save(fig, name):
    fig.savefig(os.path.join(HERE, name), dpi=200, bbox_inches="tight",
                pad_inches=0.15, facecolor="white")
    plt.close(fig)


# ------------------------------------------------------ 1. system block diagram
def fig_block():
    H = 9.0
    fig, ax = new_fig(H)

    group(ax, 0.2, 0.75, 2.7, 7.85, "GLOVE")
    group(ax, 4.3, 0.75, 3.0, 7.85, "MCU BOARD")
    group(ax, 9.0, 0.75, 2.9, 7.85, "HOST PC")

    # glove
    box(ax, 0.45, 5.9, 2.2, 0.9, "Flex sensor (index)\nflex_1 · GPIO35")
    box(ax, 0.45, 4.4, 2.2, 0.9, "Flex sensor (thumb)\nflex_0 · GPIO34")
    box(ax, 0.45, 2.9, 2.2, 1.2, "MPU-6500 IMU\n6-axis: accel + gyro\nI2C address 0x68")

    # MCU board
    box(ax, 4.55, 3.3, 2.5, 3.8, "ESP32 DevKit\n(ESP32-WROOM-32)\n\nADC1 x2, I2C, 50 Hz loop",
        fill=ACC)
    box(ax, 4.55, 1.95, 2.5, 0.8, "CP2102\nUSB-UART bridge")

    # links glove -> MCU
    arrow(ax, (2.65, 6.35), (4.55, 6.35))
    arrow(ax, (2.65, 4.85), (4.55, 4.85))
    arrow(ax, (2.65, 3.5), (4.55, 3.5), both=True)
    label(ax, 3.6, 6.45, "ADC 12-bit", ha="center", va="bottom")
    label(ax, 3.6, 4.95, "ADC 12-bit", ha="center", va="bottom")
    label(ax, 3.6, 3.65, "I2C 400 kHz", ha="center", va="bottom")

    # MCU internal UART link
    wire(ax, [(6.3, 3.3), (6.3, 2.75)], arrow_end=True)
    label(ax, 6.15, 3.02, "UART 115200 baud\n48 B @ 50 Hz", ha="right")

    # CP2102 -> host (USB), routed through the gap to serial_manager
    wire(ax, [(7.05, 2.35), (8.4, 2.35), (8.4, 7.6), (9.15, 7.6)], arrow_end=True)
    label(ax, 7.7, 2.45, "USB 5 V\n+ data", ha="center", va="bottom")

    # host PC
    box(ax, 9.15, 7.3, 2.6, 0.65, "serial_manager.py +\ndevice/framing.py")
    arrow(ax, (10.45, 7.3), (10.45, 6.55))
    box(ax, 9.15, 5.9, 2.6, 0.65, "FastAPI backend :8000\nroutes /api/*")

    # fan-out from FastAPI to three consumers (bus on the left)
    wire(ax, [(9.4, 5.9), (9.4, 2.9)])
    box(ax, 10.0, 4.575, 1.75, 0.65, "React UI\n/ games")
    box(ax, 10.0, 3.575, 1.75, 0.65, "classifier +\nSQLite")
    box(ax, 10.0, 2.575, 1.75, 0.65, "air mouse\nengine")
    for yy in (4.9, 3.9, 2.9):
        wire(ax, [(9.4, yy), (10.0, yy)], arrow_end=True)
    label(ax, 9.5, 5.55, "HTTP /api")

    # air mouse -> uinput -> desktop
    arrow(ax, (10.875, 2.575), (10.875, 2.15))
    label(ax, 10.75, 2.36, "uinput events", ha="right")
    box(ax, 9.15, 1.7, 2.6, 0.45, "uinput virtual device")
    arrow(ax, (10.45, 1.7), (10.45, 1.35))
    box(ax, 9.15, 0.9, 2.6, 0.45, "Hyprland desktop")

    label(ax, 0.2, 0.3, "Power: 5 V from USB. No battery, no wireless link.")
    check(fig, ax, "block")
    save(fig, "fig_final_block.png")


# ------------------------------------------------------------ 2. schematic
def fig_schematic():
    H = 7.3
    fig, ax = new_fig(H)

    # rails
    ax.plot([0.9, 11.95], [6.6, 6.6], color="black", lw=1.5, zorder=2)
    ax.plot([0.9, 11.95], [0.7, 0.7], color="black", lw=1.5, zorder=2)
    label(ax, 0.9, 6.85, "3V3", va="bottom")
    # ground symbol at the left end of the GND rail
    wire(ax, [(0.9, 0.7), (0.9, 0.56)])
    for yy, half in ((0.56, 0.18), (0.47, 0.11), (0.38, 0.04)):
        ax.plot([0.9 - half, 0.9 + half], [yy, yy], color="black", lw=1.5, zorder=2)
    label(ax, 1.2, 0.47, "GND")

    # near divider: GPIO35 (index), flex on top, 10 kOhm below
    wire(ax, [(3.6, 6.6), (3.6, 6.0)])
    zigzag(ax, 3.6, 6.0, 4.8)
    wire(ax, [(3.6, 4.8), (3.6, 4.2)])
    dot(ax, 3.6, 4.2)
    zigzag(ax, 3.6, 4.2, 3.0)
    wire(ax, [(3.6, 3.0), (3.6, 0.7)])
    wire(ax, [(3.6, 4.2), (5.6, 4.2)])
    dot(ax, 3.6, 6.6)
    dot(ax, 3.6, 0.7)
    label(ax, 3.85, 5.4, "Flex 1 (index)\n25-100 kOhm")
    label(ax, 3.85, 3.6, "10 kOhm")

    # far divider: GPIO34 (thumb); its node wire hops over the near divider
    wire(ax, [(1.5, 6.6), (1.5, 6.0)])
    zigzag(ax, 1.5, 6.0, 4.8)
    wire(ax, [(1.5, 4.8), (1.5, 2.3)])
    dot(ax, 1.5, 2.3)
    zigzag(ax, 1.5, 2.3, 1.3)
    wire(ax, [(1.5, 1.3), (1.5, 0.7)])
    dot(ax, 1.5, 6.6)
    dot(ax, 1.5, 0.7)
    wire(ax, [(1.5, 2.3), (3.48, 2.3)])
    ax.add_patch(Arc((3.6, 2.3), 0.24, 0.24, theta1=0, theta2=180, color="black", lw=1.5, zorder=3))
    wire(ax, [(3.72, 2.3), (5.6, 2.3)])
    label(ax, 1.85, 5.4, "Flex 2 (thumb)\n25-100 kOhm")
    label(ax, 1.85, 1.8, "10 kOhm")

    # ESP32 DevKit
    ax.add_patch(FancyBboxPatch((5.6, 1.6), 2.6, 4.2, boxstyle="round,pad=0,rounding_size=0.05",
                                fc=ACC, ec=INK, lw=1.5, zorder=3))
    label(ax, 6.9, 4.95, "ESP32 DevKit\n(ESP32-WROOM-32)", ha="center", fontweight="bold")
    label(ax, 6.1, 5.5, "3V3", ha="center")
    wire(ax, [(6.1, 5.8), (6.1, 6.6)])
    dot(ax, 6.1, 6.6)
    label(ax, 5.75, 4.2, "GPIO35 (ADC1_CH7)")
    label(ax, 5.75, 2.3, "GPIO34 (ADC1_CH6)")
    label(ax, 8.05, 3.4, "GPIO21 (SDA)", ha="right")
    label(ax, 8.05, 2.8, "GPIO22 (SCL)", ha="right")
    wire(ax, [(6.1, 1.6), (6.1, 0.7)])
    dot(ax, 6.1, 0.7)
    label(ax, 6.1, 1.85, "GND", ha="center")
    wire(ax, [(7.7, 1.6), (7.7, 1.3)])
    label(ax, 7.6, 1.3, "USB 5 V", ha="right")

    # MPU-6500 breakout
    box_mpu = FancyBboxPatch((9.4, 2.0), 1.6, 4.0, boxstyle="round,pad=0,rounding_size=0.05",
                             fc=BOX, ec=INK, lw=1.5, zorder=3)
    ax.add_patch(box_mpu)
    label(ax, 10.2, 5.75, "MPU-6500", ha="center", fontweight="bold")
    label(ax, 9.5, 3.4, "SDA")
    label(ax, 9.5, 2.8, "SCL")
    label(ax, 10.9, 5.4, "VCC", ha="right")
    label(ax, 10.9, 4.8, "GND", ha="right")
    label(ax, 10.9, 4.2, "AD0", ha="right")
    label(ax, 10.9, 3.6, "INT (n.c.)", ha="right")
    wire(ax, [(8.2, 3.4), (9.4, 3.4)])
    wire(ax, [(8.2, 2.8), (9.4, 2.8)])
    # power and ground on the right-hand side of the breakout
    wire(ax, [(11.0, 5.4), (11.75, 5.4), (11.75, 6.6)])
    dot(ax, 11.75, 6.6)
    wire(ax, [(11.0, 4.8), (11.5, 4.8), (11.5, 0.7)])
    dot(ax, 11.5, 0.7)
    wire(ax, [(11.0, 4.2), (11.2, 4.2), (11.2, 0.7)])
    dot(ax, 11.2, 0.7)
    label(ax, 9.4, 1.85, "I2C pull-ups on the\nbreakout board", va="top")

    check(fig, ax, "schematic")
    save(fig, "fig_final_schematic.png")


# ---------------------------------------------------- 3. modules diagram
def fig_modules():
    H = 10.6
    fig, ax = new_fig(H)
    top = H - 1.0  # top of the first row
    pitch = 1.0
    bh = 0.6

    def row_top(i):
        return top - i * pitch

    def row_bot(i):
        return row_top(i) - bh

    # frames
    group(ax, 1.9, 0.65, 3.6, 9.5, "Firmware (glove_full.ino)")
    group(ax, 7.5, 0.65, 4.45, 9.5, "Host software")

    # layer bands on the far left
    for name, r0, r1 in (("Driver", 0, 0), ("Service", 1, 5), ("Application", 6, 8)):
        y_hi, y_lo = row_top(r0), row_bot(r1)
        ax.plot([1.7, 1.7], [y_lo, y_hi], color=GREY, lw=1.5, zorder=2)
        label(ax, 0.2, (y_hi + y_lo) / 2, name, color=GREY, style="italic")

    # firmware column: five boxes, evenly spread over the same height
    fw = [
        ("loop scheduler", "fixed 50 Hz period (20 ms)"),
        ("imuInit / readIMU", "I2C 400 kHz, WHO_AM_I 0x70"),
        ("calibrateGyro", "boot offsets (2 s still)"),
        ("readFlex", "median of 9 ADC reads"),
        ("frame packer", "magic 0xAA 0x55 + payload"),
    ]
    step = (row_top(0) - row_bot(8) - bh) / (len(fw) - 1)
    fw_tops = [row_top(0) - k * step for k in range(len(fw))]
    for k, (t1, t2) in enumerate(fw):
        box(ax, 2.1, fw_tops[k] - bh, 3.2, bh, f"{t1}\n{t2}")
    for k in range(len(fw) - 1):
        arrow(ax, (3.7, fw_tops[k] - bh), (3.7, fw_tops[k + 1]))

    # host column
    hs = [
        ("serial_manager.py", "port lifecycle, auto-reconnect"),
        ("device/framing.py", "FrameDecoder: resync on 0xAA 0x55"),
        ("routers/device.py", "/api/device/frame (flat frame)"),
        ("aircursor.py", "AirCursor: pose, zone, gestures, uinput"),
        ("routers/cursor.py", "/api/cursor (air mouse control)"),
        ("routers/training.py", "extract_features, RandomForest, model cache"),
        ("useEspFrame hook", "shared polling: Record, Predict, games"),
    ]
    cx = 7.65 + 4.15 / 2
    for i, (t1, t2) in enumerate(hs):
        box(ax, 7.65, row_bot(i), 4.15, bh, f"{t1}\n{t2}")
    for i in range(len(hs) - 1):
        arrow(ax, (cx, row_bot(i)), (cx, row_top(i + 1)))

    # three game / UI boxes in one row
    ui = ["SniperUI", "PuzzleUI", "AirMouseUI"]
    ui_x = [7.65, 9.05, 10.45]
    ui_w = 1.3
    for x0, name in zip(ui_x, ui):
        box(ax, x0, row_bot(7), ui_w, bh, name)
        ucx = x0 + ui_w / 2
        arrow(ax, (ucx, row_bot(6)), (ucx, row_top(7)))
        arrow(ax, (ucx, row_bot(7)), (ucx, row_top(8)))
    box(ax, 7.65, row_bot(8), 4.15, bh, "lib/pointer.js\nfinger pitch / yaw")

    # thick UART link: frame packer (bottom firmware box) -> serial_manager.py
    fp_mid = fw_tops[-1] - bh / 2
    s_mid = row_top(0) - bh / 2
    wire(ax, [(5.3, fp_mid), (6.5, fp_mid), (6.5, s_mid), (7.65, s_mid)], lw=3.5, arrow_end=True)
    label(ax, 6.25, 5.3, "UART frames", ha="center", rotation=90)

    check(fig, ax, "modules")
    save(fig, "fig_final_modules.png")


# ------------------------------------------------------------ 4. schedule
def fig_sched():
    H = 8.4
    fig, ax = new_fig(H)
    X0, S = 3.5, 0.405  # inches per millisecond, origin at x = 3.5 in

    def X(t):
        return X0 + t * S

    ytop, pitch, bh = 6.9, 0.8, 0.32
    rows = [
        ("ESP32 loop: ADC read\n2 x 9 samples", 0.0, 0.30, FW, "est. 0.3 ms", 0.0),
        ("ESP32 loop: I2C read\n14 B", 0.30, 0.70, FW, "est. 0.4 ms", 0.0),
        ("ESP32 loop: frame pack", 0.70, 0.75, FW, "est. 0.05 ms", 0.0),
        ("UART TX 48 B @115200", 0.75, 4.92, UART,
         "4.17 ms on the wire, computed 48 x 10 bit / 115200", 0.0),
        ("Host reader thread (frames arrive\nin bursts of about 5 every ~100 ms)",
         5.0, 5.2, HOST, "burst of about 5 frames", 0.12),
    ]

    # gridlines, axis and ticks
    for t in range(0, 21, 2):
        ax.plot([X(t), X(t)], [1.4, ytop + 0.45], color=GRID, lw=0.8, zorder=0.5)
    ax.plot([X(0), X(20)], [1.4, 1.4], color=INK, lw=1.5, zorder=2)
    for t in range(0, 21, 2):
        ax.plot([X(t), X(t)], [1.4, 1.32], color=INK, lw=1.2, zorder=2)
        label(ax, X(t), 1.22, str(t), ha="center", va="top")
    label(ax, X(10), 0.88, "Time (ms)", ha="center")

    def bar(y, t0, t1, color, height=bh):
        w = max((t1 - t0) * S, 0.06)
        ax.add_patch(FancyBboxPatch((X(t0), y - height / 2), w, height,
                                    boxstyle="square,pad=0", fc=color, ec="none", zorder=4))
        return X(t0) + w

    for r, (name, t0, t1, color, note, height) in enumerate(rows):
        y = ytop - r * pitch
        label(ax, 0.3, y, name, va="center")
        right = bar(y, t0, t1, color, height or bh)
        label(ax, right + 0.1, y, note)

    # AirCursor tick: 13 us bars drawn at a minimum visible width
    y_ac = ytop - 5 * pitch
    label(ax, 0.3, y_ac, "AirCursor tick\n(10 ms period)", va="center")
    bar(y_ac, 0.0, 0.013, HOST)
    right = bar(y_ac, 10.0, 10.013, HOST)
    label(ax, right + 0.1, y_ac, f"process() {json.load(open('../measurements/results.json'))['aircursor_process_per_sample']['mean']:.0f} us measured")

    # UI poll: one request every 33 ms, drawn at 8 ms
    y_ui = ytop - 6 * pitch
    label(ax, 0.3, y_ui, "UI poll /api/device/frame\n(33 ms)", va="center")
    right = bar(y_ui, 8.0, 8.013, HOST)
    label(ax, right + 0.1, y_ui, "one request each 33 ms (duration not drawn to scale)")

    # deadline line at 20 ms
    ax.plot([X(20), X(20)], [1.4, ytop + 0.45], color=INK, lw=1.5, ls=(0, (4, 3)), zorder=3)
    label(ax, X(20), ytop + 0.6, "deadline = next frame (T = 20 ms)", ha="right", va="bottom")

    # utilisation formula box
    ax.add_patch(FancyBboxPatch((0.6, 0.15), 10.8, 0.45, boxstyle="round,pad=0,rounding_size=0.05",
                                fc=BOX, ec=INK, lw=1.5, zorder=3))
    ft = label(ax, 6.0, 0.375,
               "Firmware utilisation U = (0.3 + 0.4 + 0.05 + 4.17) / 20 = 0.246 "
               "(estimated; UART time computed)", ha="center")
    ft._container = (0.6, 0.15, 10.8, 0.45)

    check(fig, ax, "sched")
    save(fig, "fig_final_sched.png")


if __name__ == "__main__":
    fig_block()
    fig_schematic()
    fig_modules()
    fig_sched()
