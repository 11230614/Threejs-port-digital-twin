# 港口数字孪生性能优化 A/B 实测结果

测试日期：2026-10-26。项目地址：`http://localhost:5173/`。本报告包含当前正式场景运行基线、独立 InstancedMesh 对照及 AssetManager/GPU 资源池机制实验。除明确列出的有效对照外，均不计算优化收益；正式场景基线本身不是“未优化”组。

## 环境与方法

使用 Microsoft Edge 156.0.4314.42 和 Playwright 独立浏览器进程访问本地 Vite 服务。正式场景基线视口 1365×768，画布 819×460，renderer pixelRatio 0.6，HIGH 画质，自适应画质关闭，Bloom 开启、阴影沿用项目默认值。场景每轮等待 10 秒后采样 60 秒，共三轮。项目 PerformanceSystem 提供约每秒一个聚合快照，而非逐帧原始计时；三轮实际获得 36、42、42 个快照，帧级 P95/最大值是这些窗口统计值的再汇总。CPU render 是 CPU 侧 JS 渲染提交路径耗时，不是 GPU 执行耗时。

InstancedMesh 测试使用独立 WebGL harness，视口及画布相同，使用项目 `jzx1.glb` 主网格、1,320 个相同变换、固定相机/灯光，A/B 均关闭对象视锥剔除，A-B 顺序交替。每次 10 秒预热、60 秒采样，三次重复。为隔离 draw submission，harness 没有正式场景的阴影及后处理；其 renderer pixelRatio 为 1，故该实验帧耗时不可与正式场景基线直接比较。两组几何、材质、实例位置、数量及三角形完全一致。

资源实验在同一页面上下文里，用项目 AssetManager 加载 109,584-byte GLB；浏览器 HTTP cache 禁用，冷请求增加唯一 query，热请求对同一 AssetManager 实例重复调用。GPU 资源池 A/B 是独立 JS CPU 微基准，每组每轮 1,000 次 BoxGeometry/材质创建释放或 acquire/release 操作，不调用 WebGLRenderer 上传资源，不代表 GPU 执行或显存测量。

## 当前正式场景基线

轮次值来自 60 秒内的 PerformanceSystem 窗口快照；三轮汇总为轮次中位数。

| 轮次 | 快照数 | FPS 均值 / 中位数 | 平均帧耗时 ms | 窗口 P95 均值 ms | 最大帧耗时 ms | CPU update ms | CPU render ms | Draw Calls | Triangles |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 36 | 65.37 / 65.4 | 11.320 | 13.994 | 20.3 | 0.982 | 10.338 | 1,592.14 | 3,173,836 |
| 2 | 42 | 65.93 / 65.9 | 11.290 | 14.055 | 24.3 | 0.966 | 10.324 | 1,592.45 | 3,172,482 |
| 3 | 42 | 65.64 / 65.9 | 11.303 | 13.748 | 42.0 | 0.957 | 10.346 | 1,592.12 | 3,179,823 |
| 三轮中位数 | — | **65.64 / 65.9** | **11.303** | **13.994** | **24.3** | **0.966** | **10.338** | **1,592.14** | **3,173,836** |

正式场景容器 1,320 个、设备/资源统计采用基线快照：geometries 679、textures 30；容器实例 1,320、容器批次 32。活动/可见 Chunk 为 24/24，LOD trackedChunks 为 24，Chunk LOD 0/1 为 13/11；容器 LOD counts 为 0:660、1:660、2:0。存在 42ms 窗口最大帧耗时峰值；该短时峰值不代表持续恶化。采样未冻结后端遥测节奏或机器其他负载，也未记录逐帧样本，因此基线适合作为本机此配置的观测值，不是跨机器基准。

## InstancedMesh A/B

| 组别/轮次 | FPS 均值 | 平均帧耗时 ms | P95 ms | 最大帧耗时 ms | CPU render 均值 ms | Draw Calls | Triangles |
|---|---:|---:|---:|---:|---:|---:|---:|
| 普通 Mesh A / 1 | 58.641 | 17.053 | 26.8 | 40.1 | 2.336 | 1,320 | 997,920 |
| 普通 Mesh A / 2 | 57.907 | 17.269 | 26.8 | 306.9 | 2.219 | 1,320 | 997,920 |
| 普通 Mesh A / 3 | 58.871 | 16.986 | 26.8 | 53.3 | 2.186 | 1,320 | 997,920 |
| A 三轮中位数 | **58.641** | **17.053** | **26.8** | **53.3** | **2.219** | **1,320** | **997,920** |
| InstancedMesh B / 1 | 58.894 | 16.980 | 26.8 | 40.0 | 0.0441 | 1 | 997,920 |
| InstancedMesh B / 2 | 58.769 | 17.016 | 26.8 | 40.2 | 0.0446 | 1 | 997,920 |
| InstancedMesh B / 3 | 58.735 | 17.026 | 26.8 | 40.2 | 0.0453 | 1 | 997,920 |
| B 三轮中位数 | **58.769** | **17.016** | **26.8** | **40.2** | **0.0446** | **1** | **997,920** |

以轮次中位数计算：Draw Calls 降低 **99.924%**；平均帧耗时降低 **0.218%**；P95 降低 **0%**；FPS 提升 **0.219%**。CPU render 提交时间中位数约从 2.219ms 降至 0.0446ms（约降低 97.99%），但这只是 harness 中 CPU JS 提交耗时。最稳妥的结论是相同重复网格工作量下调用数显著减少；此实验未显示总体帧耗时/P95 有明显改善，且不代表生产混合场景整体收益。

## LOD 与 Chunk 视锥裁剪

