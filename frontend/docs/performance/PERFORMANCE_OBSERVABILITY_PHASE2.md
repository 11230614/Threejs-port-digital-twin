# 性能观测第二轮：逐帧诊断与负载复现

日期：2026-10-28。此轮只增强可选观测和采样脚本；没有引入 Worker/IndexedDB，也未更改正式默认渲染质量和业务执行顺序。

## 计时边界

`requestAnimationFrame` 回调接收的浏览器时间戳之差记为 `rafIntervalMs`，它覆盖帧间等待、浏览器排程和上一回调执行时间，不等于当前回调 CPU 时间。`callbackCpuMs` 从进入当前 RAF 回调开始，到正常 render、afterRender 和诊断写入结束为止。`updateMs` 从进入 `FrameObserver.update()` 到 `beforeRender()` 完成，包含帧监听器、ECS/业务/空间任务与其调度开销。独立系统任务时间由 `FrameObserver` 原有包裹回调的 `performance.now()` 测量，只计实际被 interval 调度执行的一次调用，不补齐未执行帧。`renderSubmitMs` 是同步 `EffectComposer.render()` 调用耗时，包含其 RenderPass、Bloom 与 OutputPass 的 JS/WebGL 提交路径；不能拆分各 pass，也不是 GPU 完成时间。

现有 `PerformanceSystem` 从 beginFrame 到 afterRender 计 `frameMs`；update 为 begin 到 beforeRender，render 为 beforeRender 到 afterRender。每约一秒将窗口内逐帧 frameMs 排序，以 nearest-rank `ceil(.95*n)-1` 得到窗口 P95，然后清空窗口。其 FPS 是窗口帧数/墙钟秒数。以上历史 P95 是窗口内帧时间分布，但旧采样只保留每秒快照，因此后处理得到的是“窗口 P95 的分布”，不能复原整个运行的逐帧 P95。Clock 的 `deltaTime` 会裁剪到 100ms，不能作为 RAF 原始间隔。

逐帧新样本保存在 12,000 容量的 TypedArray 环形缓冲区，字段单位均为 ms（Draw Calls、Triangles 为 renderer.info 本帧累计整数）：RAF interval、回调 CPU、业务 update、同步 composer 提交、Draw Calls、Triangles。P50 使用偶数样本中位数平均，P95/P99 使用 nearest-rank，max 为最大观察值，count 是该窗口实际存入的帧数。逐帧不做排序、不打印日志。系统耗时按 `system.<FrameObserver task name>` 分立环形采样；路由导出 preprocessing/search/total 操作时间。环形缓冲区满后覆盖最旧值，汇总在显式读取时执行。

Long Task 使用 `PerformanceObserver` feature detect。支持时记录 startTime/duration，并在摘要读取时与任务结束后最近 RAF 样本关联；浏览器不支持时报告 `longTaskSupported:false`。50ms 以下任务仍然保留在各系统与帧样本中，但不属于标准 Long Task API 条目。

## 诊断开关与采样

默认关闭，正式渲染及调度顺序保持不变。开发页加 `?perfDiagnostics=1` 开启。浏览器控制台/Playwright 可读取：

```js
window.__PORT_PERF_DIAGNOSTICS__.summary()
window.__PORT_PERF_DIAGNOSTICS__.rawFrames()
window.__PORT_PERF_DIAGNOSTICS__.camera()
window.__PORT_PERF_DIAGNOSTICS__.clear()
```

脚本 `tests/performance/diagnostics-overhead.mjs` 使用 Edge、1365×768、DPR 1，交替三轮诊断 off/on；每组运行时 ready 后预热 10 秒并采样 60 秒，原始逐帧样本、秒快照、场景相机、WebSocket、页面错误写入独立 `tests/performance/results/diagnostics-overhead-<timestamp>/`。复现：`node tests/performance/diagnostics-overhead.mjs`。结果仍受 OrbitControls 用户输入影响；脚本记录相机起止状态，不会强行改变正式场景相机。若相机变化较大，只能解释为“页面运行观测”，不能作为严格同负载 A/B。

