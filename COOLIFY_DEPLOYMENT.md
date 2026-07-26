# Deploying StockPulse AI to Coolify

## Prerequisites

1. A Linux server/VPS (Ubuntu 20.04+, Debian 10+, CentOS 7+, etc.) with at least 1GB RAM
2. Domain name pointing to your server (optional but recommended)
3. Basic familiarity with SSH and command line

## Step 1: Prepare Your Server

First, SSH into your server:

```bash
ssh your-user@your-server-ip
```

### Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y curl git wget

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker  # Apply group membership immediately

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

Verify installation:
```bash
docker --version
docker-compose --version
```

## Step 2: Install Coolify

Run the official installation script:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This will:
- Install Coolify on your server
- Start the Coolify service
- Provide you with the URL and initial admin credentials

After installation completes, you'll see output similar to:
```
✅ Coolify installed successfully!
🌐 Access your dashboard at: http://your-server-ip:8000
🔑 Initial admin credentials:
   Email: admin@coolify.io
   Password: auto-generated-password-shown-here
```

**Important**: Save these credentials and change your password immediately after first login.

## Step 3: Configure Coolify

1. Open your browser and go to `http://your-server-ip:8000`
2. Log in with the provided credentials
3. Immediately change your admin password (Settings → Profile)
4. Add your server as a resource (if not auto-detected):
   - Go to Resources → Servers
   - Click "Add Server"
   - Select "This server" (localhost) or add remote server via SSH

## Step 4: Prepare Your Application for Deployment

Your StockPulse AI application is already configured for Coolify deployment with:

1. **Dockerfile** - Defines how to build your application image
2. **docker-compose.yml** - Defines services and configuration  
3. **.env.example** - Shows required environment variables

### Important Configuration Notes:

