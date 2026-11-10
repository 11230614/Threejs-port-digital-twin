# 港口数字孪生主线程性能审计与 Worker / IndexedDB 评估（第一阶段）

审计日期：2026-10-28。范围为现有代码审计、可运行的正常场景基线、Worker 候选评估与 IndexedDB 生命周期评估。**本阶段没有迁移业务计算，没有接入 Web Worker 或 IndexedDB**：现有证据不足以证明这两种技术会改善当前体验，接入只会增加生命周期、错误降级和一致性维护成本。

## 执行摘要

- 正常场景基线通过现有 Edge + Playwright 脚本实跑三轮，无页面错误。三轮每秒聚合快照数为 36、36、41；FPS 各轮均值为 66.26、66.97、58.90，中位轮次值 66.26。帧均值的三轮中位数为 9.09 ms；每秒快照所报告的窗口 P95 之三轮中位数为 14.73 ms，窗口最大值的三轮中位数为 47.10 ms。详见本文件后文及原始数据目录。
- 该基线不是固定相机、逐帧样本或正式硬件基准。相机/场景状态在采样期间改变，快照样本数也不足完整的 60 个一秒窗口。窗口 P95 不是逐帧 P95，不能用来定位具体长帧或推导优化收益。
- 采样显示 CPU 更新均值仅约 0.53 ms，CPU renderer/composer 提交均值约 8.53 ms（均为三轮统计中位）。它不是 GPU 执行耗时。该结果没有证据表明 PathManager 或 ECS 更新是当前主场景的首要瓶颈；渲染路径的 CPU 提交工作占帧内测量的大头，但 GPU/合成器/浏览器合成的真实分解仍未测。
- 最明确的代码级扩展风险是：MotionSystem 每帧重新从 EntityManager 全实体数组筛选 AGV 并创建中间数组；每 100 ms 的状态通知使 Pinia computed 有机会遍历设备实体；TaskPanel 每两秒轮询任务列表；路径路由在每次请求中重新组装/投影路网。但当前没有这些模块的独立耗时分位数或大规模负载数据，报告将它们标记为待测风险，不宣称已证实瓶颈。
- Worker 候选中，路由/几何预处理可作为以后测量的试点，但现有路网规模和任务触发频率未知，且路线创建会同步访问 Three.js Vector3 / RoadSystem 接口；应先将纯数据算法拆边界、计时与缓存，再决定 Worker。遥测消息目前很少且按 assetId 合并为最新值，不适合 Worker。
- IndexedDB 暂无高价值明确目标：业务任务和设备状态由后端 API/数据库负责；GLB 有浏览器 HTTP 缓存与 AssetManager 内存/in-flight 去重；箱体布局由配置生成，实时变换属于运行态。没有离线访问、跨刷新本地权威数据或客户端历史遥测的已证实需求。

## 运行架构与调用链

Vue 入口 `src/main.ts` 创建 Vue app 与 Pinia，挂载 `App.vue`。`App.vue` mounted 后创建 `PortRuntime` 并等待 `start()`。`PortRuntime.start()` 创建 MainScene、EntityManager、AssetManager、FrameObserver；并行预加载 GLB（`Promise.all(PORT_MODEL_ASSETS.map(preload))`），初始化地面/箱区与容器、设备、任务及空间优化，再启动 TelemetrySystem，最后启动 RenderSystem。它也触发容器纯数据快照向后端同步（异步请求不 await，但 DTO `flatMap/map` 的准备在主线程同步执行）。

渲染帧调用链：`RenderSystem.start()` 安排 `requestAnimationFrame` → `Clock.tick()` → `FrameObserver.update(dt, elapsed)` 按 priority/interval 运行系统 → `beforeRender()` → `EffectComposer.render()`（RenderPass/Bloom/OutputPass）→ `afterRender()`。CSS2D 标签 renderer 通过 FrameObserver render hook 执行。`PerformanceSystem` 是 frame listener，在 beginFrame reset `renderer.info`，渲染前后用 `performance.now()` 计 update 与同步 renderer/composer 调用耗时，并每约 1 秒发布汇总给 Pinia。

