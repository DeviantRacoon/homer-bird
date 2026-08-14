# Homer Bird Backend Server Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copiar dependencias del servidor
COPY package.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev

# Copiar código fuente y datos iniciales
COPY server.js ./
COPY src/ ./src/
COPY data/ ./data/

# Variables por defecto
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIRECTORY=/app/data

EXPOSE 3001

CMD ["node", "server.js"]