- Coolify will automatically detect your Docker Compose file
- You'll need to set environment variables in Coolify's interface:
  - `GEMINI_API_KEY`: Get free key from [Google AI Studio](https://aistudio.google.com/app/apikey)
  - `GEMINI_MODEL`: Optional, defaults to `gemini-2.5-flash`
  - `OPENROUTER_API_KEY`: Optional, for using OpenRouter instead
  - `NODE_ENV`: Set to "production" (already in docker-compose.yml)
  - `PORT`: Set to 3001 (already in docker-compose.yml)

**Security Note**: Never commit your actual API keys to git. Use Coolify's encrypted secret storage or environment variables interface.

## Step 5: Deploy via Coolify

### Option A: Git Repository Deployment (Recommended)

1. Push your code to a Git repository (GitHub, GitLab, etc.)
2. In Coolify dashboard:
   - Go to "Resources" → "Applications"
   - Click "+ New Application"
   - Select "Docker Compose" as the application type
   - Connect your Git repository
   - Select the branch to deploy (usually main or master)

3. Configure:
   - Name: `stock-pulse-ai` (or your preferred name)
   - Repository: Your Git repo URL
   - Docker Compose File: `docker-compose.yml` (auto-detected)
   - Environment Variables: Add your API keys via Coolify's UI (Settings → Environment Variables)
   - Ports: Map container port 3001 to host port (e.g., 8080→3001) - Coolify handles this via reverse proxy
   - Domain: Optional, set up a domain or use subdomain (Coolify provides built-in reverse proxy with SSL)

4. Click "Deploy" - Coolify will:
   - Clone your repository
   - Build the Docker image using your Dockerfile
   - Start your application using Docker Compose
   - Set up reverse proxy and SSL (if domain configured)
   - Provide logs and monitoring

### Option B: Manual Deployment

1. Copy your application to the server:
   ```bash
   scp -r stock-analyzer/ your-user@your-server-ip:/opt/stock-analyzer
   ```

2. In Coolify dashboard:
   - Create new Docker Compose application
   - Choose "Manual" as source type
   - Set source path to `/opt/stock-analyzer`
   - Configure environment variables and ports
   - Deploy

## Step 6: Post-Deployment Configuration

### Reverse Proxy & SSL (Recommended)
If you have a domain:
1. In your application settings in Coolify, go to "Resources" 
2. Add a reverse proxy
3. Configure your domain and enable SSL (Let's Encrypt integration)
4. Coolify will automatically handle certificate renewal

### Resource Allocation
Adjust resources based on your server capacity:
- CPU: 0.5-1 core
- Memory: 512MB-1GB
- Storage: 2GB+ (for logs and data)

### Monitoring
Coolify provides:
- Real-time resource usage (CPU, RAM, Disk)
- Container logs (accessible from dashboard)
- Deployment history
- Health checks and restart policies

## Troubleshooting

### Common Issues:

1. **Application fails to start**
   - Check logs in Coolify dashboard (Application → Logs)
   - Verify environment variables are set correctly in Coolify UI
   - Ensure port 3001 is not conflicting with other services (Coolify handles port mapping)

2. **Database/SQLite issues**
   - This application uses in-memory caching and file-based storage
   - No external database required

3. **API Key not working**
   - Verify your Gemini API key is valid and has sufficient quota
   - Check that you're not exceeding rate limits (Google Gemini has free tier limits)
   - Test your API key directly with Google's API explorer

4. **Port conflicts**
   - Coolify's reverse proxy typically uses ports 80/443
   - Your application runs on port 3001 internally
   - If you need to change the host port, adjust in Coolify's network settings

### Logs Access
- View logs directly in Coolify dashboard under your application → Logs
- Access container logs via SSH: `docker service logs <service-name>` or `docker container logs <container-name>`

## Maintenance

### Updates
When you push new code to your Git repository:
1. Go to your application in Coolify
2. Click "Pull & Deploy" or enable auto-deploy on push (Settings → Webhooks)

### Backups
Coolify includes built-in backup functionality:
- Configure backup schedule in Resources → Backups
- Backup includes your application data, configurations, and volumes
- Store backups externally for disaster recovery

## Security Recommendations

1. **Enable HTTPS** - Always use SSL/TLS for production (Coolify automates this with Let's Encrypt)
2. **Firewall** - Only expose necessary ports (80, 443 for web, 22 for SSH)
3. **Regular Updates** - Keep your server OS and Docker updated
4. **API Key Security** - Never commit API keys to git; use Coolify's encrypted secret storage
5. **Regular Backups** - Schedule automated backups of your application data and volumes
6. **Monitor Resource Usage** - Set up alerts for high CPU/memory usage

## Performance Optimization

For higher traffic:
1. Increase container resources in Coolify settings (Resources tab)
2. Consider adding Redis for caching if needed (add as separate service in docker-compose.yml)
3. Use a CDN for static assets (Cloudflare, etc.)
4. Monitor and scale based on actual usage patterns

## Support

If you encounter issues:
1. Check Coolify documentation: https://coolify.io/docs
2. Review application logs in the Coolify dashboard
3. Verify your server meets minimum requirements (1GB RAM recommended, 2GB+ for better performance)
4. Check GitHub issues for StockPulse AI repository
5. Test API keys directly with Google's API tools to isolate issues

## Environment Variables Summary

| Variable | Required | Description | Source |
|----------|----------|-------------|--------|
| GEMINI_API_KEY | Yes | Google Gemini API key | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| GEMINI_MODEL | No | Gemini model to use (default: gemini-2.5-flash) | Optional |
| OPENROUTER_API_KEY | No | OpenRouter API key (alternative) | [OpenRouter](https://openrouter.ai/) |
| NODE_ENV | No | Set to "production" | Already set in docker-compose.yml |
| PORT | No | Application port (default: 3001) | Already set in docker-compose.yml |

Your StockPulse AI application is now ready for production deployment on Coolify! The platform handles container management, SSL certificates, updates, and monitoring, allowing you to focus on your application rather than infrastructure management.

**Next Steps**: Get your Google Gemini API key, push your code to a Git repository, and follow the deployment steps above.