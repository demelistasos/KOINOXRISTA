# Κοινόχρηστα — server για το σπίτι (CasaOS / Docker).
# Τα δεδομένα μένουν στο /data. Ο κώδικας ενημερώνεται μόνος του από τα Releases του GitHub.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core tzdata ca-certificates tar \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Athens \
    NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    CHROME_BIN=/usr/bin/chromium

WORKDIR /opt/koinoxrista
COPY package.json LICENSE.md ./
COPY server ./server
COPY src ./src

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/boot.js"]
