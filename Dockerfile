# ---------- Base ----------
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---------- Desarrollo (hot-reload con Vite) ----------
FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5173
# node_modules vive en un volumen que sobrevive a los rebuilds: se sincroniza con package.json
# al arrancar, para que un cambio de versión (p. ej. Phaser 3 → 4) se aplique sin borrar volúmenes
CMD ["sh", "-c", "npm install --no-audit --no-fund && npm run dev"]

# ---------- Build de producción ----------
FROM base AS build
RUN npm install
COPY . .
# Las variables VITE_* se incrustan en el bundle en tiempo de build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ---------- Producción (nginx sirviendo estáticos) ----------
FROM nginx:1.27-alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