主线程帧任务及顺序（数字越小越早；任务按 priority 再按注册序排序）：

| 顺序/任务 | 频率 | 代码职责 |
|---|---|---|
| `motion`、`quay-crane` | 每帧 | AGV 路径推进及岸桥机械动作 |
| `camera` | 每帧 | OrbitControls / 巡航相机更新 |
| `ground-animation` | 每帧 | 水面/地面动画 |
| `highlight`、`labels` | 50 ms | 选中高亮与 CSS2D 标签 |
| `alarm-visual`、`telemetry` | 100 ms | 报警表现；将合并遥测应用到 ECS/Pinia |
| `entity-state-sync` | 100 ms | `EntityManager.notifyUpdated()` 增加设备与资产 Store 的版本号 |
| `overlay-ui` | 100 ms | DOM overlay 更新 |
| `alarm-scan` | 500 ms | 全资产告警规则扫描 |
| `model-asset-gc`、`performance-publish` | 1000 ms | 资产闲置资源回收与性能窗口发布 |
| `chunk-spatial`、`lod-policy`、`spatial-render`、`render-resource-gc`、`adaptive-quality` | 依实际注册间隔/帧调度 | Chunk 可见性、LOD、渲染适配器更新、资源池 sweep、画质策略 |

实际注册位置分布在 `src/app/PortRuntime.ts` 的 `_registerCoreSystems`、`_startTelemetry`、`_createSpatialOptimization`、`_createOverlayUI`；主循环在 `src/rendering/RenderSystem.ts`，统一调度与每任务累计/最近耗时在 `src/core/FrameObserver.ts`。

主线程运行 JavaScript/ECS、消息解析/状态更新、Three.js 场景遍历和 renderer 提交、DOM/CSS2D 更新。GLB 网络读取属于异步 I/O，GLTFLoader 解码/normalize 的 JS 部分仍占用主线程；GPU 执行、浏览器合成不等于 `renderer.render()`/`composer.render()` 返回耗时。项目使用 InstancedMesh、Chunk、LOD、资源共享池及 AssetManager cache/in-flight 合并，均已存在，不应以“增加 Worker”替代这些优化。

## 关键模块审计发现

