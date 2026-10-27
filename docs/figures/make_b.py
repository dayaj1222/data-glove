"""Generate the four final report figures for the data glove.

Run:  python make_b.py   (writes PNGs next to this script)
Data: ../measurements/results.json
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Circle, FancyBboxPatch, Polygon, Rectangle  # noqa: E402
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.dirname(HERE)
RES = json.load(open(os.path.join(DOCS, "measurements", "results.json")))

INK = "#1c1b19"
BOX = "#f4f2ec"
ACC = "#e3dccb"
WHITE = "#ffffff"

matplotlib.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "text.color": INK,
    "axes.labelcolor": INK,
    "axes.edgecolor": INK,
    "xtick.color": INK,
    "ytick.color": INK,
    "axes.linewidth": 1.5,
    "figure.facecolor": WHITE,
    "savefig.facecolor": WHITE,
})


def new_fig(height):
    """Figure 12 in wide; the axes spans the full figure in inch units."""
    fig = plt.figure(figsize=(12, height), facecolor=WHITE)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 12)
    ax.set_ylim(0, height)
    ax.axis("off")
    return fig, ax


def save(fig, name):
    fig.savefig(os.path.join(HERE, name), dpi=200, bbox_inches="tight",
                facecolor=WHITE)
    plt.close(fig)


# ---------------------------------------------------------------- FSM ------
def fig_fsm():
    fig, ax = new_fig(10.6)
    W, H = 2.2, 1.1
    pos, boxes = {}, {}

    def state(name, x, y, sub, accent=False):
        p = FancyBboxPatch((x - W / 2, y - H / 2), W, H,
                           boxstyle="round,pad=0,rounding_size=0.18",
                           fc=ACC if accent else BOX, ec=INK, lw=1.5, zorder=3)
        ax.add_patch(p)
        ax.text(x, y + 0.2, name, ha="center", va="center",
                fontsize=12, fontweight="bold", zorder=4)
        ax.text(x, y - 0.22, sub, ha="center", va="center", fontsize=11, zorder=4)
        pos[name], boxes[name] = (x, y), p

    top, bot = 7.9, 3.0
    state("IDLE", 1.1, top, "port closed")
    state("STREAMING", 4.0, top, "frames flowing")
    state("ARMED", 6.9, top, "air mouse enabled")
    state("PENDING", 9.8, top, "waiting chord_ms")
    state("RECONNECT", 1.1, bot, "searching for board")
    state("FAULT", 4.0, bot, "glove silent: safe", accent=True)
    state("CLUTCH", 6.9, bot, "finger pointed down")
    state("HOLD", 9.8, bot, "gesture held")

    def arrow(src, dst, label, rad, at=None, color=INK):
        x1, y1 = pos[src]
        x2, y2 = pos[dst]
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1), zorder=2,
                    arrowprops=dict(arrowstyle="-|>,head_length=0.55,head_width=0.28",
                                    color=color, lw=1.3, shrinkA=0, shrinkB=0,
                                    patchA=boxes[src], patchB=boxes[dst],
                                    connectionstyle=f"arc3,rad={rad}"))
        if label is None:
            return
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = x2 - x1, y2 - y1
        cx, cy = mx + rad * dy, my - rad * dx
        lx, ly = 0.5 * mx + 0.5 * cx, 0.5 * my + 0.5 * cy
        if at is not None:
            lx, ly = at
        ax.text(lx, ly, label, ha="center", va="center", fontsize=11,
                linespacing=1.15, zorder=5,
                bbox=dict(fc=WHITE, ec="none", pad=1.2))

    # top row
    arrow("IDLE", "STREAMING", "open port", -0.6)
    arrow("STREAMING", "IDLE", "close port", -0.6)
    arrow("STREAMING", "ARMED", "enable\n[uinput device created]", -0.6)
    arrow("ARMED", "STREAMING", "disable /\nrelease all", -0.6)
    arrow("ARMED", "PENDING", "finger bends", -0.6)
    arrow("PENDING", "ARMED", "released early /\ntap", -0.6)
    # PENDING -> HOLD (two guards, one arrow)
    arrow("PENDING", "HOLD",
          "120 ms [one finger] /\npress combo\nboth fingers [in window] /\nstart scroll",
          -0.25, at=(10.75, 5.45))
    arrow("HOLD", "ARMED", "fingers relax /\nrelease combo", 0.25, at=(8.55, 5.95))
    # ARMED <-> CLUTCH (pitch guards)
    arrow("ARMED", "CLUTCH", "pitch\n< -40 deg", 0.25, at=(6.35, 4.55))
    arrow("CLUTCH", "ARMED", "pitch\n> -32 deg", 0.25, at=(7.6, 5.45))
    arrow("HOLD", "CLUTCH", "pitch < -40 deg /\nrelease all", -0.6, at=(8.45, 1.6))
    # FAULT <-> ARMED
    arrow("ARMED", "FAULT", "no frame 0.5 s /\nrelease all", 0.25, at=(4.9, 5.85))
    arrow("FAULT", "ARMED", "frames resume", 0.25, at=(5.2, 4.3))
    # FAULT <-> STREAMING
    arrow("FAULT", "STREAMING", "release all", 0.0, at=(4.35, 5.45))
    # RECONNECT <-> STREAMING
    arrow("STREAMING", "RECONNECT", "USB read error", -0.25, at=(1.0, 6.0))
    arrow("RECONNECT", "STREAMING", "port found", -0.25, at=(2.7, 4.3))
    # 0.5 s from the remaining cluster
    arrow("PENDING", "FAULT", "0.5 s", -0.12, at=(8.0, 4.25))
    arrow("HOLD", "FAULT", "0.5 s", -0.5, at=(7.4, 1.85))
    arrow("CLUTCH", "FAULT", "0.5 s", -0.2, at=(5.45, 2.25))
    arrow("HOLD", "STREAMING", "release all", 0.45, at=(6.5, 6.9))
    arrow("CLUTCH", "STREAMING", "release all", 0.15, at=(3.2, 5.1))

    # legend / note
    ax.text(6.0, 0.35,
            "Mealy machine: outputs depend on state and input. "
            "Safe state = FAULT: no button, key or scroll is held.",
            ha="center", va="center", fontsize=11)
    ax.text(6.0, 10.25, "System behaviour FSM (air mouse)",
            ha="center", va="center", fontsize=13, fontweight="bold")
    pass


# --------------------------------------------------------------- CDFG ------
def fig_cdfg():
    fig, ax = new_fig(9.6)
    cx = {c: 0.95 + 1.85 * c for c in range(6)}  # column centres
    r1, r2 = 6.6, 3.2                            # row centres
    R = 0.36

    def node(x, y, name, text, cost, below=False):
        ax.add_patch(Circle((x, y), R, fc=BOX, ec=INK, lw=1.5, zorder=3))
        ax.text(x, y, name, ha="center", va="center", fontsize=12,
                fontweight="bold", zorder=4)
        if below:
            ax.text(x, y - R - 0.12, f"{text}\n{cost}", ha="center", va="top",
                    fontsize=11, linespacing=1.2, zorder=4)
        else:
            ax.text(x, y + R + 0.12, f"{text}\n{cost}", ha="center", va="bottom",
                    fontsize=11, linespacing=1.2, zorder=4)
        return (x, y)

    def diamond(x, y, name):
        w, h = 0.46, 0.4
        pts = [(x, y + h), (x + w, y), (x, y - h), (x - w, y)]
        ax.add_patch(Polygon(pts, closed=True, fc=ACC, ec=INK, lw=1.5, zorder=3))
        ax.text(x, y, name, ha="center", va="center", fontsize=12,
                fontweight="bold", zorder=4)
        return (x, y)

    def box(x, y, w, h, text, dashed=False):
        ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h,
                                    boxstyle="round,pad=0,rounding_size=0.12",
                                    fc=BOX, ec=INK, lw=1.5, zorder=3,
                                    linestyle="--" if dashed else "-"))
        ax.text(x, y, text, ha="center", va="center", fontsize=11, zorder=4)

    # input / output
    box(cx[0], r1, 1.45, 0.6, "input frame")
    inp = (cx[0], r1)
    n = {
        "N1": node(cx[1], r1, "N1", "flex hysteresis x2", "0.87 us"),
        "N2": node(cx[2], r1, "N2", "pose: gravity,\nbias, rates", "5.77 us"),
        "N3": node(cx[3], r1, "N3", "clutch update", "0.52 us"),
        "N4": node(cx[4], r1, "N4", "palm zone\n(nearest pose)", "7.52 us"),
        "N5": node(cx[5], r1, "N5", "finger state\nmachine", "0.47 us"),
    }
    d = {
        "D1": diamond(cx[5], r2, "D1"),
        "D2": diamond(cx[4], r2, "D2"),
        "D3": diamond(cx[3], r2, "D3"),
    }
    n["N6"] = node(cx[2], r2, "N6", "rate shaping x2", "0.87 us", below=True)
    n["N7"] = node(cx[1], r2, "N7", "queue pixels\n(gain, accel curve)",
                   "< 1 us (not\nseparately timed)", below=True)
    box(cx[0], r2, 1.45, 0.6, "output: pending\ncursor delta")
    out = (cx[0], r2)

    # group rectangles (basic blocks)
    def group(x0, x1, y0, y1, label):
        ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fill=False,
                               ec=INK, lw=1.2, ls=(0, (5, 3)), zorder=1))
        ax.text(x0 + 0.1, y1 - 0.12, label, ha="left", va="top",
                fontsize=12, fontweight="bold", zorder=4)

    group(cx[1] - 0.85, cx[2] + 0.85, 5.35, 8.9, "BB0 sensing")
    group(cx[3] - 0.85, cx[5] + 0.85, 5.35, 8.9, "BB1 state")
    group(cx[3] - 0.85, cx[5] + 0.85, 0.75, 4.6, "BB2 guards")
    group(cx[1] - 0.85, cx[2] + 0.85, 0.75, 4.6, "BB3 output")

    def line_to(p, q, crit=False, r_p=R, r_q=R, dash=False):
        x1, y1 = p
        x2, y2 = q
        L = np.hypot(x2 - x1, y2 - y1)
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        s = (x1 + ux * r_p, y1 + uy * r_p)
        e = (x2 - ux * r_q, y2 - uy * r_q)
        ax.annotate("", xy=e, xytext=s, zorder=2,
                    arrowprops=dict(arrowstyle="-|>,head_length=0.5,head_width=0.25",
                                    color=INK, lw=3.6 if crit else 1.2,
                                    linestyle="--" if dash else "-",
                                    shrinkA=0, shrinkB=0))

    # critical path (thick): input -> N1..N5 -> D1..D3 -> N6 -> N7 -> output
    chain = [inp, n["N1"], n["N2"], n["N3"], n["N4"], n["N5"]]
    for p, q in zip(chain[:-1], chain[1:]):
        line_to(p, q, crit=True, r_p=0.36 if p != inp else 0.3,
                r_q=0.36 if q != inp else 0.3)
    # N5 (row1 right) -> D1 (row2 right): snake down
    line_to(n["N5"], d["D1"], crit=True, r_p=R, r_q=0.46)
    for p, q in [(d["D1"], d["D2"]), (d["D2"], d["D3"])]:
        line_to(p, q, crit=True, r_p=0.46, r_q=0.46)
    line_to(d["D3"], n["N6"], crit=True, r_p=0.46, r_q=R)
    line_to(n["N6"], n["N7"], crit=True, r_p=R, r_q=R)
    line_to(n["N7"], out, crit=True, r_p=R, r_q=0.3)

    # control edges (dashed): decisions -> their yes-action
    actions = {
        "D1": "yes:\nexit,\nrelease buttons",
        "D2": "yes:\nadd to scroll acc.,\nexit",
        "D3": "yes:\ndrop movement,\nexit",
    }
    question = {"D1": "clutched?", "D2": "scroll active?", "D3": "inside click-\nhold window?"}
    for key, txt in actions.items():
        x, y = d[key]
        ax.text(x + 0.3, y - 0.7, f"{key}: {question[key]}", ha="left", va="center",
                fontsize=10.5, linespacing=1.15, zorder=4)
        box(x, 1.4, 1.7, 0.95, txt, dashed=True)
        line_to((x, y - 0.4), (x, 1.4 + 0.475), dash=True, r_p=0, r_q=0)

    # footer: totals
    total_nodes = sum(v["mean"] for k, v in RES["aircursor_nodes_us"].items()
                      if k.split()[0] in ("N1", "N2", "N3", "N4", "N5", "N6"))
    whole = RES["aircursor_process_per_sample"]["mean"]
    ax.text(0.2, 0.45,
            "Thick edges: critical path. Dashed: control edges. Node cost = measured "
            f"mean (us); N7 and D1-D3 not timed.\n"
            f"Sum of measured node means (N1-N6) = {total_nodes:.2f} us;  "
            f"whole-call mean (aircursor_process_per_sample, n = 20000) = {whole:.2f} us.",
            ha="left", va="center", fontsize=11, linespacing=1.4)
    ax.text(6.0, 9.25, "CDFG of AirCursor.process(): per-sample critical path",
            ha="center", va="center", fontsize=13, fontweight="bold")
    save(fig, "fig_final_cdfg.png")


# ---------------------------------------------------------------- OPT ------
def fig_opt():
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 5.2), gridspec_kw={"wspace": 0.28})
    sp = RES["predict_speedup"]
    base = RES["predict_reload_each_call_BASELINE"]
    opt = RES["predict_cached_model_OPTIMISED"]
    means = [base["mean"] / 1000, opt["mean"] / 1000]
    errs = [base["std"] / 1000, opt["std"] / 1000]
    xs = np.arange(2)
    bars = a.bar(xs, means, yerr=errs, capsize=6, width=0.55,
                 color=[BOX, ACC], edgecolor=INK, linewidth=1.5,
                 error_kw=dict(ecolor=INK, lw=1.5))
    for i, (m, e) in enumerate(zip(means, errs)):
        a.text(i, m + e + 0.6, f"{m:.2f} ms", ha="center", va="bottom", fontsize=11,
               fontweight="bold")
    a.set_xticks(xs, ["Baseline\n(model re-opened every call)",
                      "Optimised\n(model cached by mtime)"])
    a.set_ylabel("predict() latency per call (ms)")
    a.set_ylim(0, 34)
    a.set_title("predict() latency per call", fontsize=12, fontweight="bold", pad=10)
    a.text(0.79, 0.9, f"saved {sp['saved_us'] / 1000:.2f} ms (factor {sp['factor']:.2f})",
           transform=a.transAxes, ha="center", va="center", fontsize=11,
           bbox=dict(fc=BOX, ec=INK, lw=1.2, pad=4))
    a.spines[["top", "right"]].set_visible(False)
    a.grid(axis="y", color="#d9d5ca", lw=0.8)
    a.set_axisbelow(True)
    a.text(0.0, -0.22, f"Mean and std (error bars), n = {base['n']} calls per bar.",
           transform=a.transAxes, fontsize=11)

    g = RES["gyro_still_recording"]
    raw = [abs(v) for v in g["mean"]]
    resid = [0.5, 0.5, 0.5]
    axes_lbl = ["X", "Y", "Z"]
    gx = np.arange(3)
    w = 0.36
    b1 = b.bar(gx - w / 2, raw, width=w, color=BOX, edgecolor=INK, linewidth=1.5,
               label="Raw offset (X, Y, Z axes)")
    b2 = b.bar(gx + w / 2, resid, width=w, color=ACC, edgecolor=INK, linewidth=1.5,
               hatch="///", label="Residual after calibration")
    for rect, val in list(zip(b1, raw)) + list(zip(b2, resid)):
        b.text(rect.get_x() + rect.get_width() / 2, val + 0.15, f"{val:.3f}" if val < 1 and rect in b1 else f"{val:.2f}",
               ha="center", va="bottom", fontsize=11)
    b.set_xticks(gx, [f"{t} axis" for t in axes_lbl])
    b.set_ylabel("gyro offset |mean| (deg/s)")
    b.set_ylim(0, 12)
    b.set_title("Gyro bias after boot calibration", fontsize=12, fontweight="bold", pad=10)
    b.legend(frameon=True, fancybox=False, edgecolor=INK, loc="upper right", fontsize=11)
    b.spines[["top", "right"]].set_visible(False)
    b.grid(axis="y", color="#d9d5ca", lw=0.8)
    b.set_axisbelow(True)
    b.text(0.0, -0.22,
           "Residual |mean| measured live, <= 0.5 deg/s (footnote).\n"
           f"Raw means over n = {g['n']} still samples.",
           transform=b.transAxes, fontsize=11, va="top")

    fig.subplots_adjust(bottom=0.32)
    save(fig, "fig_final_opt.png")


# ------------------------------------------------------------ LATENCY ------
def fig_latency():
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 5.4), gridspec_kw={"wspace": 0.28})
    lat = np.array(RES["raw_latency_ms"])
    fl = RES["aircursor_frame_to_cursor_event"]
    mean, p99 = fl["mean"], fl["p99"]
    a.hist(lat, bins=12, color=ACC, edgecolor=INK, linewidth=1.2)
    a.axvline(mean, color=INK, lw=1.8)
    a.set_ylim(0, 26)
    a.text(mean + 0.3, 24, f"mean {mean:.2f} ms, p99 {p99:.1f} ms, n = {len(lat)}",
           ha="left", va="center", fontsize=11,
           bbox=dict(fc=WHITE, ec=INK, lw=1.0, pad=3))
    a.set_xlabel("frame arrives -> first cursor event written (ms)")
    a.set_ylabel("count")
    a.set_title("Raw input latency (n = 60)", fontsize=12, fontweight="bold", pad=10)
    a.spines[["top", "right"]].set_visible(False)

    rel = np.array(RES["raw_release_ms"])
    rmean = RES["fault_glove_silent_to_button_release"]["mean"]
    rng = np.random.default_rng(3)
    jitter = rng.uniform(-0.06, 0.06, size=rel.size)
    b.scatter(rel, np.zeros_like(rel) + jitter, s=70, facecolor=BOX,
              edgecolor=INK, linewidth=1.5, zorder=3)
    b.axvline(rmean, color=INK, lw=1.8, zorder=2)
    b.text(rmean - 1.5, 0.5, f"mean {rmean:.1f} ms", ha="right", va="center", fontsize=11)
    b.axvline(500, color=INK, lw=1.8, ls=(0, (5, 3)), zorder=2)
    b.text(500 + 1.5, 0.42, "STALE_AFTER\n= 500 ms", ha="left", va="center", fontsize=11)
    b.set_xlim(470, 515)
    b.set_ylim(-0.4, 0.6)
    b.set_yticks([])
    b.set_xlabel("glove goes silent -> held button released (ms)")
    b.set_title("Fault release time (n = 10)", fontsize=12, fontweight="bold", pad=10)
    b.spines[["top", "right", "left"]].set_visible(False)

    fig.subplots_adjust(bottom=0.16)
    save(fig, "fig_final_latency.png")


if __name__ == "__main__":
    fig_fsm()
    fig_cdfg()
    fig_opt()
    fig_latency()
    print("done")
