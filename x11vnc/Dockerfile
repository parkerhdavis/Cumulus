FROM ubuntu:24.04

LABEL maintainer="Parker Davis"
LABEL description="x11vnc sharing the host's real X11 display through mounted sockets"

RUN apt-get update \
	&& apt-get install -y --no-install-recommends x11vnc \
	&& rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5900

ENTRYPOINT ["/entrypoint.sh"]