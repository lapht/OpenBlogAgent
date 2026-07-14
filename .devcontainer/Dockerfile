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
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@10.9.0

RUN npm install -g \
    typescript \
    ts-node \
    eslint \
    prettier

RUN corepack enable

CMD ["sleep", "infinity"]