| 模块 | 实际行为和证据 | 性能含义/状态 |
|---|---|---|
| `FrameObserver` | 每帧复制任务列表 `[...tasks]`；逐任务 `performance.now()` 计时；仅保留 calls/total/last，没有环形样本和 P50/P95。 | 任务平均值可读，但不能从现有 stats 直接得出系统逐次 P95。任务数量为十余个时复制成本未证明显著。 |
| `PerformanceSystem` | `frameMs` 是每帧 beginFrame 到 afterRender 的同步区间；`cpuMs.update` 是到 render 前的区间；`cpuMs.render` 是 composer.render 同步调用；窗口样本只在内部计算平均/P95/max，发布后清空。没有 RAF 间隔、逐帧 P50/P99、Long Task observer。 | 能建立粗基线和区分 CPU update/提交；不能量化呈现完成、GPU 时间或主线程任务归因。上报回调 `console.log` 每秒输出快照，在正式压测时本身可能产生少量干扰。 |
| `MotionSystem` | 每帧调用 `getEntitiesWith(TRANSFORM,MOTION,AGV)`；EntityManager 实现是 `getAll().filter(...)`；随后 telemetry/local command/free AGV 多次 filter/forEach。 | 按全部实体数量每帧线性扫描并分配多组数组，是最直接可复现的算法级增长风险；目前场景只有 5 台 AGV，主线程总 update 约 0.53 ms，不能说已造成卡顿。可先维护 AGV 紧凑集合/组件查询索引并对比，而无需 Worker。 |
| `PathManager` | `createYardRoute()` 每次请求复制 network nodes、segments，枚举 lanes/rows，采样道路并做二分求交，再投影起终点，后续在路网图上搜索；路网节点/边规模和该方法耗时未记录。自由 AGV 每帧只推进既有路线，不运行路径搜索。 | 任务开始/阶段变化触发的同步计算候选，频率远低于每帧运动。优先计时并缓存静态路网拓扑/预计算连接；只有高分位明显且可剥离纯数据输入时才试 Worker。 |
| 遥测 | WebSocket onmessage JSON.parse、按 sequence 丢弃旧值；TelemetrySystem 用 `Map<assetId,latest>` 合并消息，约 100 ms 应用，状态只保留最新值。 | 若消息量增长，主线程解析可测；目前已合并且没有批量流量证据。写 IndexedDB 逐条保存或 Worker 往返都可能增加成本。 |
| Pinia/UI | `EntityManager.notifyUpdated()` 每 100 ms 让 DeviceStore/AssetStore `frameVersion++`；DeviceStore computed 可构建全设备 ViewModel；TaskPanel 每两秒轮询最多 50 条后端任务。 | 频率与 O(N) 数据映射值得在设备数增长时观测；当前页面只有少量设备与面板，尚无 component render/HTTP payload timing 证据。 |
| 初始化/资源 | 6 个 GLB 并行 preload；AssetManager 使用缓存 Map 和 pending Promise 去重；AssetNormalizer 在加载完成后归一化/检查模型；GroundSystem 生成箱位与 1320 箱布局、container renderer 构建实例批次；生成容器 DTO 并同步 POST。 | 初始化任务可能产生主线程峰值，当前基线从 canvas ready 后预热，故不测初始化；资源已有 HTTP 缓存及内存缓存，不支持重复建设 IndexedDB 二进制缓存的结论。 |
| 场景优化 | Chunk/LOD/spatial adapters 实际运行；GPU 资源共享通过 RenderResourceSystem/GpuResourcePool；上一轮 Chunk bounds 已按真实成员 bounds 修复并做过单因素 A/B。 | 这是已有的计算/绘制减量技术。历史裁剪测试见 `CHUNK_BOUNDS_FIX_AND_AB_RESULTS.md`，不可与本轮基线合并求收益。 |

## 实测基线（2026-10-28）

执行命令：`node tests/performance/live-scene-baseline.mjs`。脚本复用已有 `@playwright/test` 的 Playwright Chromium API，并通过 `PW_CHROME_PATH`/脚本默认 Edge 路径启动 Microsoft Edge。每轮 canvas ready 后预热 10 秒、采集 60 秒；场景正式画质 High、adaptiveQuality=false、renderer pixelRatio=0.6、Bloom 默认开启、视口 1365×768、DPR 1、Canvas drawing buffer 819×460、WebGL 2。Edge 156.0.4314.42。设备为 Lenovo 10G4S09000，Intel Core i7-6700 @3.40GHz，16 GB RAM。Vite 6.4.3 开发服务；Telemetry WS 配置为 `ws://127.0.0.1:3003/ws/telemetry`。本轮另检查 `/api/health` 和 `/api/db/health`，均因 `127.0.0.1:3003` 连接拒绝不可用，WebSocket 在线状态/消息节奏未建立；故这不是持续遥测负载测试。

| 轮次 | 聚合窗口数 | FPS 均值 | 每帧平均值均值 ms | 窗口 P95 中位数 ms | 窗口 max 最大 ms | CPU update 均值 ms | CPU render/composer 提交均值 ms | Draw Calls 均值 | Triangles 均值 | JS 页面错误 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 36 | 66.26 | 8.74 | 12.20 | 47.10 | 0.532 | 8.207 | 1266.3 | 3,028,588 | 0 |
| 2 | 36 | 66.97 | 10.07 | 15.40 | 39.00 | 0.516 | 9.556 | 1582.0 | 3,069,050 | 0 |
| 3 | 41 | 58.90 | 9.09 | 11.90 | 62.60 | 0.561 | 8.533 | 1425.1 | 3,602,612 | 0 |
| 三轮统计值中位数 | — | **66.26** | **9.09** | **14.73**¹ | **47.10**² | **0.532** | **8.533** | **1425.1** | **3,069,050** | 0 |

