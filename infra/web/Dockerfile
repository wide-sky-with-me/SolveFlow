FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
WORKDIR /opt/solveflow
COPY server.mjs ./server.mjs
COPY web/ ./web/
COPY manifest.json ./manifest.json
ENV NODE_ENV=production SOLVEFLOW_WEB_PORT=3130 SOLVEFLOW_WEB_DIR=/opt/solveflow/web SOLVEFLOW_WEB_STATE_DIR=/var/lib/solveflow
USER node
EXPOSE 3130
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.SOLVEFLOW_WEB_PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
