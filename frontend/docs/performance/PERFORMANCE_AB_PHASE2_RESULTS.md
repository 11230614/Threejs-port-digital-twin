# 港口数字孪生性能 A/B Phase 2：结果与限制

日期：2026-10-26。项目：Vite 开发环境 `http://localhost:5173/`。本轮优先尝试 P0 LOD 与 Chunk 裁剪正式场景对照。目录 [`tests/performance/results/ab-phase2-20261026-102027`](../../tests/performance/results/ab-phase2-20261026-102027/) 保存环境、相机可行性探测说明和状态 CSV。

## 执行结果

| 测试 | 实际执行 | 可报告的性能指标 | 结论 |
|---|---|---|---|
| LOD 机制探测 | 是，短时诊断 | 未测 | 正常视角观测到 Chunk LOD 9 个 LOD0 / 15 个 LOD1，容器 LOD0 336 / LOD1 984；强制 LOD0 后短探测显示 Chunk 全部 LOD0、容器 1320 个 LOD0。它证明开关改变了层级分布，不能说明收益。 |
| LOD 正式场景 A/B（近/中/远，3轮） | 否 | 未测 | 没有完成逐帧 10 秒预热+60秒采样，也未计算逐帧 P95/P99。没有收益百分比。 |
| Chunk 视锥裁剪机位可行性 | 是 | 不适用 | `scan-phase2.mjs` 在相机 x/z 网格扫描收到 299 个空间快照，未找到 active-visible >= 5 的视角。此前默认机位为 24/24 可见。未形成足以验证裁剪收益的有效场景对照。 |
| Chunk 裁剪正式场景 A/B | 否 | 未测 | 没有关闭裁剪后的逐帧与 renderer 对照；不能把可见 Chunk 计数当作渲染工作量收益。 |
| 正式场景 InstancedMesh | 否 | 未测 | 按用户指定顺序，P0 未完成，因此没有进入 P1。此前独立 harness 不属于正式场景结果。 |
| 正式场景 GPU 资源池 | 否 | 未测 | P0 未完成，未在正式场景运行生命周期对照。上一轮 JS 微基准不能外推为真实 WebGL/场景收益。 |

## 实验环境与限制

本轮相机扫描使用 Microsoft Edge 156（Playwright 驱动，headless），视口 1365×768、DPR 1；页面 canvas 观测尺寸 819×460。使用开发服务器与 DEV-only 测试接口。尝试的相机位置来自 x/z = -1200 至 1200 网格；收到 299 个 `spatial-render-snapshot`。这是可行性探测，不是正式采样。当前布局/相机扫描没有提供足够多的视锥外活动 Chunk，因此 Chunk A/B 无法在既定场景内容下验证。要继续，需要先从现有 chunk bounds 与 frustum 联合求出一个视锥外 chunk 充足的固定机位，再确认 A/B renderer calls/triangles 的差异。

LOD 强制 LOD0 的 DEV 测试开关确认了几何细节层级变化，但本轮没有完成正式的近/中/远逐帧组。故 FPS、均值、中位数、P95、P99、最大帧时、CPU update/render、draw calls、triangles、对象等价性均标记“未测”。CPU render 若将来采集，只表示 CPU 侧渲染提交时间，不代表 GPU 执行时间。

独立 InstancedMesh harness 上一轮报告普通 Mesh 1320 draw calls、InstancedMesh 1 call，Triangles 均为 997,920；该数据只代表独立 harness，不能与正式场景或本轮探针合并计算。上一轮 AssetManager 缓存和 GPU pool JS 微基准同样分别保留为其原测试，不作为本轮正式场景收益证据。

## 结论

本轮**没有得到正式场景性能收益百分比**。LOD 当前只完成机制变化确认；Chunk 完成机位可行性扫描但没有有效对照；P1 未执行。不能据此宣称 LOD、Chunk 裁剪或正式场景资源池已证明性能收益。下一步应先用 chunk bounds 与相机 frustum 做确定性机位搜索/可视化，找到足量视锥外活动 Chunk；然后完成 Chunk 三轮 A/B 以及近/中/远 LOD 三轮逐帧采样，再进入 P1。

## 复现

在 `frontend` 目录先启动 `npm run dev`，再执行 `node tests/performance/scan-phase2.mjs`。结果目录中的 `environment.json` 和 `summary.csv` 记录了这次扫描结果及未执行项目。正式 benchmark 只有在逐帧收集完成后才应生成收益统计。
