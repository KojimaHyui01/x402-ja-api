FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save tsx@4
COPY src ./src
COPY tsconfig.json ./
EXPOSE 4021
CMD ["npx", "tsx", "src/index.ts"]
