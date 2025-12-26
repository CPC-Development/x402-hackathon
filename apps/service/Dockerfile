FROM node:20-bullseye

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

COPY index.js ./

EXPOSE 4000

CMD ["node", "index.js"]
