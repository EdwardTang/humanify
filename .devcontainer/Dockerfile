FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install system dependencies
RUN apt-get update && apt-get install -y \
    sox \
    ffmpeg \
    alsa-utils \
    pulseaudio \
    python3-pip \
    curl \
    gnupg \
    ripgrep \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest \
    && mkdir -p /usr/local/lib/node_modules \
    && chown -R vscode:vscode /usr/local/lib/node_modules \
    && chmod -R 775 /usr/local/lib/node_modules \
    && npm config set prefix /home/vscode/.npm-global \
    && mkdir -p /home/vscode/.npm-global \
    && chown -R vscode:vscode /home/vscode/.npm-global

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set up environment variables for Node.js global packages
ENV PATH="/home/vscode/.npm-global/bin:${PATH}"
ENV NPM_CONFIG_PREFIX=/home/vscode/.npm-global

# Add instructions for the user
RUN echo 'export PATH="/home/vscode/.npm-global/bin:$PATH"' >> /home/vscode/.bashrc 

# Pre-install Python dependencies with pip
RUN pip3 install --no-cache-dir openai-whisper torch --quiet

# Create necessary directories for Whisper Assistant
RUN mkdir -p /home/vscode/.config/Code/User/globalStorage/martinopensky.whisper-assistant/temp \
    && mkdir -p /home/vscode/.cursor-server/data/User/globalStorage/martinopensky.whisper-assistant/temp \
    && chmod -R 755 /home/vscode/.config/Code \
    && chmod -R 755 /home/vscode/.cursor-server \
    && chown -R vscode:vscode /home/vscode/.config \
    && chown -R vscode:vscode /home/vscode/.cursor-server

# Generate test audio file
RUN sox -n /home/vscode/.cursor-server/data/User/globalStorage/martinopensky.whisper-assistant/temp/test.wav synth 3 sine 440 

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code