# 港口数字孪生性能审计与量化测试

审计日期：2026-10-26。项目：Vue 3 + TypeScript + Three.js 0.185.0，Vite 6.3.5；运行地址 `http://localhost:5173/`。

## 结论

本次完成源码审计、35 项现有 smoke test 和 live 页面观察。没有可靠的历史版本或关闭优化后的 A/B 版本，也没有完成每组 10 秒预热、60 秒采样、重复 3 次的同场景长测。因此帧率、帧耗时等正式基线和优化收益均**未测**，不得据此声称优化提升了多少百分比。唯一运行时数值是一次调试面板快照，供现场参考，不作为基线。

## 环境与现场快照

| 项目 | 记录 |
|---|---|
| OS / CPU | Windows 10 Pro 10.0.19045；Intel64 Family 6 Model 94，8 个逻辑处理器（型号未可靠识别） |
| GPU | AMD Radeon R7 350，驱动 24.20.13022.5005，报告显存 2 GiB |
| 浏览器 | Microsoft Edge 稳定版；具体版本未采集 |
| 页面 | 用户已打开的 localhost:5173；运行时调试面板现场读取，画布 1,655 draw calls、4,944,059 triangles、700 geometries、30 textures |
| 一次面板观测 | FPS 44.4，平均帧 12.12 ms，P95 14.7 ms，CPU update/render 1.07/11.05 ms，quality HIGH |

该面板每秒发布约 1 秒窗口聚合值；每帧数据由 `PerformanceSystem` 累积，P95 是窗口内帧样本排序值。`CPU render` 是 JS 调用渲染路径的 CPU 时间，不是 GPU 执行时间。绘制调用和三角形数为窗口内每帧平均值，不能当作整个场景几何总量。该单次快照未记录固定相机、稳定等待、环境负载和三次独立样本，故不构成正式性能基线。

## 源码审计

| 项目 | 代码证据与判断 |
|---|---|
| 帧指标 | `src/rendering/PerformanceSystem.ts` 每秒默认发布 FPS、平均/P95/最大帧时间、CPU update/render、renderer.info draw calls/triangles、几何/纹理数量、画布尺寸及注册指标。可观测；不提供 GPU timer query。 |
| PerformanceSnapshot / 面板 | 类型定义在 `src/stores/types.ts`；`PortRuntime` 将快照回调送入性能 store，`src/components/PerformanceDebugPanel.vue` 展示窗口指标。`beginFrame()` 调 `renderer.info.reset()`，`afterRender()` 每帧累加 `renderer.info.render.*`；发布时读取 `renderer.info.memory.*` 当前值。 |
| Renderer 与循环 | WebGLRenderer 在 `src/scene/MainScene.ts` 创建；`src/rendering/RenderSystem.ts` 的 requestAnimationFrame 循环触发 FrameObserver update、beforeRender/afterRender 和 EffectComposer 渲染。详细绘制项可能因多个 pass、阴影、composer 而变化。 |
| 渲染路径 | `src/rendering/RenderSystem.ts` 使用 EffectComposer、RenderPass、UnrealBloomPass、OutputPass，并由 FrameObserver 包围采样。后处理及阴影会影响负载；应在固定画质配置下测试。 |
| 区块、包围盒与视锥 | `src/systems/chunk/ChunkSystem.ts` 按空间坐标分桶、维护成员与包围盒；PortRuntime 更新活动区块并用预建 Frustum/Matrix4 对区块 bounds 做视锥判断，再把可见活动区块交给 LOD。该处是 Chunk 级裁剪，不是对象级裁剪；对象/适配器自身仍可能另有隐藏规则。 |
| LOD 链路 | `PortRuntime` 更新 LODSystem，空间渲染 RenderSystem 消费 dirty chunks，按 renderType 分发到容器、道路、船、吊机、AGV 等适配器。LOD 配置是距离级别，含滞回与 debounce；批次/模型切换由适配器执行。历史记录 `lod.trackedChunks=0` 的成因尚未在本次运行中复核：可能反映没有活动区块进入 LOD 跟踪，也可能是历史采样/运行状态问题，不能从静态代码唯一判定，应保存 live LOD/chunk 指标排查。 |
| 容器实例化 | `ContainerRenderManager.ts` 对堆场容器按 Chunk、LOD 和资产分组创建 `InstanceBatch`/InstancedMesh；记录矩阵、增删实例，区块 LOD 变更或签名改变时释放并重建批次，退出活动范围时更新。可见实例、批次数 metric 可辅助验证；真实 renderer calls 还包含其他对象和后处理，不能与批次数简单等同。其他设备适配器仍有普通 Object3D/Mesh 路径。 |
| 模型/几何/材质复用 | `src/assets/AssetManager.ts` 管理加载缓存、in-flight 请求合并、引用计数和闲置回收；`AssetLoader.ts`/GLTF loader 执行资产读取；`GpuResourcePool.ts` 复用渲染资源。只证明实现机制存在，尚无网络级冷/热请求差异或全链路创建计数的量化对照。 |
| InstanceBatch | `src/rendering/InstanceBatch.ts` 维护 InstancedMesh 的实例槽位、矩阵及可见状态，归还/删除实例需更新实例映射与 instance count。smoke test 覆盖其行为，但未做同内容 Mesh-vs-InstancedMesh 性能 A/B。 |
| GPU 资源池 | `GpuResourcePool.ts` 提供引用计数、闲置资源延迟释放、清扫及估算字节统计。估算字节数不等同驱动实际显存。 |
| 自适应画质 | `PortRuntime.ts` 以 `{ enabled: false }` 创建 AdaptiveQualitySystem。因此当前代码接入指标与控制器，但自动调节**默认未启用**；面板 HIGH 不证明自适应策略正在生效。 |
| 模型压缩 | 本次源代码搜索未发现 Draco/Meshopt loader/config 的实现证据；不宣称已启用 Draco/Meshopt。主要 GLB 文件尺寸合计较大，须在报告附带原始资产字节数与后续加载测试中另行评估。 |
| 启动脚本 | `tests/performance/production-startup-baseline.mjs` 已实现独立上下文冷启动 7 次、同上下文热启动 7 次及额外 WebGL 首绘诊断；本次未运行。脚本使用 Chrome executable path，静态服务不启用压缩且 API 写请求仅 stub，不能直接代表 Edge+真实后端部署体验。 |

