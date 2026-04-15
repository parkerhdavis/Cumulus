FROM ubuntu:24.04

LABEL maintainer="Parker Davis"
LABEL description="Ark VCS Server"

# Ark is a single static binary with no runtime dependencies,
# but we use ubuntu as the base for troubleshooting convenience
# (curl, bash, etc. are available if you ever need to shell in).

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 && rm -rf /var/lib/apt/lists/*

COPY ark /usr/local/bin/ark
COPY ark-cli /usr/local/bin/ark-cli
RUN chmod +x /usr/local/bin/ark /usr/local/bin/ark-cli

EXPOSE 9000

VOLUME ["/data/ark-server"]

ENTRYPOINT ["ark", "server"]
CMD ["-path", "/data/ark-server", "-port", "9000"]
