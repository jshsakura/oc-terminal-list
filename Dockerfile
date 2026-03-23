# Multi-stage build
# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend with frontend static files
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    locales \
    curl \
    wget \
    git \
    build-essential \
    libssl-dev \
    zlib1g-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    llvm \
    libncurses5-dev \
    libncursesw5-dev \
    xz-utils \
    tk-dev \
    libxml2-dev \
    libxmlsec1-dev \
    libffi-dev \
    liblzma-dev \
    zsh \
    fzf \
    vim \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen

# Install Oh My Zsh and Plugins (Global)
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended \
    && git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions \
    && git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting \
    && git clone https://github.com/zsh-users/zsh-completions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-completions \
    && git clone https://github.com/zsh-users/zsh-history-substring-search ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-history-substring-search

# Configure .zshrc with Agnoster theme and plugins
RUN sed -i 's/ZSH_THEME="robbyrussell"/ZSH_THEME="agnoster"/' ~/.zshrc \
    && sed -i 's/plugins=(git)/plugins=(git z zsh-autosuggestions zsh-syntax-highlighting zsh-completions zsh-history-substring-search fzf)/' ~/.zshrc \
    && echo "export TERM=xterm-256color" >> ~/.zshrc \
    && echo "export LANG=ko_KR.UTF-8" >> ~/.zshrc \
    && echo '[ -f /usr/share/doc/fzf/examples/key-bindings.zsh ] && source /usr/share/doc/fzf/examples/key-bindings.zsh' >> ~/.zshrc \
    && echo '[ -f /usr/share/doc/fzf/examples/completion.zsh ] && source /usr/share/doc/fzf/examples/completion.zsh' >> ~/.zshrc

# Docker CLI 설치 (호스트 도커 제어용)
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh && rm get-docker.sh

# nvm (Node Version Manager) 설치
ENV NVM_DIR=/root/.nvm
ENV NODE_VERSION=lts/*

RUN mkdir -p $NVM_DIR \
    && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default \
    && npm install -g @anthropic-ai/claude-code

# PATH에 Node.js 추가
RUN echo "export PATH=\"\$NVM_DIR/versions/node/\$(ls \$NVM_DIR/versions/node | tail -1)/bin:\$PATH\"" >> ~/.bashrc \
    && echo "export PATH=\"\$NVM_DIR/versions/node/\$(ls \$NVM_DIR/versions/node | tail -1)/bin:\$PATH\"" >> ~/.zshrc

# nvm을 자동으로 로드하도록 rc 설정
RUN echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc \
    && echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc \
    && echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc \
    && echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc \
    && echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.zshrc \
    && echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.zshrc

# pyenv (Python Version Manager) 설치
ENV PYENV_ROOT=/root/.pyenv
ENV PATH=$PYENV_ROOT/shims:$PYENV_ROOT/bin:$PATH

RUN git clone https://github.com/pyenv/pyenv.git $PYENV_ROOT \
    && cd $PYENV_ROOT && src/configure && make -C src \
    && echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc \
    && echo 'export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc \
    && echo 'eval "$(pyenv init -)"' >> ~/.bashrc \
    && echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc \
    && echo 'export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc \
    && echo 'eval "$(pyenv init -)"' >> ~/.zshrc

# 로케일 및 쉘 환경 변수 설정
ENV LANG=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8
ENV LANGUAGE=ko_KR:ko
ENV SHELL=/bin/zsh

# Python 의존성 설치
COPY backend/requirements.txt .
# pyenv의 pip가 아니라 시스템 pip로 FastAPI 의존성 설치 (volumne에 의해 가려지지 않게 함)
RUN /usr/local/bin/pip install --no-cache-dir -r requirements.txt

# Configure user package installation paths for persistence (Fallback for system python)
ENV PIP_USER=1
ENV PYTHONUSERBASE=/root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy backend code
COPY backend/ .

# Copy built frontend from stage 1
COPY --from=frontend-builder /build/dist ./static

# Environment variables
ENV DB_PATH=/app/data/iterminallist.db
ENV REDIS_HOST=redis
ENV REDIS_PORT=6379

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Run server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
