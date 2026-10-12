# BACSE324 · EMBEDDED SYSTEMS ARCHITECTURE · FALL 2026 · REVIEW 2
## Design Models: CDFG, FSM and Task Schedule

| | |
|---|---|
| Project title | Data Glove Gesture Recognition System |
| Scope tier | *(from review sheet)* |
| Submission date | *(end of September)* |
| Repository link | *(optional)* |

| Member | Reg. no. | Module owned | Sections written |
|---|---|---|---|
| Dayakrishn Joshi | 25BCE2951 | Sensing, PC pipeline, training backend | All |

---

## 1 System recap

The Data Glove is a wearable input device that converts hand pose (five flex
sensors on the fingers) and hand motion (a 9-axis IMU) into standard keyboard and
mouse events on a PC, for a single operator who wants hands-free control. An
ESP-32 reads the flex sensors through an 8:1 analog multiplexer into one ADC pin
and the IMU over I²C, then streams raw frames wirelessly. On the PC, a portable
recognition layer classifies the gesture and an OS-specific layer injects it as
input (uinput on Linux, SendInput on Windows).

> **Figure 1 — System block diagram.** *(Draw yourself.)* `5× Flex → 8:1 MUX →(ADC) ESP-32
> ─(I²C)─ 9-axis IMU ──WiFi/BT──> PC: Transport → Protocol → Recogniser → Action → uinput →
> Application`; show the 3.3 V power rail feeding ESP-32, MUX and IMU.

### 1.1 Conditions carried from proposal review

| Condition / mandatory addition (from review sheet) | Status | Where addressed |
|---|---|---|
| | | |
| | | |
| | | |

*(Copy the exact conditions and Review 2 mandatory additions from your review sheet — ticked on the marking sheet, 4 marks.)*

---

## 2 Control Data Flow Graph

### 2.1 Choosing the critical function

| Function / ISR | Trigger | Rate | Est. execution time | Deadline | Chosen? Why / why not |
|---|---|---|---|---|---|
| Window inference (`extract_features` + model `predict`) | timer, per prediction tick | 4 Hz | ~15 ms | 250 ms | **Chosen.** Longest execution, most data dependencies, blocks action dispatch. |
| Frame poll (`get_latest_grouped`) | poll | 30 Hz | ~2–5 ms | 33 ms | No — small, stateless; a missed poll loses one frame. |
| Frame parse (`SimpleBinaryProtocol.parse`) | per datagram | 30 Hz | <0.5 ms | 33 ms | No — trivial fixed cost. |

**Justification:** the critical path is window inference in
`backend/app/routers/training.py::predict`. It has the longest execution time,
the most data dependencies (consumes the whole buffered window), and blocks the
action dispatch that follows it.

### 2.2 The CDFG

> **Figure 2 — CDFG of `predict`.** *(Draw yourself: circles = operations, diamonds =
> decisions, solid = data, dashed = control; group into basic blocks BB0–BB3.)*
>
> ```
>  BB0 acquisition        BB1 feature build              BB2 inference          BB3 dispatch
>  (N1 window≥10?)◆ ──▶ (N4 split 4 blocks) ──▶ (N8 load model) ──▶ (N11 conf≥thr?)◆
>                        (N5 mean/std/min/max)  (N9 reshape)         ├yes▶(N12 lookup binding)
>                        (N6 concat→64 feats)   (N10 predict/proba)  │     (N14 action.execute)
>                        (N7 shape check)                            └no ▶(N13 return none)
> ```

### 2.3 Node table

| Node | Operation | Inputs | Output | Est. cost (µs) | Source line / function |
|---|---|---|---|---|---|
| N1 | Check window ≥ 10 frames | frame buffer | continue/drop | 200 | `predict` guard |
| N4 | Split into 4 sensor blocks | frames | block arrays | 400 | `extract_features` |
| N5 | Per-axis mean/std/min/max | block array | 4 stats/axis | 2500 | `extract_features` |
| N6 | Concatenate → 64 features | stats | `np.array` | 300 | `extract_features` |
| N7 | Shape check vs `n_features_in_` | features, model | ok / 400 | 100 | `predict` |
| N8 | Load pickled model | path | model | 1500 | `predict` |
| N9 | Reshape (1, −1) | features | 2-D array | 50 | `predict` |
| N10 | `predict` + `predict_proba` | features, model | id, confidence | 8000 | `predict` |
| N11 | Confidence ≥ threshold? | confidence, thr | bool | 50 | `predict_and_act` |
| N12 | Look up action binding | gesture id | action record | 300 | `predict_and_act` |
| N13 | Return not-executed | result | JSON | 100 | `predict_and_act` |
| N14 | `action.execute()` (uinput) | action config | input event | 2000 | `actions/*.execute` |

*All costs are **estimated** (Python-level, dev PC) — no WCET measured yet.*

### 2.4 Critical path

| Critical path (node sequence) | Total latency | Deadline | Slack |
|---|---|---|---|
| N1→N4→N5→N6→N8→N10→N11→N12→N14 | **≈15.3 ms** | 250 ms | **≈234.7 ms** |

