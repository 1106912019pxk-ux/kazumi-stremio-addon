FROM node:22-alpine

WORKDIR /app
COPY LICENSE ./LICENSE
COPY stremio-addon/package.json ./package.json
COPY stremio-addon/pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY stremio-addon/src ./src

ENV HOST=0.0.0.0
ENV PORT=7000
EXPOSE 7000

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
