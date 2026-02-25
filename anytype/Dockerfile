FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash anytype

USER anytype
WORKDIR /home/anytype

RUN curl -sSf https://raw.githubusercontent.com/anyproto/anytype-cli/HEAD/install.sh | bash

RUN mkdir -p /home/anytype/.anytype

ENV PATH="/home/anytype/.local/bin:${PATH}"

EXPOSE 31010 31011 31012

ENTRYPOINT ["anytype"]
CMD ["serve", "--listen-address", "0.0.0.0:31012"]