¹ 各轮 `frameMs.p95` 窗口聚合值的平均再取三轮中位数；不是逐帧 P95。² 各轮最大窗口最大值的中位数。每轮原始快照有 `frameMs.average/p95/max`，但每秒快照不等于逐帧样本。原始样本窗口少于 60，表中帧分位数均有相应限制。`cpuMs.render` 是 CPU 同步提交耗时；GPU 执行时间未测。

三轮中可见 Chunk 中位位置分别约 8、21、11；容器可见实例中位状态分别为 576、1224、744，Draw Calls 与三角形因此也随镜头/状态变化。轮次间负载不等价，不能将差异解释为优化效果。中位快照状态：总容器 1320、5 AGV、24 active Chunk、1699 spatial handles；LOD 分布随镜头变化。**正式业务任务/多 AGV 压力、受控遥测高频、不同实体规模、大量实体冷启动没有可复现测试入口或受控输入，本轮未测；后端断连进一步限制了真实 HTTP/WS 业务回归。**

旧的 2026-10-26 基线（其时 Edge/页面与代码版本、测试运行时间不同）不能与本轮合并：其 pixelRatio=0.6、FPS 三轮中位约 65.64、snapshot FPS 中位约65.9；只可作为历史留档，不构成两版回归或优化比较。

## Worker 候选评估

| 候选 | 触发与规模 | 当前证据 | 结论 |
|---|---|---|---|
| 路径规划 / `PathManager.createYardRoute` | 用户建任务或任务阶段需要新路线；不是每帧。处理纯路网可转换成 nodes/edges/positions DTO，但现有路线算法读取 `RoadSystem` 并构造 `THREE.Vector3`，不能直接传运行对象。 | 代码中路网构建含采样、投影和 Dijkstra；没有 route duration、节点/边数、任务并发的统计。实际主场景 Motion update 低，未证明它耗时。 | **暂不迁移。**先加低频采样计时、统计路网规模和创建任务路线 P50/P95；减少重复 topology preprocessing / cache。同等输入超过帧预算且可分离纯 DTO 时再做 Worker A/B。 |
| 逐帧 Motion/ECS | 每帧；当前 5 台 AGV，全部实体数量未纳入基线指标。 | 代码路径每帧从全体实体构造数组、反复过滤。 | **先优化数据结构再测。**Worker 不适合频繁读写 Three.js/ECS Transform，序列化与延迟抵消收益。 |
| 遥测 JSON/批处理 | 当前按 100 ms 应用、每个资产只保留最新值。 | 没有消息吞吐/parse duration 计数；小型对象每条 structured clone 有成本。 | **不迁移。**只有持续高吞吐并测得 parse/aggregate 占帧预算时，再比较批量传输/Transferable 数据。 |
| 场景初始化预处理 | 启动期；生成 1320 容器与路网，GLB decode/normalization。 | 初始化不在上述测量窗口，耗时与任务拆分未采集。Three.js Object3D 与 ECS 构建仍必须在主线程。 | 先分阶段打点；Worker 仅可承担与 DOM/Three 无关的纯布局/路网数据计算。 |

## IndexedDB 数据生命周期评估

