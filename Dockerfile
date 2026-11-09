# AI_NovelGenerator 一体化镜像：前端(Next.js) + 后端(FastAPI) + Nginx 同容器
#
# 构建方式（在仓库根目录）：
#   docker build -t ai-novel-generator:latest .
#
# 运行方式：见 README-DOCKER.md

# ---------- 阶段一：构建前端 ----------
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

# 先只复制依赖清单，利用层缓存
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# 前端改为相对路径调用后端，容器内由 Nginx 统一转发，避免硬编码 localhost:8200
RUN sed -i 's/process.env.NEXT_PUBLIC_API_BASE || "http:\/\/localhost:8200"/process.env.NEXT_PUBLIC_API_BASE ?? ""/g' src/lib/api.ts

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 阶段二：运行时 ----------
FROM python:3.11-slim
WORKDIR /app

# Nginx 做统一入口，Supervisor 管理三个进程（backend / frontend / nginx）
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx \
        supervisor \
        curl \
    && rm -rf /var/lib/apt/lists/*

# 复用 Node 运行时来跑 Next.js 生产服务器
COPY --from=node:20-slim /usr/local/ /usr/local/

# 后端依赖：去掉桌面版 PySide6（服务器镜像不需要 GUI 启动器）
COPY requirements.txt ./
RUN grep -v "PySide6" requirements.txt > requirements-docker.txt \
    && pip install --no-cache-dir -r requirements-docker.txt \
    && rm requirements-docker.txt

COPY backend/ ./backend/
COPY main.py ./

COPY --from=frontend-builder /app/frontend ./frontend

# 部署配置
COPY deploy/nginx.conf /etc/nginx/sites-available/default
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 用户数据目录（配置、小说、封面、导出等全部持久化在这里）
RUN mkdir -p /app/user_data
VOLUME /app/user_data

# 3300 为唯一对外端口（工作台与 API 同源）
EXPOSE 3300

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3300/api/startup || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
