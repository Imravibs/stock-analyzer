FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY server/ ./server/
COPY public/ ./public/

# Expose port
EXPOSE 3001

# Start the application
CMD ["node", "server/index.js"]