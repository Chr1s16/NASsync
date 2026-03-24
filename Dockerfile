FROM node:20-alpine

RUN apk add --no-cache rsync util-linux

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN mkdir -p /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/jobs || exit 1

CMD ["node", "backend/server.js"]
