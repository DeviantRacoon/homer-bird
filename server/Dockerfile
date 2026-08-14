# Homer Bird Backend Server Dockerfile
FROM node:20-alpine

WORKDIR /app

# 1. Copiar package.json del backend e instalar dependencias de producción
COPY server/package.json ./
RUN npm install --omit=dev

# 2. Copiar código fuente, módulos y datos
COPY server/server.js ./
COPY server/src/ ./src/
COPY server/data/ ./data/

# 3. Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIRECTORY=/app/data

EXPOSE 3001

CMD ["node", "server.js"]
