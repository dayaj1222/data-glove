from contextlib import asynccontextmanager
import asyncio
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routers import gestures, recordings, actions, training, bindings, device, cursor
from .serial_manager import serial_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Open the glove's serial port on startup when asked to.

    The port is deliberately NOT opened unconditionally: a second backend, or
    a user who wants to flash the board, must be able to start the API without
    fighting over the device. Set GLOVE_AUTOOPEN=1 to have the server claim the
    port itself, which is what a dev/demo run wants -- otherwise every restart
    silently leaves the API up with no sensor data.

    Opening is retried in the background rather than once: the board is very
    often not plugged in yet when the server starts (unplugged USB-serial
    bridges simply do not exist as device nodes), and giving up silently meant
    the UI sat on "no device" until someone remembered to POST /device/open.
    Set GLOVE_NO_RETRY=1 to disable retrying.
    """
    retry_task = None

    if os.environ.get("GLOVE_AUTOOPEN", "").lower() in ("1", "true", "yes"):
        port = os.environ.get("GLOVE_PORT") or None

        def try_open() -> bool:
            ok = serial_manager.open(port)
            serial_manager.log(
                f"[host] autoopen {'ok' if ok else 'failed'} "
                f"port={serial_manager.port} error={serial_manager.last_error}"
            )
            return ok

        if not try_open() and os.environ.get("GLOVE_NO_RETRY", "").lower() not in (
            "1", "true", "yes",
        ):
            async def keep_trying() -> None:
                # 2 s cadence matches the firmware's own IMU retry, and is slow
                # enough that a genuinely absent board costs nothing.
                while not serial_manager.is_open:
                    await asyncio.sleep(2.0)
                    if serial_manager.is_open:
                        return
                    try_open()

            retry_task = asyncio.create_task(keep_trying())

    yield

    if retry_task is not None:
        retry_task.cancel()
        try:
            await retry_task
        except asyncio.CancelledError:
            pass
    serial_manager.close()


app = FastAPI(title="Data Glove API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(gestures.router, prefix="/api/gestures", tags=["gestures"])
app.include_router(recordings.router, prefix="/api/recordings", tags=["recordings"])
app.include_router(actions.router, prefix="/api/actions", tags=["actions"])
app.include_router(training.router, prefix="/api/training", tags=["training"])
app.include_router(bindings.router, prefix="/api", tags=["bindings"])
app.include_router(device.router, prefix="/api", tags=["device"])
app.include_router(cursor.router, prefix="/api", tags=["cursor"])

@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serve the built web UI from the same process (run-demo.sh builds it): one port, no node server
# needed at run time. Without a build, "/" stays a plain status endpoint.
_UI_DIR = Path(__file__).resolve().parents[2] / "frontend" / "build"
if (_UI_DIR / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(_UI_DIR), html=True), name="ui")
else:
    @app.get("/")
    async def root():
        return {"status": "ok"}
