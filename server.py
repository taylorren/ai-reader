"""FastAPI server for the EPUB reader and AI-assisted annotation features."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent


def load_env():
    """Load environment variables from .env file."""
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        print("Loading .env file...")
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key.strip()] = value.strip()
        print(f"✓ Loaded Ollama endpoint: {os.getenv('OLLAMA_BASE_URL', 'Not set')}")
    else:
        print("⚠ Warning: .env file not found. AI features will not work.")


load_env()

app = FastAPI()
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# Register routers
from routers.library import router as library_router
from routers.highlights import router as highlights_router
from routers.ai import router as ai_router
from routers.settings import router as settings_router

app.include_router(library_router)
app.include_router(highlights_router)
app.include_router(ai_router)
app.include_router(settings_router)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("READER_HOST", "0.0.0.0")
    port = int(os.getenv("READER_PORT", "8123"))
    print(
        f"Starting server at http://{host}:{port} "
        "(accessible externally if firewall/NAT allow)"
    )
    uvicorn.run(app, host=host, port=port)
