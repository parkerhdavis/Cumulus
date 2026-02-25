# Anytype CLI — First-Time Setup

## Prerequisites

Create the data volume before starting the service:

```sh
docker volume create anytype-data
```

## Start the Service

```sh
make up phd-server
```

Verify the container is running:

```sh
make ps phd-server
```

## Account Setup

Once the container is running, exec in to create an account and API key:

```sh
# Create a bot account
docker exec -it anytype anytype auth create <bot-name>

# Join a space via invite link
docker exec -it anytype anytype space join <invite-link>

# Create an API key for programmatic access
docker exec -it anytype anytype auth apikey create <key-name>
```

## Pangolin Routing

To expose the Anytype API externally, add a resource in the [Pangolin dashboard](https://pangolin.parkerhdavis.com) pointing to `localhost:31012`.

## Verify

After setup, the HTTP API should be reachable at `http://localhost:31012` on the host (or via your Pangolin route externally).
