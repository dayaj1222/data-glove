from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import gestures, recordings, actions, training, bindings, device

app = FastAPI(title="Data Glove API", version="0.1.0")

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

@app.get("/")
async def root():
    return {"status": "ok"}
