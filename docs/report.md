|     | Design | Models: |     | CDFG, |     | FSM | and | Task Schedule |
| --- | ------ | ------- | --- | ----- | --- | --- | --- | ------------- |
Gesture-Controlled Smart Glove for Human–Computer Interaction
|     |     | BACSE324 | · Embedded | Systems |     | Architecture | ·   | Fall 2026 · Review 2 |
| --- | --- | -------- | ---------- | ------- | --- | ------------ | --- | -------------------- |
Value
Field
Project title Gesture-Controlled Smart Glove for Human–Computer Interaction
| Scope      | tier |      | Tier                            | 2 — full | embedded | system |            |     |
| ---------- | ---- | ---- | ------------------------------- | -------- | -------- | ------ | ---------- | --- |
| Submission |      | date | September                       | 2026     |          |        |            |     |
| Repository |      |      | github.com/dayaj1222/data-glove |          |          |        |            |     |
|            |      |      | Reg.                            | no.      | Module   | owned  | / sections |     |
Member
Dayakrishn Joshi 25BCE2951 ESP-32 firmware, MPU-6500 I²C + flex ADC acquisi-
|     |     |     |     |     |     | §1, | §2, §4 |     |
| --- | --- | --- | --- | --- | --- | --- | ------ | --- |
tion —
Syed Mohammad Ayaan 25BCE2311 ESP-32 wireless link, PC recognition pipeline — §3, §5,
§6, §7
Diagrams are our own (Excalidraw and TikZ). Every timing figure is labelled measured, datasheet, or estimated.
| 1   | System | recap |     |     |     |     |     |     |
| --- | ------ | ----- | --- | --- | --- | --- | --- | --- |
TheSmartGloveisawearableinputdevicethatconvertshandpose(twoflexsensors)andhandmotion
(an MPU-6500 6-axis IMU) into standard keyboard and mouse events on a PC, for a single operator
whowantshands-freecontrol. TheESP-32firmwaresamplesbothflexADCchannelsandtheIMUover
I2Catafixedrateandframesthemintoafixed-widthbinaryrecord:
five16-bitflexcountsfollowedby
nine32-bitfloats(accelerometerx,y,z,gyroscopex,y,z,andthreemagnetometerslotsthatarealwayszero,
sincetheMPU-6500hasnomagnetometer)—a48-bytedatagram,
parsed on the host by glove/protocol/simple.py::SimpleBinaryProtocol.parse using the <5H9f
structformat. FramesarriveoverUDP(defaultport5005)throughglove/transport/udp.py::UDPTransport.recv,
are pushed through glove/pipeline/main.py::Pipeline.run, classified, and dispatched to an ac-
tion binding. On the PC a portable recognition layer classifies the gesture and an OS-specific layer
injects it as input (uinput on Linux, SendInput on Windows). The host pipeline is transport- and
recogniser-agnostic—Transport, Protocol, RecognizerandActionareallinterfaces—sothesame
code runs against the mock transport used in unit tests and the live UDP link.
Deviations from the approved proposal. Two changes were made at the design stage and are
statedheresothemodelsbelowarereadagainstwhatisbuilt,notwhatwasproposed: (i)theproposed
I2C)
MPU6050 was replaced by the MPU-6500 (6-axis; a 9-axis MPU-9250 was evaluated for its
on-board magnetometer, but the fitted part has none, so the three magnetometer slots read
zero); (ii)onlytwo flex sensorsarefittedratherthanfive—flexsensorsarethemostexpensive
part, andtwo(index+thumb)aresufficienttodemonstratedistinctposesforaproof-of-concept. The
wire format already carries five flex slots, so the two fitted sensors populate flex[0] and flex[1] and the
remaining slots read zero; no host change is needed when the other three are added.
1

