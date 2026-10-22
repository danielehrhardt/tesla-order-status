FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "start"]