| 数据 | 权威来源/恢复方式 | IndexedDB 价值判断 |
|---|---|---|
| 设备、任务、容器业务状态 | 后端 API/数据库；页面刷新重新请求/场景同步 | 后端是权威来源。若短暂离线需要展示，可考虑带 TTL 的只读 HTTP 快照缓存，但要实测启动请求与失败回退；当前未见页面离线验收需求。 |
| 实时遥测与 Transform | WebSocket 最新值与当前 ECS/Pinia 运行态 | 高频变化、刷新后可重新接收；不逐条持久化、不保存每帧 Transform。 |
| GLB/纹理 | Vite 静态文件、浏览器 HTTP cache；AssetManager 内存 cache 与 pending 合并 | 先核实生产 Cache-Control 与重复下载证据。当前 AssetManager 内存去重已存在；IndexedDB 二进制缓存会重复浏览器 HTTP cache 能力并带来淘汰/版本一致性成本。 |
| 生成箱位、空间索引、道路 | PortSpatialConfig 与 GroundSystem 可再生成 | 持久化整场景会增加 schema 迁移与失效问题；应保存版本化生成配置而非 Object3D/完整 ECS，但现在没有生成耗时数据支持缓存。 |
| 客户端设置 | 未发现 localStorage/sessionStorage/IndexedDB 使用；项目质量主要为运行态配置 | 当前没有明确需跨刷新保留的数据。若用户偏好需求出现，少量设置优先 localStorage；不需要 IndexedDB。 |

**结论：第一阶段不创建 IndexedDB 模块。**后端写入和缓存故障必须与业务权威操作区分；未来若做只读离线快照，应具 TTL、schemaVersion、更新时间/ETag 校验、HTTP 回退、缓存失败不阻断业务的 repository，并避免旧快照覆盖新 API 数据。未证实需求前不落地。

## 监控缺口与后续建议

1. 当前 `PerformanceSystem` 已测 update/render/frame 的窗口均值、P95、max 和 `renderer.info` 计数；下一步应增加可关闭 fixed-capacity per-frame ring buffer、RAF 相邻时间差、真正逐帧 P50/P95/P99，并对诊断导出低频执行。明确区分 RAF 间隔、JS 回调时间、CPU renderer 提交和 GPU timer query（若设备支持）。
2. 可选 `PerformanceObserver({entryTypes:['longtask']})` 诊断观察器：feature detect、不支持即跳过，记录 duration/startTime，并在长任务附近关联当时场景计数；当前未实现，因此长任务数与时刻为未测。
3. 为任务路由创建、场景生成/箱体 DTO、GLB normalize、MotionSystem、Telemetry parse/apply、Pinia UI 映射分别采集固定容量耗时样本。不要每帧 `console.log`；当前 App 每秒输出 snapshot 应能在正式计时时关闭。
4. 构造并固定可复现的场景负载：相机位姿、画质、pixelRatio、容器/实体数、AGV 与运行任务数、遥测频率/消息数、后端健康和页面可见性；空闲、正常、AGV 压力、规模压力、遥测压力、初始化分别跑至少三轮并交替顺序。
5. Worker 决策门槛：候选计算单次高分位接近/超过 16.67 ms 或稳定占有明显帧预算，触发频率/数据规模足够，纯 DTO 可隔离；A/B 同时证明端到端与主线程响应改善，且通信开销可接受。
6. IndexedDB 决策门槛：明确离线/启动延迟/重复网络读取产品需求，量测可缓存数据大小、更新率、TTL 与服务端一致性；若仅缓存普通 HTTP GET，先评估 Cache-Control/Service Worker，再决定是否需要 structured object repository。

## 工程运行与测试

- 成功运行 `npm run dev -- --host 127.0.0.1`，本机服务 `http://127.0.0.1:5173/` 返回 HTTP 200。
- 执行现有基线脚本 `node tests/performance/live-scene-baseline.mjs`：三轮完成，36/36/41 个聚合快照，页面错误均 0。该脚本输出原始 JSON；本阶段根据原始快照另生成 environment 和 summary，不覆盖历史结果。
- 代码库 `package.json` 只有 dev/build/preview/type-check 脚本，没有 ESLint、Vitest/Jest 或统一 smoke 脚本。此次没有改业务代码，因此没有重复运行构建及 35 项 smoke；上一轮 Chunk 修复报告记录当时 type-check/build/smoke 通过，不代表本次新版本全量回归。
- 当前目录还有既存的大量迁移/staged/untracked 工作，审计没有清理或回滚它们。