LOD 在正式场景中确实运行：trackedChunks=24，levels 0/1 为 13/11，容器 LOD counts 为 660/660/0，运行时切换计数和 `spatialRender.appliedTransitions` 有记录。近/中/远相机三组及正常 LOD/固定高细节 A/B **未测**：没有安全、经验证的高细节固定开关以及工作量等价的相机脚本，故不报告 LOD 帧时收益。

Chunk 统计显示活动/可见 Chunk 为 24/24，但没有建立关闭 Chunk 裁剪的有效对照。视锥链路作用于 Chunk 级对象/容器批次，并不意味着逐个集装箱做独立视锥剔除。裁剪开关 A/B 的 Draw Calls、Triangles、P95 与 CPU update **未测**；24/24 可见也不能用来推导裁剪收益。

## 资源复用与 GPU 资源池

AssetManager 测试各轮可在 `run-1.json` 查看完整请求、状态和资源计数。4 次冷加载观察耗时分别约 2,691ms、68.9ms、2,722.7ms、66.5ms，波动很大（开发服务/浏览器加载状态存在差异），冷加载不适合据此做稳定耗时收益率。冷请求返回 GLB body 109,584 bytes。每次同实例重复请求 10 次均得到 `networkLoads=1, cacheHits=10`，热调用计时分辨率下均为 0ms，故只报告确实发生缓存命中，不计算热加载耗时提升率。8 路并发请求出现 1 次底层加载、7 次 pendingHits，并返回同一资源记录，验证 in-flight 合并行为。此次冷/热组的 HTTP 缓存及 AssetManager 状态不同，不能把全部时间差归因于 AssetManager。

GPU 资源池 JS 微基准最新轮次 A/B 总耗时（每轮 1,000 次）为：A 20.5/14.0/10.4ms，B 1.7/1.0/0.9ms；轮次中位数 14.0ms vs 1.0ms，微基准操作批次耗时降低 **92.86%**。A 组每次创建并释放新几何体/材质（3,000 次总操作）；B 组首次创建后重复复用，记录 2,999 次复用，最终 sweep dispose 1 次。统计的是 JS 创建/池查询与生命周期操作，不是实际 GPU 显存或 GPU 执行收益；estimatedBytes 仅为代码估值。

## 汇总判断与限制

| 项目 | 测试状态 | 可报告的真实结果 |
|---|---|---|
| InstancedMesh | 已完成有效隔离 A/B | Draw Calls 中位数 1,320→1（-99.924%）；平均帧耗时 -0.218%，P95 0%，FPS +0.219% |
| LOD | 已验证机制运行；性能 A/B 未测 | 24 Chunk 被跟踪，LOD 分布 13/11；没有高细节对照收益 |
| Chunk 裁剪 | 正式场景观察；开关 A/B 未测 | 活动/可见 24/24；没有关闭裁剪组，不能计算收益 |
| AssetManager | 缓存/并发行为已实测；稳定耗时收益未测 | 每 10 次重复请求 10 次 cache hit；8 路并发合并为 1 次加载、7 次 pending hit |
| GPU 资源池 | 独立 CPU 微基准已完成 | 1,000 次操作批次中位耗时 14ms→1ms（-92.86%）；不是 GPU 场景收益 |
| 当前正式场景 | 三轮运行基线已完成 | 中位 FPS 65.64、平均帧 11.303ms、P95 窗口均值 13.994ms、约 1,592 Draw Calls、317 万三角形 |

项目使用 GLB 与 PNG/JPEG 纹理；没有 Draco/Meshopt 几何压缩收益测试或声明。没有将 `drawBatches` 误当作全场景 Draw Calls。InstancedMesh 实验的简单几何内容不能代表多材质生产容器的全部开销。正式场景无稳定逐帧原始采样，资源池微基准亦不等于真实 GPU profiling。

## 原始数据和复现文件

- 正式场景基线：[live-baseline-2026-10-26T00-35-14.393Z](../../tests/performance/results/live-baseline-2026-10-26T00-35-14.393Z/)（environment、每轮 JSON、汇总 CSV、快照 CSV）。
- InstancedMesh 对照：[ab-instanced-mesh-2026-10-26T00-49-02.366Z](../../tests/performance/results/ab-instanced-mesh-2026-10-26T00-49-02.366Z/)（A/B 每轮逐帧 JSON、summary JSON/CSV、环境信息）。
- 资源实验四次运行：[00-57-18](../../tests/performance/results/ab-resources-2026-10-26T00-57-18.281Z/)、[00-57-55](../../tests/performance/results/ab-resources-2026-10-26T00-57-55.209Z/)、[00-58-31](../../tests/performance/results/ab-resources-2026-10-26T00-58-31.419Z/)、[00-58-48](../../tests/performance/results/ab-resources-2026-10-26T00-58-48.000Z/)（每目录含 environment、run-1 原始 JSON、池操作数组及 summary CSV）。
- 自动化脚本：[live-scene-baseline.mjs](../../tests/performance/live-scene-baseline.mjs)、[instancing-ab.mjs](../../tests/performance/instancing-ab.mjs)、[resource-ab.mjs](../../tests/performance/resource-ab.mjs)。

可用于简历的审慎表述：“使用 Playwright/Edge 对港口数字孪生场景执行三轮 60 秒运行采样，实测中位 FPS 65.6、平均帧耗时 11.30ms、约 1,592 Draw Calls；另以相同 GLB 网格和 1,320 个实例进行 Mesh/InstancedMesh 对照，Draw Calls 从 1,320 降至 1（99.92%），保持三角形数量一致，P95 帧耗时未见改善。资源池独立 JS 微基准复用路径耗时降低 92.9%，不外推为 GPU 或场景 FPS 收益。”
