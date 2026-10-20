# 港口数字孪生前端

Vue 3 + TypeScript + Three.js 港口数字孪生前端应用。

## 环境与命令

在 `frontend/` 目录安装依赖并运行：

```bash
npm install
npm run dev
npm run type-check
npm run build
```

Vite 默认端口为 `5173`，`/api` 请求代理至 `http://127.0.0.1:3002`。

## 目录

- `src/`：Vue 应用、TypeScript 运行时、ECS、渲染与场景代码。
- `model/`：GLB 模型资源。
后端项目独立位于仓库根目录的 `backend/`。
