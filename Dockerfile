FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
COPY data ./data
COPY tsconfig.json ./
EXPOSE 4021
CMD ["npx", "tsx", "src/index.ts"]
