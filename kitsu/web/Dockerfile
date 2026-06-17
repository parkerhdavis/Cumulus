FROM nginx:alpine AS buildStage
WORKDIR /opt
RUN apk add --no-cache --virtual .build-deps git
ARG KITSU_VERSION
RUN git clone -b "${KITSU_VERSION}-build" --single-branch --depth 1 https://github.com/cgwire/kitsu \
	&& apk --purge del .build-deps

FROM nginx:alpine

LABEL maintainer="Parker Davis"
LABEL description="Kitsu (CGWire frontend) - Cumulus build"

COPY --from=buildStage / /
COPY ./nginx.conf /etc/nginx/nginx.conf