|     |     |     |     |     |     | →   | →   |     | →   |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Figure 1: System block diagram: glove sensors ESP-32 PC software stack applications.
| 1.1 Conditions |     | carried   |     | from     | proposal | review |     |     |        |       |     |
| -------------- | --- | --------- | --- | -------- | -------- | ------ | --- | --- | ------ | ----- | --- |
|                |     |           |     |          |          |        |     |     | Status | Where |     |
| Condition      | /   | mandatory |     | addition |          |        |     |     |        |       |     |
Justify the critical function against ≥3 candidates Done §2.1
§2.2–2.4
| Provide | a CDFG   | with | node | costs and | the      | critical path |     |     | Done |     |     |
| ------- | -------- | ---- | ---- | --------- | -------- | ------------- | --- | --- | ---- | --- | --- |
| Provide | a system | FSM  | with | a fault   | and safe | state         |     |     | Done | §3  |     |
§4.1, §4.3
| State the | WCET | source | and | a schedulability |     | proof |     |     | Done |     |     |
| --------- | ---- | ------ | --- | ---------------- | --- | ----- | --- | --- | ---- | --- | --- |
All four conditions from the review sheet are closed; the evidence is the corresponding section.
| 2 Control    |       | Data | Flow     | Graph    |      |      |                |         |     |     |     |
| ------------ | ----- | ---- | -------- | -------- | ---- | ---- | -------------- | ------- | --- | --- | --- |
| 2.1 Choosing |       | the  | critical | function |      |      |                |         |     |     |     |
|              |       |      | Trigger  |          | Rate | Est. | exec. Deadline | Chosen? |     | Why |     |
| Function     | / ISR |      |          |          |      | time |                |         |     |     |     |
Window infer- prediction 4 Hz ∼15 ms 250 ms Chosen. Longest exe-
| ence           | (features | +   | timer |     |     |     |     | cution,  | most             | data depen- |     |
| -------------- | --------- | --- | ----- | --- | --- | --- | --- | -------- | ---------------- | ----------- | --- |
| model.predict) |           |     |       |     |     |     |     | dencies, | blocksactiondis- |             |     |
patch.
Frame poll (wireless poll 30 Hz ∼2–5 ms 33 ms No — small, stateless.
RX)
Frame parse (Sim- per data- 30 Hz <0.5 ms 33 ms No — trivial fixed cost.
| pleBinaryProtocol) |     |     | gram |     |     |     |     |     |     |     |     |
| ------------------ | --- | --- | ---- | --- | --- | --- | --- | --- | --- | --- | --- |
Justification: window inference in backend/app/routers/training.py::predict has the longest
execution time, consumes the whole buffered window (most data dependencies), and blocks the action
| dispatch | that   | follows | it.   |     |     |     |     |     |     |     |     |
| -------- | ------ | ------- | ----- | --- | --- | --- | --- | --- | --- | --- | --- |
|          | ·      | ·       |       |     |     |     |     |     |     |     |     |
| BACSE324 | Review | 2 Data  | Glove |     |     |     |     |     |     |     | 2   |

