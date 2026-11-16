# A few MB of RAM: nginx serving public/. config.js is written from env vars at every start.
FROM nginx:1.27-alpine
COPY public/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY write-config.sh /docker-entrypoint.d/40-write-config.sh
RUN chmod 755 /docker-entrypoint.d/40-write-config.sh
