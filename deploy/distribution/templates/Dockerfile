FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs container.mjs ./
ENV RCM_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 7331
CMD ["node", "container.mjs"]
