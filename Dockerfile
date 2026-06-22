FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY server/package*.json server/
COPY client/package*.json client/
RUN cd server && npm install
RUN cd client && npm install

COPY server server
COPY client client
RUN cd client && npm run build
RUN cd server && npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

COPY --from=build /app/server/package*.json server/
RUN cd server && npm install --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

VOLUME ["/app/data"]
EXPOSE 8787
CMD ["node", "server/dist/index.js"]