| 2.2 The | CDFG |     |     |     |     |     |     |     |     |
| ------- | ---- | --- | --- | --- | --- | --- | --- | --- | --- |
Figure 2: CDFG of predict(). Circles = operations, diamonds = decisions, solid = data edges,
| dashed   | = control | edges, | grouped | into     | basic blocks | BB0–BB3. |           |               |     |
| -------- | --------- | ------ | ------- | -------- | ------------ | -------- | --------- | ------------- | --- |
| 2.3 Node | table     |        |         |          |              |          |           |               |     |
|          |           |        | Inputs  | / output |              |          | Est. cost | (µs) Function |     |
Operation
| Check | window | ≥10 | frame | buffer | / drop |     | 200 | predict |     |
| ----- | ------ | --- | ----- | ------ | ------ | --- | --- | ------- | --- |
frames
| Split | into | 4 sensor | frames | / blocks |     |     | 400 | extract | features |
| ----- | ---- | -------- | ------ | -------- | --- | --- | --- | ------- | -------- |
blocks
| Per-axis |     |     | block | / 4 stats/axis |     |     | 2500 | extract | features |
| -------- | --- | --- | ----- | -------------- | --- | --- | ---- | ------- | -------- |
mean/std/min/max
| Concat       | into 64 | features | stats     | / vector |           |     | 300  | extract | features |
| ------------ | ------- | -------- | --------- | -------- | --------- | --- | ---- | ------- | -------- |
| Shape check  | vs      | model    | features, | model    | / ok,400  |     | 100  | predict |          |
| Load pickled | model   |          | path      | / model  |           |     | 1500 | predict |          |
| Reshape      | (1,−1)  |          | features  | /        | 2-D array |     | 50   | predict |          |
predict + predict proba features, model / id, conf 8000 predict
| Confidence | ≥   | thresh- | conf, | thr / | bool |     | 50  | predict | and act |
| ---------- | --- | ------- | ----- | ----- | ---- | --- | --- | ------- | ------- |
old?
Look up action binding gesture id / record 300 predict and act
| Execute      | action        | (uinput)       | config    | / input  | event         |               | 2000     | actions/* |     |
| ------------ | ------------- | -------------- | --------- | -------- | ------------- | ------------- | -------- | --------- | --- |
| All costs    | are estimated | (Python-level, |           | dev PC); | none measured | yet.          |          |           |     |
| 2.4 Critical |               | path           |           |          |               |               |          |           |     |
|              |               |                |           |          |               | Total latency | Deadline | Slack     |     |
| Critical     | path          | (node          | sequence) |          |               |               |          |           |     |
window → split → stats → concat → load → predict ∼15.3 ms 250 ms ∼234.7 ms
| →    | →      | →   |         |     |     |     |     |     |     |
| ---- | ------ | --- | ------- | --- | --- | --- | --- | --- | --- |
| conf | lookup |     | execute |     |     |     |     |     |     |
Dependency to break: the model load (1.5 ms) is on the path every call because predict re-opens
the .pkl. Yes — cache the model at startup in the Final build. Recomputing full-window statistics
(2.5 ms) could be made incremental, but slack is ample, so it is deferred.
|          | ·      | ·      |       |     |     |     |     |     |     |
| -------- | ------ | ------ | ----- | --- | --- | --- | --- | --- | --- |
| BACSE324 | Review | 2 Data | Glove |     |     |     |     |     | 3   |

| 3 System-behaviour |      | FSM |     |     |     |     |
| ------------------ | ---- | --- | --- | --- | --- | --- |
| 3.1 Model          | type |     |     |     |     |     |
Mealy. Outputs depend on state and input — a recognised gesture emits an action only when
confidence ≥ threshold. A Moore machine cannot express “act only if confident”.
| 3.2 State | diagram |     |     |     |     |     |
| --------- | ------- | --- | --- | --- | --- | --- |
Figure 3: System FSM. Every transition is labelled event [guard] / action.
| 3.3 State | transition | table |            |          |        |     |
| --------- | ---------- | ----- | ---------- | -------- | ------ | --- |
|           | Event      | Guard | Next state | Output / | action |     |
Current
state
IDLE start sensors available STREAMING open transport, buffer
IDLE start sensors unavailable FAULT sensor-unavailable error
| STREAMING | frame | buffer < window | STREAMING | append frame |     |     |
| --------- | ----- | --------------- | --------- | ------------ | --- | --- |
STREAMING window full bridge up, model TRACKING run inference
present
| STREAMING | link lost | —                  | FAULT    | glove-disconnected | error |     |
| --------- | --------- | ------------------ | -------- | ------------------ | ----- | --- |
| TRACKING  | tick      | confidence<thresh- | TRACKING | none (display      | “—”)  |     |
old
| TRACKING | tick | confidence≥thresh- | ACTING | dispatch action |     |     |
| -------- | ---- | ------------------ | ------ | --------------- | --- | --- |
old
ACTING action done binding found TRACKING inject key/mouse event
| ACTING | action | done no binding | TRACKING | none (logged) |     |     |
| ------ | ------ | --------------- | -------- | ------------- | --- | --- |
FAULT recover link/sensor restored RECOVER re-arm, clear buffer
| FAULT   | stop     | —             | IDLE      | close transport  |     |     |
| ------- | -------- | ------------- | --------- | ---------------- | --- | --- |
| RECOVER | re-armed | buffer primed | STREAMING | resume streaming |     |     |
· ·
| BACSE324 | Review 2 Data | Glove |     |     |     | 4   |
| -------- | ------------- | ----- | --- | --- | --- | --- |

| 3.4 Fault, | recovery | and | safe state |     |     |     |     |     |
| ---------- | -------- | --- | ---------- | --- | --- | --- | --- | --- |
Safe state (FAULT) outputs: the device emits no keyboard or mouse events — no key held, no
button pressed, no relative motion; every injected event ends with a release and syn(), so a stuck
modifier (e.g. held super) can never lock the desktop. FAULT is reachable from every other state
by the fatal-error / link-loss event. Recovery: recover → RECOVER, which clears the frame buffer
(stale frames must never be inferred against) and returns to STREAMING only once primed. A
→
watchdog transition (STREAMING/TRACKING FAULT on link lost) prevents a dropped wireless
| link leaving     | the   | system silently | half-running. |     |             |     |                    |     |
| ---------------- | ----- | --------------- | ------------- | --- | ----------- | --- | ------------------ | --- |
| 3.5 Completeness |       | check           |               |     |             |     |                    |     |
|                  | start |                 | frame         |     | window full |     | tick / bridge-down |     |
| State            | ↓ /   |                 |               |     |             |     |                    |     |
Event →
| IDLE       | STREAMING |         | —         |             | —         |     | —       |        |
| ---------- | --------- | ------- | --------- | ----------- | --------- | --- | ------- | ------ |
| STREAMING— |           |         | STREAMING |             | TRACKING  |     | FAULT   |        |
| TRACKING   | —         |         | —         |             | —         |     | FAULT   |        |
| ACTING     | —         |         | —         |             | —         |     | FAULT   |        |
| FAULT      | —         |         | —         |             | —         |     | RECOVER |        |
| RECOVER    | —         |         | —         |             | STREAMING |     | FAULT   |        |
| 4 Task     | schedule  |         |           |             |           |     |         |        |
| 4.1 Task   | set       |         |           |             |           |     |         |        |
|            |           | Trigger | Period    | WCET Deadl. | Prio      | U   | WCET    | source |
Task
|     |     |     | T   | C D |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
IMU sample timer, core 10 ms 0.42 ms 10 ms High 0.042 estimated (I2C
| (imuTask) |     | 0   |     |     |     |     | @400 | kHz) |
| --------- | --- | --- | --- | --- | --- | --- | ---- | ---- |
Flex sample timer, core 10 ms 0.18 ms 10 ms High 0.018 estimated (ADC
| (flexTask) |     | 0   |     |     |     |     | 12-bit) |     |
| ---------- | --- | --- | --- | --- | --- | --- | ------- | --- |
Frame build queue recv 10 ms 0.21 ms 10 ms Medium 0.021 estimated
(packetTask)
Wireless TX frame 10 ms 0.90 ms 10 ms Medium 0.090 estimated (UDP
| (txTask)   |      | ready |       |          |         |       | sendto)   |     |
| ---------- | ---- | ----- | ----- | -------- | ------- | ----- | --------- | --- |
| Host frame | poll | timer | 33 ms | ∼5 ms 33 | ms High | 0.152 | estimated |     |
Host inference timer 250 ms 15.3 ms 250 ms Med 0.061 estimated
tick
| Watchdog  |     | timer | 3000 | 0.05 ms 3000 | Low | 0.00002 | estimated |     |
| --------- | --- | ----- | ---- | ------------ | --- | ------- | --------- | --- |
| (wdtTask) |     |       | ms   | ms           |     |         |           |     |
Total utilisation U ≈ 0.17 on the ESP-32(fourfirmwaretasks)and U ≈ 0.21 on the host(poll
(I2C
+ inference + watchdog). All WCETs are estimated from the fixed peripheral costs transfer,
ADC conversion, UDP sendto) until measured with a GPIO toggle and logic analyser.
| 4.2 Scheduling |     | approach |     |     |     |     |     |     |
| -------------- | --- | -------- | --- | --- | --- | --- | --- | --- |
Task level: Rate-Monotonic (RMS). Operation level: ASAP list scheduling. The task set
is small, fixed-rate and preemption-cheap, so RMS static priorities are simple and provable. EDF
would allow higher utilisation but needs dynamic sorting and response-time checks; at U ≈ 0.23 it
buys nothing. A cyclic executive adds jitter without benefit. ASAP gives the shortest schedule for a
| mostly-serial | CDFG | chain. |     |     |     |     |     |     |
| ------------- | ---- | ------ | --- | --- | --- | --- | --- | --- |
· ·
| BACSE324 | Review | 2 Data Glove |     |     |     |     |     | 5   |
| -------- | ------ | ------------ | --- | --- | --- | --- | --- | --- |

| 4.3 Schedulability |     | analysis |     |     |     |     |     |     |
| ------------------ | --- | -------- | --- | --- | --- | --- | --- | --- |
n(21/n−1),
| RMS utilisation | bound | U ≤ |     | n = | 3 (poll, inference, watchdog): |     |     |     |
| --------------- | ----- | --- | --- | --- | ------------------------------ | --- | --- | --- |
bound = 3(21/3−1) = 0.7798, U = 5 + 15.3 + 1 = 0.2130 ≤ 0.7798.
|     |     |     |     |     | 33 250 3000 |     |     |     |
| --- | --- | --- | --- | --- | ----------- | --- | --- | --- |
On the ESP-32 the four firmware tasks run under FreeRTOS with rate-monotonic priorities (periods
10/10/10/3000 ms, U = 0.171); each completes well inside its 10 ms frame because the samplers are
fw
I2C/ADC
pure blocking reads with no dynamic allocation. Both task sets are schedulable by the
utilisationbound. Worst-caseresponse forthe hostinference task: R ≈ 15.3+5(one poll interference)
= 20.3 ms ≪ 250 ms (slack ≈ 229.7 ms), so no response-time analysis is required. ASAP control-step
chain: window → split → stats → concat → load → predict → conf → lookup → execute; all zero
| mobility | except the | model load, | removable | by  | caching. |     |     |     |
| -------- | ---------- | ----------- | --------- | --- | -------- | --- | --- | --- |
4.4 Timeline
Figure 4: Schedule over one hyperperiod (task level): poll @33 ms, inference @250 ms, watchdog
| @3000      | ms; each inference | bar     | sits well  | inside | its frame. |            |          |     |
| ---------- | ------------------ | ------- | ---------- | ------ | ---------- | ---------- | -------- | --- |
| 4.5 Shared | resources          | and     | interrupts |        |            |            |          |     |
|            |                    | Used by |            |        | Protection | Worst-case | blocking |     |
| Shared     | resource           |         |            |        |            |            |          |     |
SQLite glove.db record / train / predict session per request one transaction; no ISR
shares it
Frame buffer poll (write), inference single-threaded none observed
(read)
Model .pkl inference, retrain load-per-request ∼1.5 ms (removed by
caching)
uinput device action dispatch one UInput/action; serialised by OS input layer
syn()
| I2C bus |     | imuTask | / flexTask |     | one bus mutex | one transaction |     |     |
| ------- | --- | ------- | ---------- | --- | ------------- | --------------- | --- | --- |
Wireless RX ring firmware / host single-producer ring one buffer copy
txTask
| buffer |     | poll |     |     |     |     |     |     |
| ------ | --- | ---- | --- | --- | --- | --- | --- | --- |
· ·
| BACSE324 | Review 2 | Data Glove |     |     |     |     |     | 6   |
| -------- | -------- | ---------- | --- | --- | --- | --- | --- | --- |

| 5 Planned | traceability |     |         |      |     |         |          |       |     |
| --------- | ------------ | --- | ------- | ---- | --- | ------- | -------- | ----- | --- |
|           |              |     | Planned | file |     | Planned | function | Owner |     |
Model element
| Window    | guard |     | PredictUI.js |     |     | runPrediction |          | DJ  |     |
| --------- | ----- | --- | ------------ | --- | --- | ------------- | -------- | --- | --- |
| Feature   | build |     | training.py  |     |     | extract       | features | DJ  |     |
| Inference |       |     |              |     |     | predict       |          | DJ  |     |
training.py
| Dispatch        |     |     | training.py        |     |     | predict | and act | DJ  |     |
| --------------- | --- | --- | ------------------ | --- | --- | ------- | ------- | --- | --- |
| Input injection |     |     | input/keyboard.py, |     |     | tap     | / click | DJ  |     |
mouse.py
| FSM states |           |     | stateMachine.js       |     | (new) | —                    |                | SA  |     |
| ---------- | --------- | --- | --------------------- | --- | ----- | -------------------- | -------------- | --- | --- |
| Frame      | poll task |     | backend/app/bridge.py |     |       | get                  | latest grouped | SA  |     |
| Inference  | tick task |     | PredictUI.js          |     |       | setInterval(...,250) |                | DJ  |     |
Watchdog task frontend/src/components/RcehceocrkdBirnidgUgeI.js SA
| IMU sampling | task       |     | firmware/src/imu.c    |        |           | imuTask()    |     | DJ  |     |
| ------------ | ---------- | --- | --------------------- | ------ | --------- | ------------ | --- | --- | --- |
| Flex ADC     | task       |     | firmware/src/flex.c   |        |           | flexTask()   |     | DJ  |     |
| Frame        | build task |     | firmware/src/packet.c |        |           | packetTask() |     | DJ  |     |
| Wireless     | TX task    |     | firmware/src/net.c    |        |           | txTask()     |     | SA  |     |
| Watchdog     | task       |     | firmware/src/wdt.c    |        |           | wdtTask()    |     | SA  |     |
| 6 Plan       | to Final   |     |                       |        |           |              |     |     |     |
|              |            |     | Owner                 | Target | date Risk | and fallback |     |     |     |
| Remaining    | work       |     |                       |        |           |              |     |     |     |
Cache model in memory DJ early Oct Low; fallback = load per request
Extract FSM module SA early Oct Medium; fallback = FSM stays im-
plicit
Integrate ESP-32 + MPU-6500 + DJ mid Oct High (hardware); fallback = IMU-
| flex on | the glove |     |     |     | only |     |     |     |     |
| ------- | --------- | --- | --- | --- | ---- | --- | --- | --- | --- |
FreeRTOS task skeleton DJ mid Oct Medium; fallback=singlesuper-loop
(imuTask/flexTask/txTask)
Measure firmware WCETs (GPIO DJ mid Oct Medium; fallback = keep estimates
| toggle       | + logic analyser) |                 |          |          |        |     |       |       |     |
| ------------ | ----------------- | --------------- | -------- | -------- | ------ | --- | ----- | ----- | --- |
| Fault-state  | unit tests        |                 | SA       | late Oct | Low    |     |       |       |     |
| 7 Individual |                   | contribution    |          |          |        |     |       |       |     |
|              |                   | Model / section | produced |          | Module | for | Final | Share | %   |
Member
Dayakrishn Joshi System recap, CDFG, task set ESP-32 firmware + ADC 50
acquisition
Syed Mohammad System FSM, schedulability, traceabil- ESP-32 WiFi/UDP 50
| Ayaan |     | ity, plan |     |     | link | + PC | recognition |     |     |
| ----- | --- | --------- | --- | --- | ---- | ---- | ----------- | --- | --- |
pipeline
References
| 1. Espressif | Systems, | ESP32 Series Datasheet, | 2024. |     |     |     |     |     |     |
| ------------ | -------- | ----------------------- | ----- | --- | --- | --- | --- | --- | --- |
|              | · ·      |                         |       |     |     |     |     |     |     |
| BACSE324     | Review 2 | Data Glove              |       |     |     |     |     |     | 7   |

2. InvenSense,MPU-6500Six-Axis(Gyro+Accelerometer)MEMSMotionTrackingDeviceDatasheet,
2016.
| 3. InvenSense, | MPU-6500 | Register Map | and Descriptions, | rev. 1.4, 2016. |     |
| -------------- | -------- | ------------ | ----------------- | --------------- | --- |
4. C. L. Liu and J. W. Layland, “Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environ-
| ment,” | J. ACM, 20(1):46–61, | 1973. |     |     |     |
| ------ | -------------------- | ----- | --- | --- | --- |
· ·
| BACSE324 | Review 2 | Data Glove |     |     | 8   |
| -------- | -------- | ---------- | --- | --- | --- |
