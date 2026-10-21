![港口数字孪生项目效果](images/port-digital-twin.png)

# 港口数字孪生可视化平台

港口数字孪生可视化平台是一个面向港口作业场景的 Web 3D 演示系统。前端使用 Vue 3、TypeScript 和 Three.js 构建港区场景，将岸桥、AGV、集装箱、堆场、道路和船舶等对象组织为可交互的数字场景；后端提供设备、任务、集装箱和健康检查等 API，并可连接 PostgreSQL 保存业务记录。

项目支持本地模拟遥测，用于驱动演示场景中的设备状态和运动。模拟数据不代表真实设备接入；真实 WebSocket/MQTT 设备数据接入仍需单独配置和验证。

## 功能特性

### 🌐 港口三维场景

- 使用 Three.js 展示港区、码头、堆场、道路、船舶、岸桥、AGV 与集装箱模型
- 基于 GLB 模型资源构建场景，并通过统一的资产加载与管理流程复用模型
- 支持设备和资产选择、详情查看、标签显示及告警视觉反馈
- 通过道路、堆场路径和设备运动逻辑呈现港区作业活动

### 🚚 港口设备与作业对象

- 管理 AGV、岸桥、集装箱及静态港区资产
- 使用 ECS（实体-组件-系统）组织设备状态、运动、任务和渲染行为
- 支持集装箱堆场布局、空间分块、LOD（细节层级）和实例化渲染
- 通过任务系统演示集装箱运输及岸桥、AGV 等设备之间的作业协同

### 📊 业务面板与状态展示

- 展示设备、资产、任务、告警和运行性能信息
- 提供设备及资产列表、详情面板和告警列表
- 支持任务进度与执行状态展示
- 使用 Pinia 管理前端业务状态，并通过 API 获取后端业务数据

### 📡 模拟遥测

- 提供前端随机模拟数据源，可选用于设备状态、速度、电量、位置、任务进度和告警演示
- 遥测消息先进入缓冲，再由统一帧更新逻辑应用到场景与状态 Store
- 当前 Runtime 默认选择 WebSocket 遥测模式；后端提供对应的 AGV 轨迹模拟器，但默认关闭，需通过环境变量显式启用
- 前后端模拟遥测是演示能力，不应被视为生产设备数据或真实工业协议接入

### 🧱 资源与渲染管理

- 通过 AssetManager 管理模型加载、缓存、克隆及引用释放
- 通过容器渲染管理器和 InstanceBatch 支持大量集装箱实例
- 使用 ChunkSystem、LODSystem 和视锥相关策略控制空间对象渲染
- 提供渲染资源池、画质控制与性能采样等辅助机制

## 技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 前端框架 | Vue 3、TypeScript | 页面、交互和类型约束 |
| 构建工具 | Vite | 前端开发服务器与生产构建 |
| 3D 图形 | Three.js | 港口场景、模型、相机和渲染 |
| 状态管理 | Pinia | 设备、资产、任务、告警和性能状态 |
| 后端框架 | Node.js、Express、TypeScript | HTTP API 与服务端逻辑 |
| 数据访问 | Prisma、PostgreSQL | 关系数据模型和持久化访问 |
| 实时传输边界 | ws | 可选的后端 AGV 遥测模拟 WebSocket |

## 项目结构

仓库按前后端应用边界组织，两个项目分别维护自己的依赖和 lockfile。

```text
vue+three/
├── frontend/
│   ├── src/
│   │   ├── api/              # 后端 HTTP API 客户端与 DTO
│   │   ├── app/              # PortRuntime 与应用装配
│   │   ├── assets/           # 模型加载和资源管理
│   │   ├── components/       # Vue 业务面板
│   │   ├── ecs/              # Entity、Component 与业务 System
│   │   ├── rendering/        # 渲染、容器实例、LOD 和资源管理
│   │   ├── stores/           # Pinia 状态
│   │   ├── telemetry/        # 模拟遥测数据源与消息边界
│   │   └── world/            # 道路、堆场、地面和路径
│   ├── model/                # GLB 模型资源
│   ├── package.json
│   └── vite.config.js
│
└── backend/
    ├── prisma/               # Prisma 数据模型
    ├── sql/                  # PostgreSQL 初始化与增量脚本
    ├── src/
    │   ├── routes/           # 健康、设备、任务、容器和数据库路由
    │   ├── repositories/     # 数据访问与内存回退
    │   └── telemetry/        # 可选 AGV WebSocket 模拟服务
    ├── .env.example
    └── package.json
```

