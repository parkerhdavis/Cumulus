FROM ubuntu:24.04

LABEL maintainer="Parker Davis"
LABEL description="Perforce Helix Core Server"

COPY p4d /usr/local/bin/p4d
COPY p4 /usr/local/bin/p4
RUN chmod +x /usr/local/bin/p4d /usr/local/bin/p4

EXPOSE 1666

VOLUME ["/data"]

ENTRYPOINT ["p4d"]
CMD ["-r", "/data", "-p", "1666"]
