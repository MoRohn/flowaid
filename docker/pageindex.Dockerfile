# The FlowAId PageIndex service (apps/pageindex): Python 3.12, the pinned pageindex SDK installed
# from a hash-locked requirements file, non-root, data under /data. Built by `docker compose
# --profile pageindex build pageindex`. It listens on the private network only; the api and
# worker reach it with FLOWAID_PAGEINDEX_URL and a shared token.
ARG PYTHON_IMAGE=python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY apps/pageindex/requirements.lock ./requirements.lock
RUN pip install --require-hashes --only-binary=:all: -r requirements.lock \
    && groupadd --gid 10001 flowaid \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin flowaid \
    && mkdir -p /data \
    && chown flowaid:flowaid /data
COPY apps/pageindex/flowaid_pageindex ./flowaid_pageindex
COPY apps/pageindex/LICENSE-THIRD-PARTY.md ./LICENSE-THIRD-PARTY.md
USER 10001:10001
ENV FLOWAID_PAGEINDEX_HOST=0.0.0.0 \
    FLOWAID_PAGEINDEX_PORT=8765 \
    FLOWAID_PAGEINDEX_DATA_DIR=/data
EXPOSE 8765
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/readyz', timeout=4).status == 200 else 1)"]
CMD ["python", "-m", "flowaid_pageindex"]
