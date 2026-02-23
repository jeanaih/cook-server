# Step 1: Use a slim Node.js base image
FROM node:20-slim

# Step 2: Set the working directory
WORKDIR /app

# Step 3: Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Step 4: Copy the rest of the application code
# (Basta siguraduhin na ang serviceAccountKey.json ay nasa root)
COPY . .

# Step 5: Expose the port (GCP Cloud Run defaults to 8080 or PORT env)
ENV PORT=3000
EXPOSE 3000

# Step 6: Start the server
CMD ["node", "server.js"]
