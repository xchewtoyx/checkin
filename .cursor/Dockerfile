FROM node:22-bookworm-slim

# Cloud Agents clone the workspace and run install as this image's user.
# The official node image is root during build, but only has a `node`
# user (uid 1000). Cursor's agent runtime expects `ubuntu` with sudo.
USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        sudo \
    && rm -rf /var/lib/apt/lists/* \
    && (id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu) \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

USER ubuntu