## 关键检查文件

`src/main.ts`、`src/App.vue`、`src/app/PortRuntime.ts`、`src/rendering/RenderSystem.ts`、`src/core/FrameObserver.ts`、`src/rendering/PerformanceSystem.ts`、`src/ecs/EntityManager.ts`、`src/ecs/systems/MotionSystem.ts`、`src/ecs/systems/TaskSystem.ts`、`src/ecs/systems/TelemetrySystem.ts`、`src/world/PathManager.ts`、`src/telemetry/TelemetryGateway.ts`、`src/telemetry/TelemetryRouteAdapter.ts`、`src/assets/AssetManager.ts`、`src/assets/AssetLoader.ts`、`src/builders/PortEquipmentBuilder.ts`、`src/builders/PortSceneBuilder.ts`、`src/stores/DeviceStore.ts`、`src/stores/AssetStore.ts`、`src/stores/TaskStore.ts`、`src/components/TaskPanel.vue`、`src/components/PerformanceDebugPanel.vue`、`src/config/PortSpatialConfig.ts`、`tests/performance/live-scene-baseline.mjs`、`package.json`。

## 结果文件

- 实测环境、逐轮派生统计、环境限制：`tests/performance/results/live-baseline-2026-10-28T06-13-43.683Z/environment.json`
- 每轮一秒快照原始 JSON：同目录 `run-1.json`、`run-2.json`、`run-3.json`、`all-runs.json`
- 汇总 CSV：同目录 `summary.csv`
- 派生完整统计：同目录 `frame-derived-summary.json`
- 复现命令：`node tests/performance/live-scene-baseline.mjs`（确保 Edge 路径可用；也可设置 `PW_CHROME_PATH`）

第一阶段结论：当前证据支持**先补齐逐帧/系统级观测并建立固定负载**，再决定 Worker 试点；当前没有 IndexedDB 的充分落地理由。没有新增性能技术，也没有把代码级增长风险写成已测瓶颈。

## 第二轮补充：逐帧观测与后端恢复（2026-10-28）

第二轮新增了默认关闭的 DEV 诊断采集与测试复现脚本，详见 [第二轮观测报告](PERFORMANCE_OBSERVABILITY_PHASE2.md)。本轮再次核实前后端已运行：前端页面、后端 health、数据库 health 均返回成功，PostgreSQL `connected=true`；设备和遥测快照各包含 5 台 AGV，浏览器也实际收到 `/ws/telemetry` 消息。第一轮后端断连属于当时测试环境状态，不代表当前持续遥测负载已充分覆盖。

第二轮获得一组诊断关闭/开启的 60 秒样本，但只完成一对；开启组有 3960 个逐帧样本，关闭组仅有每秒 PerformanceSystem 快照且未保存相机状态。因此数据可用于确认指标链路和测试环境可工作，不能用于稳定诊断开销百分比或严格配对帧时间结论。开启组观测到 1 个 51 ms Long Task，结束后的 RAF 间隔为 53.4 ms；单次关联不能证明因果。MotionSystem 当前 5 台 AGV场景的 P95 为 1.4 ms；路径规划没有触发，因此仍无 PathManager 性能样本。

本轮没有引入 Web Worker 或 IndexedDB，也没有据此改变业务架构。历史正式场景基线和第一轮后端断连记录保持原样，不与第二轮逐帧数据混算。第二轮原始数据位于 `tests/performance/results/diagnostics-overhead-2026-10-28T06-46-17.687Z/`；该目录 `summary.csv` 的 off/on FPS、render 等值来自每秒快照，on 组逐帧 P50/P95/P99/max 另见运行 JSON及第二轮报告。
