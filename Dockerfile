# syntax=docker/dockerfile:1
#
# Build:  docker buildx build --platform linux/amd64 -t epub-ai-reader:1.0.0 --load .
# Save:  docker save -o epub-ai-reader-amd64.tar epub-ai-reader:1.0.0
#
# Derivative of the original reader3 by Andrej Karpathy (MIT),
# https://github.com/karpathy/reader3 — see LICENSE for details.

FROM python:3.12-slim-bookworm AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependency layer: only the lock files, so this is cached until deps change.
COPY pyproject.toml uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    READER_HOST=0.0.0.0 \
    READER_PORT=8123

ARG VCS_REF=""
ARG BUILD_DATE=""

LABEL org.opencontainers.image.title="ePub AI Reader" \
      org.opencontainers.image.description="Self-hosted EPUB reader with AI-assisted fact-checking and discussion. Derivative of karpathy/reader3." \
      org.opencontainers.image.url="https://github.com/taylorren/ai-reader" \
      org.opencontainers.image.source="https://github.com/taylorren/ai-reader" \
      org.opencontainers.image.documentation="https://github.com/taylorren/ai-reader#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Taylor Ren" \
      org.opencontainers.image.base.name="docker.io/library/python:3.12-slim-bookworm" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# uid/gid 1000 matches the NAS `tr` account so bind mounts are writable.
RUN groupadd --gid 1000 reader \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin reader

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv

COPY server.py reader3.py database.py ai_service.py ./
COPY routers/ ./routers/
COPY templates/ ./templates/
COPY static/ ./static/

# /app must be writable: uploads stage files into /app/temp, and reader3.py
# runs with cwd=/app when processing an upload.
RUN mkdir -p /app/temp /app/books /data \
    && chown -R reader:reader /app /data

# CWD is /data so that Database()'s default "reader_data.db" lands inside the
# mounted volume. BASE_DIR is derived from __file__, so static/templates stay
# under /app regardless.
WORKDIR /data

USER reader

EXPOSE 8123

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8123/', timeout=4).status==200 else 1)"]

CMD ["python", "/app/server.py"]