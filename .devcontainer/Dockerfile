FROM node:20-bookworm

WORKDIR /workspace

RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    ripgrep \
    ffmpeg \
    imagemagick \
    bash \
    python3 \
    python3-pip \
    python3-venv \
    pipx \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:${PATH}"

RUN pipx install graphifyy

RUN npm install -g npm@10.9.0

RUN npm install -g \
    typescript \
    ts-node \
    eslint \
    prettier

RUN corepack enable

CMD ["sleep", "infinity"]