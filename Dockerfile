FROM node:25-bookworm-slim

WORKDIR /usr/src/app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your code
COPY . .

# Start the application
CMD ["npm", "run", "start"]
