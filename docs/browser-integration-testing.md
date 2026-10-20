# 浏览器集成测试说明

## 服务启动

后端目录为 `server/`，实际开发命令来自 `server/package.json`：

```powershell
cd F:\desktop\threejs完整版\码头升级\vue+three\server
npm run dev
```

当前后端入口默认监听 `127.0.0.1:3002`。数据库连接使用 `DATABASE_URL`；不要把密码或其他敏感值写入日志。后端即使 PostgreSQL 未连接，也可能保留内存 API，数据库健康状态需通过 `/api/db/health` 单独判断。

前端启动：

```powershell
cd F:\desktop\threejs完整版\码头升级\vue+three
npm run dev -- --host 127.0.0.1
```

Vite 默认监听 `127.0.0.1:5173`，`/api` 代理到 `http://127.0.0.1:3002`。

## 预检与浏览器 Smoke Test

```powershell
npm run test:browser:preflight
npm run test:browser:smoke
```

预检分别检查前端入口、后端 `/api/health`、Vite 代理、`/api/devices` 和分页任务接口。Smoke Test 使用开发依赖 `@playwright/test`，通过 `playwright.config.ts` 复用系统 Chrome（默认路径可由 `PW_CHROME_PATH` 覆盖），真实访问 Vite 页面，收集控制台错误、未捕获异常和 API 请求失败，并断言 Canvas 与 WebGL context 已创建。

## 验证边界

本流程已验证浏览器自动化、页面模块加载、API/代理连通性和 WebGL context 创建。第二十七批增加 `test:browser:runtime`，通过开发环境诊断事件验证真实 `App.vue → PortRuntime.start()` 的初始化开始、manifest 资产 preload 完成、初始实体创建、系统装配、runtime-ready 以及实际帧循环事件顺序。诊断事件仅在 `import.meta.env.DEV` 且浏览器环境存在时派发，不暴露 Runtime 或场景对象。

它仍不自动证明道路 LOD 已由真实相机触发、容器 InstancedMesh 已完成完整场景绘制，或 GPU 驱动层显存已回收。
第二十九批新增 `test:browser:disposal`。测试通过真实 Vue/PortRuntime 入口等待初始化和 RAF，然后发出仅开发环境启用的 `runtime-test-dispose`，观察真实 `PortRuntime.destroy()` 完成事件，确认 Canvas 和 FrameObserver 任务清理、销毁后帧计数停止以及重复 destroy 幂等。该测试验证 JavaScript/Three.js 清理调用链，不证明 GPU 驱动最终显存回收。
第三十一批将 `RenderResourceSystem` 的唯一业务实现迁入 TypeScript，保留 JS 兼容入口。该模块只驱动 GpuResourcePool，不改变 Runtime 的初始化、空间渲染或销毁顺序；因此重新执行了 preflight、smoke、runtime、spatial 和 disposal 浏览器测试，均通过。浏览器测试仍不能证明 GPU 驱动最终显存回收。
第三十三批新增 `test:browser:materials`，真实导入 `CraneHarbourMaterials.js`，使用 CanvasTexture 和 WebGLRenderer 验证材质进入一次实际渲染路径。测试只释放自己创建的测试资源；由于生产模块的共享纹理缓存没有清理入口，该测试不宣称应用级共享纹理或 GPU 驱动显存已回收。

第三十九批新增 `test:browser:alarm`，通过真实应用启动和 PortRuntime 装配，在开发模式测试接缝向现有 TelemetrySystem 缓冲提交受控 AGV 遥测；告警扫描与视觉更新仍由现有 FrameObserver 周期调度。测试验证低电量告警建立、关联实体视觉响应、输入恢复后的 CLOSED 历史与视觉恢复。它不直接调用告警系统更新，不验证随机生产遥测或后端数据库，也不代表所有告警规则的浏览器集成覆盖。测试接缝/只读摘要仅在 Vite DEV 模式开放。
