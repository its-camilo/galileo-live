FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GALILEO_DATA_DIR=/data \
    MPLCONFIGDIR=/data/mpl \
    XDG_CACHE_HOME=/data/cache

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl gosu \
 && rm -rf /var/lib/apt/lists/*

ARG TECTONIC_VERSION=0.17.0
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64) target=x86_64-unknown-linux-musl ;; \
      aarch64) target=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported arch $arch" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${target}.tar.gz" \
      | tar -xz -C /usr/local/bin tectonic; \
    tectonic --version

WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 10001 galileo \
 && mkdir -p /data

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header --limit-concurrency 40 --timeout-keep-alive 5"]
