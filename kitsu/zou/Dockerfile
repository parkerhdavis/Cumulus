ARG PY_V=3.13

FROM python:${PY_V}-slim AS builder
RUN apt-get update \
	&& apt-get install -y --no-install-recommends make python3-dev gcc g++ \
	&& rm -rf /var/lib/apt/lists/*

ARG PY_V
ARG ZOU_VERSION
RUN pip install --no-cache-dir --upgrade pip wheel setuptools \
	&& pip install --no-cache-dir zou==${ZOU_VERSION}

FROM python:${PY_V}-slim

LABEL maintainer="Parker Davis"
LABEL description="Zou (CGWire API) - Cumulus build"

ARG PY_V
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ffmpeg bzip2 postgresql-client \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python${PY_V} /usr/local/lib/python${PY_V}
COPY --from=builder /usr/local/bin /usr/local/bin

ENV ZOU_FOLDER=/usr/local/lib/python${PY_V}/site-packages/zou
WORKDIR ${ZOU_FOLDER}
