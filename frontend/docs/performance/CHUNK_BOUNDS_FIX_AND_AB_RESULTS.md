# Chunk bounds 修复与视锥裁剪 A/B 结果

日期：2026-10-26。完整原始数据位于 [结果目录](../../tests/performance/results/chunk-bounds-fix-20261026-112500/)。本报告将短时绘制提交确认与正式六轮性能采样分开；没有把短时结果当作正式收益。

## 根因与修复

修复前 Chunk 是固定 XZ 网格分区，bounds 是网格柱且 Y 为 ±1,000,000，并非成员渲染 bounds 的并集。`PortRuntime` 的 `chunk-spatial` 更新同步相机矩阵后，以 Frustum `intersectsBox` 判断 Chunk；巨大 Y 范围使视锥测试过度保守。Phase 2 快照记录旧 bounds，同一相机下 DEV tight-Y 得到 24 active、18 visible、6 outside。

修复保留固定 XZ 分区、对象 owner/覆盖登记和业务空间查询语义，另维护渲染专用 `cullingBounds`。`ChunkSystem.ts` 的 `_resolveBounds`、动态句柄同步和 `_getChunkKeys` 继续从对象世界 Box3 确定格覆盖；`_recomputeChunkBounds` 聚合成员渲染 bounds：跨格对象按各格 XZ 范围裁切后计入对应 Chunk；只登记单一 owner 格但模型视觉 bounds 伸出该格的成员保留完整 bounds，避免漏剔除。注销、移动、bounds 更新会重算受影响 Chunk。空 Chunk 使用空 Box3，不用无穷高柱。

`PortRuntime.ts` 正式路径用 `chunk.cullingBounds` 做 `intersectsBox`，并在判断前更新相机矩阵。DEV tight-Y 分支仍由 `import.meta.env.DEV` 守卫，不参与生产默认路径。LOD 消费 Chunk 可见状态；可见性经渲染适配器/容器批次影响 Three.js 绘制提交。Chunk bounds 不重分配对象 owner，也不改变批次构造。

证据：`src/systems/chunk/ChunkSystem.ts` `_resolveBounds`（约 441 行）、动态同步（467–489 行）、`_getChunkKeys`（499 行）、登记/注销（557–570 行）、`_recomputeChunkBounds`（627 行起）；`src/app/PortRuntime.ts` 空间更新（1134 行起）、`intersectsBox(chunk.cullingBounds)`（1166 行）及 DEV snapshot（1206 行起）。

## 正确性验证

固定机位 position `[450,320,-80]`、lookAt `[0,8,-80]`、FOV 55°、aspect 1.77734375、near 1、far 5000。检查通过：24 个活动 Chunk 中 18 可见、6 视锥外；视锥外 ID 为 `2:-2`、`3:-2`、`2:-1`、`3:-1`、`3:0`、`2:0`。逐 Chunk bounds/member 数据见 `bounds-before-after.json`、`correctness-results.json`。高物体、跨格 bounds、owner 单格但模型越界、动态 bounds 移动与注销由 `tests/chunk-system.smoke.mjs` 覆盖。截图为 `culling-enabled.png`、`culling-disabled.png`。

视锥外 Chunk 中与视锥相交的适配器渲染成员为 0，页面错误为 0；同时保留 8 个逻辑或非批次句柄，它们自身 bounds 可独立相交，不应归因于 Chunk 误剔除。短时逐帧确认：裁剪开启 calls 1561、triangles 3,090,276；关闭 calls 1577、triangles 3,411,706。这仅证明链路影响提交。`renderer.info` 即时 snapshot 受 Three.js reset 时序影响，确认文件该字段为 0，未将其用作绘制量数据。

## 正式裁剪 A/B

A=裁剪开启，B=仅 DEV 测试开关关闭 Chunk 裁剪。运行次序 A/B/B/A/A/B。帧分位数由逐帧 JSON 计算。表中为 A/B 三轮中位数；越低越好的指标按 `(A-B)/B` 计算为 A 相对 B 的下降率；FPS 按 `(A-B)/B` 计算为提升率。

| 指标 | A 开启裁剪 | B 关闭裁剪 | 观察 |
|---|---:|---:|---|
| FPS 均值，中位轮次 | 72.97 | 71.43 | A 高约 2.15%，不视为稳定收益 |
| 帧均值 ms | 13.70 | 14.00 | A 低约 2.14%，描述性 |
| 帧 P95 ms | 39.30 | 42.10 | A 低约 6.65%，描述性 |
| 帧 P99 ms | 52.10 | 52.70 | A 低约 1.14% |
| 最大帧 ms | 62.90 | 65.60 | A 低约 4.12% |
| Draw Calls 均值 | 1555.56 | 1572.67 | A 低约 1.09%，提交量差异可重复 |
| Triangles 均值 | 3,111,967 | 3,432,560 | A 低约 9.34%，提交量差异可重复 |
| CPU update 均值 ms | 2.70 | 2.80 | A 低约 3.72%，描述性 |
| CPU render submit 均值 ms | 11.00 | 11.20 | A 低约 1.76%；不是 GPU 时间 |
| active/visible/outside Chunk | 24/18/6 | 24/24/0 | 开关改变 Chunk 可见状态 |

逐轮值见 `summary.csv`。B3 仅 1761 帧，其余约 2915–3637；帧时差异受运行负载及采样率影响。故不宣称稳定 FPS/帧时间收益。可确认本固定场景和机位排除了 6 个 Chunk，并降低实际提交的平均三角形及少量 Draw Calls。数据未证明裁剪降低 CPU update/render。

## LOD 后续准备

正式样本显示 LOD trackedChunks=24，levels `{0:9,1:9,3:6}`，switches=67；1320 个容器统计为 LOD0 576、LOD1 480、LOD2 0。批次几何统计显示高细节组约 21,912 triangles、简化箱体批次约 120 triangles（批次几何与实例总提交统计口径不同；实例总提交估算约 708,216 对 9,600）。这是复杂度/机制证据，不是正常 LOD 对强制 LOD0 的等价 A/B；本轮未进行正式 LOD 性能采样。

## 检查与限制

- `vue-tsc --noEmit`：通过。
- `vite build`：通过，有大于 500 KB chunk 警告。
- 项目 smoke tests：35 项通过，0 失败。
- 未完成 LOD A/B；没有重新测 InstancedMesh、资源池或其他 P1。
- 环境为 Edge 156 Headless，viewport 1365×768、DPR 1；Canvas backing size 819×460，pixelRatio 探针为空。
- 不报告 GPU 执行时间或显存变化。

## 修改文件

正式逻辑：`src/systems/chunk/ChunkSystem.ts`、`src/app/PortRuntime.ts`；回归覆盖：`tests/chunk-system.smoke.mjs`；浏览器脚本：`tests/performance/chunk-bounds-fix-confirm.mjs`、`tests/performance/chunk-bounds-fix-ab.mjs`。历史基线及 Phase 2 原始结果未删除或覆盖。
