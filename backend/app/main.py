from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    """
    if os.environ.get("GLOVE_AUTOOPEN", "").lower() in ("1", "true", "yes"):
        port = os.environ.get("GLOVE_PORT") or None
        ok = serial_manager.open(port)
        serial_manager.log(
            f"[host] autoopen {'ok' if ok else 'failed'} port={serial_manager.port}"
        )
    yield
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

@app.get("/")
async def root():
    return {"status": "ok"}
