# Static WebGPU client served by nginx on Cloud Run (rail-simulator-fe)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# API base is baked in at build time (Vite env)
ARG VITE_API_BASE
ENV VITE_API_BASE=${VITE_API_BASE}
# models / sounds / HDRI are served by this same nginx (never the local dev server from .env)
ARG VITE_ASSETS_BASE=
ENV VITE_ASSETS_BASE=${VITE_ASSETS_BASE}
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