## 数据库设计

后端 Prisma schema 描述设备、遥测快照、任务、任务执行事件、集装箱和告警等数据结构。数据库脚本位于 `backend/sql/`。

| 数据模型 | 用途 |
| --- | --- |
| `devices` | 港口设备档案，当前演示清单包含 AGV-01 至 AGV-05 |
| `device_telemetry` | 设备最新遥测快照的数据结构；当前模拟流不会自动写入此表 |
| `tasks` | 任务请求、任务类型、执行状态及关联设备/集装箱 |
| `task_execution_events` | 任务执行事件和幂等序号 |
| `containers` | 集装箱业务编号、场景实体、堆场位置和状态 |
| `alarms` | 告警持久化的数据结构；初始化脚本不会生成模拟告警 |

项目提供 PostgreSQL 初始化脚本 `backend/sql/port_twin_init.sql`，以及用于已有数据库补充集装箱表结构的增量脚本 `backend/sql/migrations/002_containers.sql`。脚本应由开发者按目标数据库状态选择执行；不要对已有重要数据库直接重复初始化或迁移。

如果没有配置有效的 `DATABASE_URL`，部分设备和任务 API 会使用进程内存回退，容器数据则无法持久化。内存回退数据会在后端进程重启后丢失。

## 快速开始

### 环境要求

- Node.js（建议使用当前受支持的 LTS 版本）
- npm
- 可选：PostgreSQL（需要持久化时）

### 1. 安装前端依赖

在仓库根目录打开终端：

```bash
cd frontend
npm install
```

### 2. 配置并启动后端

新建一个终端，在仓库根目录执行：

```bash
cd backend
```

复制环境变量模板为本地配置：

```bash
# Windows PowerShell
Copy-Item .env.example .env
```

编辑 `backend/.env`，至少确认监听地址和端口；如需数据库持久化，填写可用的 PostgreSQL 连接串：

```env
HOST=127.0.0.1
PORT=3002
DATABASE_URL=postgresql://postgres:your_password@127.0.0.1:5432/port_twin
DB_POOL_MAX=10
DB_CONNECTION_TIMEOUT_MS=5000
```

安装依赖并启动：

```bash
npm install
npm run dev
```

后端默认监听 `http://127.0.0.1:3002`。如果不需要数据库，可以保持 `DATABASE_URL` 未配置；API 会按各自实现使用内存回退或返回数据库未连接状态。需要持久化时，请先创建 PostgreSQL 数据库并按实际状态执行 `backend/sql/port_twin_init.sql`；升级已有数据库时先检查并按需执行对应 migration。

### 3. 启动前端

再新建一个终端，在仓库根目录执行：

```bash
cd frontend
npm run dev
```

Vite 默认运行在 `http://127.0.0.1:5173`，前端 `/api` 请求会代理到 `http://127.0.0.1:3002`。浏览器访问：

```text
http://127.0.0.1:5173
```

### 4. 启用模拟遥测

当前前端 Runtime 默认使用 `websocket` 模式，连接 `/ws/telemetry`。仓库内置后端 AGV 轨迹模拟器与该消息路径对应，但默认关闭。要运行此模拟流，在 `backend/.env` 增加：

```env
TELEMETRY_SIMULATOR=true
TELEMETRY_INTERVAL_MS=500
```

