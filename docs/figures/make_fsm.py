"""System-behaviour FSM figure (final): numbered transitions + legend. Writes fig_final_fsm.png."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle

INK, FILL, ACC = "#1c1b19", "#f4f2ec", "#e3dccb"
fig, ax = plt.subplots(figsize=(14, 11.4), dpi=200)
ax.set_xlim(-1.8, 15.0)
ax.set_ylim(-8.6, 5.6)
ax.axis("off")

W, H = 2.8, 1.05
X = [0.0, 4.6, 9.2, 13.6]
Y_TOP, Y_BOT = 3.6, 0.0
S = {
    "IDLE": (X[0], Y_TOP, "port closed", FILL),
    "STREAMING": (X[1], Y_TOP, "frames flowing", FILL),
    "ARMED": (X[2], Y_TOP, "air mouse enabled", FILL),
    "PENDING": (X[3], Y_TOP, "waiting chord_ms", FILL),
    "RECONNECT": (X[0], Y_BOT, "searching for board", FILL),
    "FAULT": (X[1], Y_BOT, "glove silent: safe", ACC),
    "CLUTCH": (X[2], Y_BOT, "finger pointed down", FILL),
    "HOLD": (X[3], Y_BOT, "gesture held", FILL),
}
for name, (x, y, sub, col) in S.items():
    ax.add_patch(FancyBboxPatch((x - W / 2, y - H / 2), W, H, boxstyle="round,pad=0,rounding_size=0.18",
                                fc=col, ec=INK, lw=1.8, zorder=3))
    ax.text(x, y + 0.17, name, ha="center", va="center", fontsize=13, fontweight="bold", zorder=4)
    ax.text(x, y - 0.22, sub, ha="center", va="center", fontsize=10.5, zorder=4)


def edge(name, side, off=0.0):
    x, y = S[name][:2]
    return {"r": (x + W / 2, y + off), "l": (x - W / 2, y + off),
            "t": (x + off, y + H / 2), "b": (x + off, y - H / 2)}[side]


def arrow(p, q, num, t=0.5, dx=0.0, dy=0.0):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=16, lw=1.6, color=INK,
                                 zorder=2, shrinkA=0, shrinkB=0))
    mx, my = p[0] + (q[0] - p[0]) * t + dx, p[1] + (q[1] - p[1]) * t + dy
    ax.add_patch(Circle((mx, my), 0.24, fc="white", ec=INK, lw=1.3, zorder=5))
    ax.text(mx, my, str(num), ha="center", va="center", fontsize=10, fontweight="bold", zorder=6)


a = 0.28
arrow(edge("IDLE", "r", a), edge("STREAMING", "l", a), 1)
arrow(edge("STREAMING", "l", -a), edge("IDLE", "r", -a), 2)
arrow(edge("STREAMING", "r", a), edge("ARMED", "l", a), 3)
arrow(edge("ARMED", "l", -a), edge("STREAMING", "r", -a), 4)
arrow(edge("ARMED", "r", a), edge("PENDING", "l", a), 5)
arrow(edge("PENDING", "l", -a), edge("ARMED", "r", -a), 6)
arrow(edge("PENDING", "b", 0.0), edge("HOLD", "t", 0.0), 7)
arrow(edge("HOLD", "t", -1.0), edge("ARMED", "b", 1.15), 8, t=0.42)
arrow(edge("ARMED", "b", -0.2), edge("CLUTCH", "t", -0.2), 9)
arrow(edge("CLUTCH", "t", 0.55), edge("ARMED", "b", 0.55), 10)
arrow(edge("HOLD", "l", 0.0), edge("CLUTCH", "r", 0.0), 11)
arrow(edge("ARMED", "b", -1.2), edge("FAULT", "t", 0.55), 12, t=0.4)
arrow(edge("CLUTCH", "l", 0.0), edge("FAULT", "r", 0.0), 13)
yb = Y_BOT - H / 2 - 0.7
ax.plot([X[3], X[3]], [Y_BOT - H / 2, yb], color=INK, lw=1.6, zorder=2)
ax.plot([X[3], X[1]], [yb, yb], color=INK, lw=1.6, zorder=2)
arrow((X[1], yb), edge("FAULT", "b", 0.0), 14, t=0.0, dx=3.2, dy=0.0)
arrow(edge("FAULT", "t", 1.15), edge("ARMED", "b", -0.75), 15, t=0.62)
arrow(edge("STREAMING", "b", -0.7), edge("RECONNECT", "r", 0.28), 16)
arrow(edge("RECONNECT", "t", 0.6), edge("STREAMING", "l", -0.38), 17, t=0.38)

ax.text(6.8, 5.15, "System-behaviour FSM (Mealy): transitions are event [guard] / action, listed below", ha="center",
        va="center", fontsize=14, fontweight="bold")

legend = [
    ("1", "IDLE → STREAMING", "open port"),
    ("2", "STREAMING → IDLE", "close port"),
    ("3", "STREAMING → ARMED", "enable [uinput device created]"),
    ("4", "ARMED → STREAMING", "disable / release all"),
    ("5", "ARMED → PENDING", "finger bends"),
    ("6", "PENDING → ARMED", "released early / tap"),
    ("7", "PENDING → HOLD", "120 ms [one finger] / press combo;\n    both fingers [in window] / start scroll"),
    ("8", "HOLD → ARMED", "fingers relax / release combo"),
    ("9", "ARMED → CLUTCH", "pitch < -40 deg / release all"),
    ("10", "CLUTCH → ARMED", "pitch > -32 deg"),
    ("11", "HOLD → CLUTCH", "pitch < -40 deg / release all"),
    ("12", "ARMED → FAULT", "no frame for 0.5 s / release all"),
    ("13", "CLUTCH → FAULT", "no frame for 0.5 s / release all"),
    ("14", "HOLD → FAULT", "no frame for 0.5 s / release all"),
    ("15", "FAULT → ARMED", "frames resume"),
    ("16", "STREAMING → RECONNECT", "USB read error"),
    ("17", "RECONNECT → STREAMING", "port found"),
]
y0 = -2.65
colx = [-1.7, 6.3]
rows_per_col = 9
yy = [y0, y0]
for i, (n, ft, ev) in enumerate(legend):
    c = 0 if i < rows_per_col else 1
    lines = ev.count("\n") + 1
    ax.text(colx[c], yy[c], f"{n}", ha="left", va="top", fontsize=10.5, fontweight="bold")
    ax.text(colx[c] + 0.55, yy[c], f"{ft}:  {ev}", ha="left", va="top", fontsize=10.5, linespacing=1.25)
    yy[c] -= 0.52 * lines
ax.text(-1.7, -8.2,
        "PENDING also goes to FAULT after 0.5 s without frames (same as 12). Disable from any enabled state releases all inputs and returns to STREAMING.\n"
        "Safe state = FAULT: no button, key or scroll is held. Mealy machine: outputs depend on the state and the input.",
        ha="left", va="center", fontsize=10.5, linespacing=1.4)
fig.savefig("fig_final_fsm.png", bbox_inches="tight", facecolor="white", dpi=200)
print("ok")
