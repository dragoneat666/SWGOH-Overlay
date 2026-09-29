FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /app/uploads

EXPOSE 4001

CMD ["node", "src/index.js"]
