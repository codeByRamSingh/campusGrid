FROM node:22-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push && npm run seed && node dist/server.js"]
