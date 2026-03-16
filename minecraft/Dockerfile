FROM node:22-slim

# canvas native deps for prismarine-viewer
RUN apt-get update && apt-get install -y \
  build-essential \
  libcairo2-dev \
  libjpeg-dev \
  libpango1.0-dev \
  libgif-dev \
  librsvg2-dev \
  python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src ./src
COPY public ./public
CMD ["node", "src/index.js"]