**Dependency to break:** N8 (model load, 1.5 ms) is on the path *every call*
because `predict` re-opens the `.pkl` per request. **Yes —** cache the model at
startup in the Final build. (A second option, incremental sliding-window
statistics to remove N5's 2.5 ms, is deferred: slack is ample.)

**What the CDFG tells us about the implementation:** the path is dominated by
two per-request costs the code need not pay (model reload, full-window stats);
recognition is otherwise cheap against a 250 ms budget, so Python is sufficient
and feature extraction need not move to the ESP-32.

---

## 3 System-behaviour FSM

### 3.1 Model type

**Mealy.** Outputs depend on state *and* input — the same recognised gesture
emits an action only when confidence ≥ threshold. A Moore machine cannot express
"act only if confident", so Mealy fits.

### 3.2 State diagram

> **Figure 3 — System FSM.** *(Draw yourself; label every transition
> `event [guard] / action`.)*
>
> ```
>  IDLE ──start──▶ STREAMING ──window full [model present]──▶ TRACKING
>                    │  ▲                                      │  ▲
>        bridge down │  │ sensor_ok                  conf<thr  │  │ conf≥thr
>                    ▼  │                                      ▼  │
>                  FAULT ──recover──▶ RECOVER ──primed──▶  ACTING ─┘
> ```

### 3.3 State transition table

| Current state | Event | Guard | Next state | Output / action |
|---|---|---|---|---|
| IDLE | start | sensors available | STREAMING | open transport, buffer frames |
| IDLE | start | sensors unavailable | FAULT | sensor-unavailable error |
| STREAMING | frame | buffer < window | STREAMING | append frame |
| STREAMING | window full | bridge up, model present | TRACKING | run inference |
| STREAMING | bridge down | — | FAULT | phone-disconnected error |
| TRACKING | tick | confidence < threshold | TRACKING | none (display "—") |
| TRACKING | tick | confidence ≥ threshold | ACTING | dispatch action |
| TRACKING | stop | — | IDLE | flush buffer, close transport |
| ACTING | action done | binding found | TRACKING | inject key/mouse event |
| ACTING | action done | no binding | TRACKING | none (logged) |
| FAULT | recover | link/sensor restored | RECOVER | re-arm, clear buffer |
| FAULT | stop | — | IDLE | close transport |
| RECOVER | re-armed | buffer primed | STREAMING | resume streaming |

### 3.4 Fault, recovery and safe state

**Safe state (FAULT) outputs:** no keyboard or mouse events are emitted — no key
held, no button pressed, no relative motion; every injected event ends with a
release + `syn()`, so a stuck modifier (e.g. held `super`) can never lock the
desktop. FAULT is reachable from **every** state by the fatal-error / link-loss
event. Recovery: `recover → RECOVER`, which **clears the frame buffer** (stale
frames must never be inferred against) and returns to STREAMING only once primed.
A watchdog transition (STREAMING/TRACKING → FAULT on bridge down) prevents a
disconnected phone leaving the system silently half-running.

### 3.5 Completeness check

| State ↓ / Event → | start | frame | window full | tick(<thr) | tick(≥thr) | bridge down | recover | stop |
|---|---|---|---|---|---|---|---|---|
| IDLE | STREAMING | – | – | – | – | – | – | – |
| STREAMING | – | STREAMING | TRACKING | – | – | FAULT | – | IDLE |
| TRACKING | – | – | – | TRACKING | ACTING | FAULT | – | IDLE |
| ACTING | – | – | – | – | – | FAULT | – | IDLE |
| FAULT | – | – | – | – | – | – | RECOVER | IDLE |
| RECOVER | – | – | STREAMING | – | – | FAULT | – | IDLE |

---

## 4 Task schedule

### 4.1 Task set

| Task | Trigger | Period T | WCET C | Deadline D | Priority | U = C/T | WCET source |
|---|---|---|---|---|---|---|---|
| Phone sensor sampling | sensor timer | 16.7 ms | ~1 ms | 16.7 ms | — (off-device) | — | API/datasheet (`FREQ=60`) |
| Phone orientation POST | throttled | 50 ms | ~1 ms | 50 ms | — | — | source (`lastOrientSend≥50`) |
| Phone batch flush | timer | 500 ms | ~3 ms | 500 ms | — | 0.006 | source (`BATCH_MS=500`) |
| Frame poll | timer | 33 ms | ~5 ms | 33 ms | High | 0.152 | estimated |
| Inference tick | timer | 250 ms | 15.3 ms | 250 ms | Medium | 0.061 | estimated (CDFG §2.4) |
| Action dispatch | event | sporadic | ~2 ms | 250 ms | High | 0.008 | estimated |
| Watchdog | timer | 3000 ms | ~1 ms | 3000 ms | Low | 0.0003 | source (`checkBridge` 3000 ms) |

**Total utilisation U ≈ 0.227 (22.7 %).**
*(No flex WCET claimed — flex path currently substituted by constant 500 counts.)*

### 4.2 Scheduling approach

**Task level: Rate-Monotonic (RMS). Operation level: ASAP list scheduling.**

*Why not the alternative:* the task set is small, fixed-rate and
preemption-cheap, so RMS's static priorities are simple and provable; EDF's
higher bound buys nothing at U≈0.23, and a cyclic executive adds jitter without
benefit. ASAP gives the shortest schedule for a mostly-serial CDFG chain.

### 4.3 Schedulability analysis

**RMS utilisation bound** U ≤ n(2^(1/n) − 1), n = 3 (poll, inference, watchdog):

- Bound = 3·(2^(1/3) − 1) = **0.7798**
- Actual = 5/33 + 15.3/250 + 1/3000 = **0.2130** ≤ 0.7798 → **schedulable.**

**Worst-case response time (inference):** R ≈ 15.3 + 5 (one poll interference)
= 20.3 ms ≪ 250 ms; **slack ≈ 229.7 ms.** No response-time analysis required.

**ASAP control-step table (critical chain):** N1→N4→N5→N6→(N8)→N10→N11→N12→N14,
all zero mobility except **N8**, which is removable by caching.

### 4.4 Timeline

> **Figure 4 — Schedule over one hyperperiod.** *(Draw yourself.)*
> Hyperperiod = lcm(33,250,500,3000) ≈ 16.5 s. Three Gantt rows (poll @33 ms,
> inference @250 ms, watchdog @3000 ms); each inference bar (~15 ms) inside its
> 250 ms frame, each poll (~5 ms) inside its 33 ms frame.

### 4.5 Shared resources and interrupts

| Shared resource | Used by | Protection | Worst-case blocking |
|---|---|---|---|
| SQLite `glove.db` | record / train / predict | session per request | one transaction; no ISR shares it |
| Frame buffer | poll (write), inference (read) | single-threaded | none observed |
| Model `.pkl` | inference, retrain | load-per-request | ~1.5 ms (removed by caching) |
| uinput device | action dispatch | one `UInput` per action; `syn()` | serialised by OS input layer |
| Phone ring buffer (4096) | sensor-lab write, bridge read | server `sync.Mutex` | one buffer copy |

*No PC-side hardware interrupts. Glove-side ADC/radio ISR is firmware, outside
this analysis.*

---

## 5 Planned traceability

| Model element | Planned file | Planned function | Owner |
|---|---|---|---|
| N1 window guard | `frontend/src/components/PredictUI.js` | `runPrediction` | DJ |
| N4–N6 feature build | `backend/app/routers/training.py` | `extract_features` | DJ |
| N8/N10 inference | `backend/app/routers/training.py` | `predict` | DJ |
| N11/N12 dispatch | `backend/app/routers/training.py` | `predict_and_act` | DJ |
| N14 input injection | `glove/input/keyboard.py`, `mouse.py` | `tap` / `click` | DJ |
| FSM states | *(new)* `frontend/src/stateMachine.js` | — | DJ |
| Frame poll task | `backend/app/bridge.py` | `get_latest_grouped` | DJ |
| Inference tick task | `frontend/src/components/PredictUI.js` | `setInterval(runPrediction,250)` | DJ |
| Watchdog task | `frontend/src/components/RecordingUI.js` | `checkBridge` | DJ |
| Sensor sampling task | `sensor-lab/static/app.js` | `push` / `startGeneric` | DJ |

---

## 6 Plan to Final

| Remaining work | Owner | Target date | Risk and fallback |
|---|---|---|---|
| Cache model in memory | DJ | early Oct | Low; fallback = load per request |
| Extract FSM module | DJ | early Oct | Medium; fallback = FSM stays implicit |
| Wire real flex sensors | DJ | mid Oct | High (hardware); fallback = IMU-only |
| Measure WCETs | DJ | mid Oct | Medium; fallback = keep estimates |
| Fault-state unit tests | DJ | late Oct | Low |

---

## 7 Individual contribution

| Member | Model / section produced | Module for Final | Share % |
|---|---|---|---|
| Dayakrishn Joshi | All models and sections | Sensing + PC pipeline + backend | 100 |

---

## References

[1] Espressif Systems, *ESP32 Series Datasheet*, 2024.
[2] Bosch Sensortec, *BMI270 6-axis IMU Datasheet*, 2023.
[3] W3C, *Generic Sensor API*, Candidate Recommendation, 2023.
[4] C. L. Liu, J. W. Layland, "Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environment," *J. ACM*, 20(1):46–61, 1973.

---

## Submission checklist

| Item | ✓ |
|---|---|
| Guidance blocks deleted; 6–10 pages excluding cover and appendices | ☐ |
| Critical function justified against ≥3 candidates | ☑ |
| CDFG with node costs and critical path | ☑ |
| FSM with model type, transition table, fault and safe state | ☑ |
| Task set with WCET source, approach and schedulability proof | ☑ |
| Every carried condition listed with status | ☐ (needs review sheet) |
| Every member named against a model they can explain | ☑ |
