# 港口数字孪生后端

Node.js + TypeScript API 服务。源码、Prisma schema 和 SQL 均位于此目录。

## 环境与命令

在 `backend/` 目录安装依赖并运行：

```bash
npm install
npm run dev
npm run type-check
```

服务监听端口和数据库连接由本地 `.env` 配置；请参考 `.env.example`。前端 Vite 开发代理默认目标为 `http://127.0.0.1:3002`。

## 目录

- `src/`：Express API、repositories、数据库和遥测服务。
- `prisma/`、`sql/`：数据模型及数据库脚本。
