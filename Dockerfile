# Servidor da Resenha (só o necessário; não tem dependências).
FROM node:22-alpine
WORKDIR /srv
COPY server ./server
COPY app ./app
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server/server.js"]