## 可重复负载矩阵

| 场景 | 执行方式 | 本轮可测性 |
|---|---|---|
| 空闲/正常场景 | 页面 ready，等待预热后采集；实际包含当前默认场景动画与后端推送 | 可自动测；相机需记录/锁定 |
| 多 AGV 同时运动 | 手动通过任务 UI 对多辆车创建并启动任务；记录任务创建时间和 active AGV 数，运行固定 60 秒 | 暂无脚本化任务输入，需手动；本轮未执行 |
| 路径规划 | 在页面任务面板创建同类型任务并启动；诊断开启时从 `operations.path.*` 读取单次计时 | 本轮未触发路径请求，故无样本 |
| 持续遥测 | 后端 `TELEMETRY_SIMULATOR=true`，固定 `TELEMETRY_INTERVAL_MS`，确认 `/api/telemetry/snapshot`、WebSocket `/ws/telemetry` 均有帧 | 后端可用；本次浏览器 WebSocket帧已收到。模拟器开关/频率须记录 backend 环境值 |
| 设备状态同步 | 保持同一设备数，观察 `system.entity-state-sync`（100ms scheduler task）和 Pinia 更新间接耗时 | 任务耗时可自动测；组件 render 本身未单独 instrument |
| 大量箱体/实体 | 默认约1320箱、5 AGV；增量压力需测试数据入口 | 当前正式数据可测，扩容未测 |
| 初始化/批量创建 | 初始化项 `init.model-preload` 与 `init.ground-create` 在诊断摘要保留；逐阶段实体建造尚未全部打点 | 上述两阶段可观测；容器/设备分批创建独立耗时尚未测 |

浏览器、DPR、canvas drawing buffer、WebGL 版本、运行时相机参数及前后差异在每轮 JSON 保存。诊断关闭时不会创建诊断对象、不计系统回调、不派逐帧事件；已有每30帧一次的 runtime-frame 开发探针仍存在于原实现中。

## 后端环境核验

测试时 `http://localhost:5173/`、`127.0.0.1:3003/api/health`、`/api/db/health` 均返回 200，PostgreSQL connected=true；`/api/devices` 返回5台AGV，`/api/telemetry/snapshot` 有5条当前快照。前端配置 `ws://127.0.0.1:3003/ws/telemetry`，浏览器通过 WebSocket 收到消息。后端 TelemetryService 的 simulator 根据 backend `.env` 中 `TELEMETRY_SIMULATOR` 创建；本轮未改 `.env`。结果脚本按 URL `/ws/telemetry` 过滤，不把 Vite HMR WebSocket 帧误算为遥测。

## 第二轮结果

运行数据目录见本报告链接的结果目录。A/B 的方向定义：off 为正式关闭诊断，on 为诊断开启；帧耗时变化率统一为 `(on-off)/off`，正数表示开诊断后耗时增加。必须结合每轮原始值、快照 FPS 和相机起止差异查看。当前每轮60秒诊断开销对照在浏览器脚本完成后填入，不把不同相机负载的差异强行解释为监控本身的精确因果效应。

既有粗基线仍保留于 `WORKER_INDEXEDDB_PERFORMANCE_AUDIT.md` 和 `results/live-baseline-2026-10-28T06-13-43.683Z/`：CPU update 中位约0.532ms、CPU composer/render提交约8.533ms；旧 window P95 三轮中位14.73ms并非跨运行逐帧 P95。新的逐帧样本方法不能回填成与旧统计同口径数值。

## 结论与未确认项