重启后端后，模拟器会在 `ws://127.0.0.1:3002/ws/telemetry` 推送 AGV 轨迹，前端默认 WebSocket 路径与之匹配。模拟器从设备列表生成闭合路线上的位置和速度，不会从真实设备采集数据；未配置 PostgreSQL 时，设备列表可使用后端内存中的 AGV 演示清单。

前端还包含随机模拟数据源（`mock-websocket` / `mock-mqtt`），但当前 Runtime 默认未选择它。若想单独使用前端随机状态模拟，可在 `frontend/src/app/PortRuntime.ts` 中 `_startTelemetry()` 的 `mode` 配置为 `mock-websocket`，再重启前端；此模式不需要后端 WebSocket，也不需要 MQTT Broker。两类模拟源用途不同，不会自动互相切换。

### 5. 类型检查与生产构建

在 `frontend/` 目录执行：

```bash
npm run type-check
npm run build
```

在 `backend/` 目录执行：

```bash
npm run type-check
```

涉及数据库的运行路径需要本地 PostgreSQL。类型检查和生产构建不等同于完整浏览器、GPU 或真实设备集成验证。

## API 概览

后端默认前缀为 `/api`，开发时可经 Vite 代理访问。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 后端健康检查 |
| GET | `/api/db/health` | PostgreSQL 连接状态 |
| GET | `/api/devices` | 查询设备列表，可按类型筛选 |
| GET | `/api/devices/:id` | 查询单台设备 |
| GET | `/api/tasks` | 分页查询任务，可按状态筛选 |
| POST | `/api/tasks` | 创建任务请求 |
| GET | `/api/tasks/:id` | 查询任务详情 |
| POST | `/api/tasks/:id/execution-events` | 上报任务执行事件 |
| GET | `/api/containers` | 分页查询集装箱 |
| POST | `/api/containers/sync` | 同步场景集装箱快照 |
| GET | `/api/telemetry/snapshot` | 查询后端模拟遥测快照（需服务已生成数据） |

遥测 WebSocket（可选模拟器）：

```text
ws://127.0.0.1:3002/ws/telemetry
```

## 核心运行流程

### 前端场景与帧更新

```text
Vue 页面创建 PortRuntime
  → 加载场景、模型资产和港口空间
  → 装配 Entity、Component、业务 System 与渲染适配器
  → FrameObserver 按优先级和频率执行更新任务
  → Three.js 渲染场景并更新 Vue/Pinia 面板状态
  → Runtime 销毁时停止帧循环并释放其拥有的资源
```

### 模拟遥测数据流

```text
前端随机源（需显式选 mock 模式）或后端 WebSocket 模拟器（Runtime 当前默认模式）产生遥测
  → TelemetrySystem 接收并按 assetId 缓冲最新消息
  → FrameObserver 调用 TelemetrySystem.update()
  → 更新设备 Store、运动目标与告警相关状态
```

上述流程是本地模拟数据，不代表真实设备、MQTT 或 WebSocket 接入。后端 WebSocket 模拟器是单独的可选演示服务。

### 任务执行与后端记录

```text
前端提交任务请求（clientRequestId 用于幂等）
  → 后端校验并创建任务记录
  → 前端业务执行器按事件顺序上报执行状态
  → 后端校验事件序号和状态转换
  → 配置 PostgreSQL 时持久化；未配置时按 API 能力使用内存回退
```

## 开发与验证说明

- 前后端分别在 `frontend/`、`backend/` 安装依赖和运行命令。
- Vite 开发代理目标为 `http://127.0.0.1:3002`；如修改后端端口，也需同步调整 `frontend/vite.config.js`。
- `frontend/dist/` 是生产构建输出，运行 `npm run build` 可重新生成。
- 本发布快照不包含测试目录；性能、真实 GPU 压力、跨浏览器视觉一致性及真实港口设备接入不属于本 README 所声明的已验证范围。

## 许可证

本项目用于港口数字孪生场景的学习、开发演示与技术实践。若计划公开分发或商业使用，请由项目维护者补充并确认适用的许可证及模型资源授权信息。
