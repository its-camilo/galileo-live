FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    MALLOC_ARENA_MAX=2 \
    PYTHONUNBUFFERED=1 \
    GALILEO_DATA_DIR=/data \
    MPLCONFIGDIR=/opt/galileo/mpl \
    XDG_CACHE_HOME=/data/cache \
    TECTONIC_CACHE_DIR=/opt/galileo/tectonic

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

# Precalienta tectonic (paquetes TeX y fuentes) y matplotlib dentro de la imagen.
# Sin esto, en Render free (sin disco) la primera compilación tras cada arranque
# descarga el bundle de TeX y el informe tarda minutos.
COPY warmup ./warmup
RUN mkdir -p "$TECTONIC_CACHE_DIR" "$MPLCONFIGDIR" \
 && python warmup/plot.py warmup/fig.png \
 && for lang in english spanish; do \
      sed "s/BABEL_LANG/$lang/" warmup/warmup.tex > "warmup/warmup-$lang.tex"; \
      tectonic -X compile --outdir warmup "warmup/warmup-$lang.tex"; \
    done \
 && rm -rf warmup

RUN useradd --create-home --uid 10001 galileo \
 && mkdir -p /data \
 && chown -R galileo:galileo /opt/galileo

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header --limit-concurrency 40 --timeout-keep-alive 5"]
