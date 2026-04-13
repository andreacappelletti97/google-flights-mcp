FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist/ dist/

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js", "--http"]
