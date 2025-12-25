FROM node:20-bullseye

WORKDIR /app

# Enable corepack and install deps
RUN corepack enable

COPY package.json ./
COPY tsconfig.json ./
COPY hardhat.config.ts ./
COPY contracts ./contracts
COPY scripts ./scripts

RUN yarn install

EXPOSE 8545

CMD ["./scripts/docker-start.sh"]
