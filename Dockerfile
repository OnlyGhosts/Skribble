# syntax=docker/dockerfile:1
# Multi-stage build: compile the client (Vite) and server (esbuild), then ship a small runtime image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV PORT=3001
EXPOSE 3001
USER node
# The server serves dist/client (resolved from the working directory) and the /ws endpoint on $PORT.
CMD ["node", "dist/server/index.js"]