- MotionSystem 是否应维护实体紧凑集合：当前原实现每帧扫描全部实体，但须先用 `system.motion` 在 5 AGV/1320箱和受控更大实体场景测出分布；没有完成大规模压力前不应改结构。
- PathManager 路网 preprocessing/search：已增加可选单次计时，但未触发有效路线时没有测量证据；暂不迁 Worker。
- Web Worker：遥测量低且按资产合并；路径搜索与初始化数据是候选，但没有本轮高分位/负载证据。暂不引入。
- 渲染策略：renderer.info Draw Calls/Triangles 是实际提交计数；composer 同步时间仍是 CPU submit，不是 GPU 时间；不能从这些数据推断 GPU bottleneck。
- IndexedDB：仍无离线权威数据或持久缓存需求，前端资源已有 HTTP/AssetManager 缓存；不需要引入。
- 观测缺口：PerformanceObserver longtask 不能归因 50ms 以下任务；Vue 组件耗时、GLTF decode 子阶段、各 composer pass 独立计时、GPU 执行时间、持续受控任务与路径负载仍未拆分。

## 已完成的一组浏览器观测（不足以作为稳定 A/B）

结果目录：`tests/performance/results/diagnostics-overhead-2026-10-28T06-46-17.687Z/`。本轮脚本在首个 on 组结束后停止，所以只有一对。off 轮39个约1秒快照，on轮41个快照和3960个逐帧样本。Edge 156.0.4314.42，1365×768、DPR1、canvas819×460、WebGL2；on固定机位 position `[450,320,-80]`、lookAt `[0,8,-80]`，FOV55/aspect1.77734375/near1/far5000，机位起止相同。off轮没有保存相机状态，故不能证明两组机位等价。页面错误均为0，收到目标遥测WebSocket帧分别721、715。

| 指标 | off（单轮） | on（单轮） |
|---|---:|---:|
| FPS快照均值 | 65.61 | 65.89 |
| frame average快照均值 | 11.33ms | 11.12ms |
| 每秒窗口P95均值（不是运行级逐帧P95） | 19.05ms | 18.35ms |
| CPU update快照均值 | 1.172ms | 1.165ms |
| CPU composer同步提交均值 | 10.16ms | 9.95ms |
| Draw Calls均值 | 1555.8 | 1560.4 |
| Triangles均值 | 3,096,076 | 3,056,936 |
| on逐帧 RAF interval P50/P95/P99/max | 未采 | 13.30/26.70/27.00/53.40ms |
| on逐帧回调CPU P50/P95/P99/max | 未采 | 9.80/19.10/33.70/49.60ms |
| on逐帧 update P50/P95/P99/max | 未采 | 0.80/3.90/5.70/69.20ms¹ |
| on逐帧 composer提交 P50/P95/P99/max | 未采 | 11.90/16.30/33.20/1187.20ms¹ |

¹ max含异常峰值，应结合原始 JSON；未用来计算开销差异。off只有旧PerformanceSystem的一秒快照，无法计算成对逐帧变化率。均值接近但配对仅一次且off机位未记录，不能判定诊断代码开销。

诊断 on 的初始化样本：model preload 687ms、GroundSystem.create 211.2ms，各1次；preload混合I/O等待/解析，不是纯CPU耗时。`system.motion` 3960次，P50/P95/P99/max=0.6/1.4/2.5/20.1ms；`system.spatial-render` 600次=0/3.6/7.5/18.8ms；`system.labels` 1200次=0.5/1.1/1.7/2.8ms；`system.chunk-spatial` 600次=0.2/0.4/0.8/0.9ms；`system.entity-state-sync` 600次=0/0.1/0.2/1.6ms。仅代表当前5台AGV正式场景。PathManager无样本，因为没有发起路径规划。

Edge支持Long Task API；只观察到1个51ms Long Task。其结束后下一帧间隔53.4ms，后续callback/update/composer耗时9.7/1.1/8.6ms。单个事件不足以说明因果。低于50ms任务仍在帧和系统样本中。

没有基于该单轮计算诊断开销变化率。需使用当前脚本完成剩余两组交替轮次后再评价。`npm run type-check`、`npm run build`、新增诊断smoke test及 `tests/*.smoke.mjs` 全集通过。Build仅有bundle超过500kB告警。早期中断的 `diagnostics-overhead-*` 文件夹保留作废，不可合并。完整重跑命令：`node tests/performance/diagnostics-overhead.mjs`。