主要 GLB 原始字节数：AGV 18,284；battery_charger 18,499,348；cc 137,564；container_ship 35,454,960；crane_harbour 12,898,976；crane_harbour2 11,280,344；Crane 542,664；gantry_crane 38,102,448；jzx1 109,584；jzx2 123,564；jzx3 751,756；small_cargo_ship 24,550,580。文件名 `container_ship .glb` 含空格。

## 测试结果

| 测试 | 结果 |
|---|---|
| `npm run type-check` | 通过（本任务前序已运行） |
| `npm run build` | 通过（本任务前序已运行）；Vite 提示 JS bundle 984.02 kB，gzip 275.50 kB，超过 500 kB 建议阈值 |
| `tests/*.smoke.mjs` | 35/35 通过；Node.js v20.20.2 |
| 生产启动性能脚本 | 未运行；当前脚本默认 Chrome，且该指标属于启动/网络资源，不是 60 秒运行帧性能 |
| 三次 60 秒帧性能测试 | 未测；没有预设、可审计的自动相机路线/采集器及统一 A/B 对照 |

## 优化收益对照

| 优化项 | 对照条件 | 基线 | 优化后 | 变化率 | 结论 |
|---|---|---:|---:|---:|---|
| InstancedMesh | 同数量、材质、位置与固定相机的普通 Mesh 对照不存在/未建立 | 未测 | 未测 | 未测 | 已实现；收益未验证 |
| LOD | 近/中/远固定相机，当前启用配置对固定高细节模式 | 未测 | 未测 | 未测 | 有代码链路；运行分布与收益未验证，历史 trackedChunks=0 待复核 |
| Chunk/视锥裁剪 | 相同场景与相机，安全关闭裁剪对照未发现 | 未测 | 未测 | 未测 | 已实现 Chunk 级可见性路径；收益未验证 |
| 资源复用 | 冷缓存首次加载对同页热加载，未采集请求/创建/耗时 | 未测 | 未测 | 未测 | 已实现缓存、合并与引用计数；收益未验证 |
| 模型资产体积 | 当前 GLB 文件 stat 字节数；无压缩前版本与 Network 传输对照 | 不适用 | 当前文件已列出 | 不适用 | 当前体积已测；压缩收益、网络传输和解析时间未测 |

本次不对历史快照（FPS 50、平均帧 11.28 ms 等）与 live 单窗观测做差值：统计窗口、场景状态、环境和采样流程不同。FPS 与平均帧时间在同一个 snapshot 中分别按帧计数/窗口 elapsed 和实际帧样本计算，二者相关但不保证严格互为倒数；AdaptiveQuality 的内部 P95 应以它自己的实现核对，不能假定与 PerformanceSnapshot P95 共用相同采样窗口。本次未收集适应性质量分布序列，正式运行中应固定其关闭状态。

仓库当时已有广泛未提交改动；本次未清理或恢复其文件。构建已生成 `frontend/dist/`，保留供用户检查。

## 可复现测试建议

1. 固定浏览器版本、GPU、驱动、电源模式、窗口尺寸、DPR、场景数据、后端数据、渲染质量、相机路线和浏览器后台活动；记录 commit 与构建模式。
2. 每个条件预热 10 秒，再以 PerformanceSystem 原始帧样本采集连续 60 秒，保留帧级数据与快照；独立重启/重复 3 轮。用相同路线比较优化前后，报告每轮结果及三轮中位数；说明 P95 计算口径。
3. 同时保存 FPS、frame average/P95/max、CPU update/render、draw calls/triangles、几何/纹理、Chunk/LOD/spatialRender、资源池 metrics、模型请求字节、浏览器错误。禁用或固定自适应质量，避免画质变化造成不公平比较。
4. 启动测试使用 `node tests/performance/production-startup-baseline.mjs`；按需求配置 `PW_CHROME_PATH` 为可执行 Chromium/Chrome 路径。若要代表 Edge，应以 Edge 复跑并在结果中记录真实版本；此脚本的冷/热导航指标单独报告，不与稳定帧时混合。

## 简历表述

安全版本：**为 Three.js 港口数字孪生项目构建可观测的性能采样与资源指标体系，接入区块流式加载、LOD、实例化容器批次和 GPU 资源池；完成 35 项 smoke tests。**

本次没有可信 A/B 量化收益，暂不添加“FPS 提升 X%”“Draw Calls 降低 X%”等数字。正式基线完成后再将真实三轮中位数及测试硬件补入简历。
