# 主 JavaScript Chunk 体积审计

## 结论

当前生产构建只有一个 JavaScript entry chunk，没有动态 chunk。其约 980.59 kB 的 minified 体积主要来自静态首屏依赖图中的 Three.js 核心模块和 3D addon；Rollup 模块统计中 Three.js 相关已 tree-shaken 模块在压缩前合计约 1.85 MB，是最大的依赖族。Vue runtime 的模块统计约 187 kB，Pinia 约 10 kB，项目应用模块约 377 kB（均为 minifier 之前的 Rollup `renderedLength` 汇总，不能当成最终 chunk 的字节归属或占比）。仓库没有 ECharts 依赖或导入，因而 ECharts 不是本次 chunk 的来源。

## 环境与可复核方法

- 项目脚本：`npm run build`，Vite 配置为 `vite.config.js`，使用 `@vitejs/plugin-vue`；生产默认 minification 未改动。
- 模块级统计：使用当前已安装的 Vite/Rollup Node API 执行同一 `vite.config.js` 和生产构建流程，向 Rollup 临时追加只读 `generateBundle` 诊断 hook，读取输出 chunk 的 `modules[*].renderedLength`、`originalLength`、静态/动态 chunk import。没有写临时脚本、改配置、安装包或改锁文件。
- 输出目录：`C:\Users\26057\AppData\Local\Temp\bundle-size-58-summary-4db4a11fc1d64359aa8117a6385a23e8`，构建前由本批新建，位于项目根目录以外。
- 独立基线命令 `npm run build -- --outDir C:\Users\26057\AppData\Local\Temp\bundle-size-58-production-7ec1da1368a749388af7ff8528891578` 也通过；结果与模块分析构建相同：JS 980.59 kB / gzip 274.58 kB，CSS 10.22 kB / gzip 2.49 kB。
- 同次基线生产构建输出：`assets/index-ouA8fSGu.js` 980.59 kB，gzip 274.58 kB；CSS 10.22 kB，gzip 2.49 kB。Chunk 阈值警告基于 minified、gzip 前 JavaScript，不表示 gzip 下载体积也是 980.59 kB。没有测 Brotli，也没有使用真实网络/浏览器性能追踪。
- Rollup entry chunk 的最终代码字节数为 980,588 bytes；1 个 entry，141 个输出模块，`imports: []`、`dynamicImports: []`。Vite 的 500 kB chunk 提示是建议警告，不是构建错误。
- `renderedLength` 记录的是 Rollup tree-shaking 后、最终 minifier 压缩前的模块代码长度。它用于排名和模块族粗略对照；不是 minified 最终产物的逐模块 byte map，不能将单模块长度与 980.59 kB 直接做精确份额计算。Rollup 模块族压缩前汇总如下：

| 模块族 | 输出模块数 | 压缩前 `renderedLength` 汇总 | 解释 |
| --- | ---: | ---: | --- |
| Three.js（含 examples/jsm） | 20 | 1,846,311 B | 最大依赖族；含核心与所用 addon |
| Vue | 4 | 187,196 B | runtime-core、reactivity、runtime-dom、shared |
| Pinia | 1 | 10,027 B | 状态管理运行时代码 |
| 项目源码及其他模块 | 116 | 377,266 B | TS/JS/Vue 应用代码、虚拟模块等 |

模块级排名靠前项（Rollup 压缩前 tree-shaken 长度）：

| 模块 | `renderedLength` | 来源/实际路径 |
| --- | ---: | --- |
| `three/build/three.core.js` | 950,376 B | `three` 包核心；被 `three.module.js` 的导出入口使用 |
| `three/build/three.module.js` | 639,129 B | 多个业务模块的 `import * as THREE from "three"` 解析入口 |
| `@vue/runtime-core` | 118,797 B | Vue 3 应用组件和 Runtime |
| `three/examples/jsm/loaders/GLTFLoader.js` | 112,919 B | 当前 entry 图由 `AssetLoader.ts` 静态导入 |
| `@vue/reactivity` | 44,946 B | Vue/Pinia 响应式依赖 |
| `three/examples/jsm/controls/OrbitControls.js` | 40,349 B | `rendering/RenderSystem.ts` 静态使用 |
| `src/world/GroundSystem.ts` | 35,571 B | Runtime 首屏创建港口地面/场景资源 |
| `src/world/RoadSystem.ts` | 34,049 B | Runtime 的道路系统 |
| `src/app/PortRuntime.ts` | 30,668 B | App 挂载时静态导入并启动 |
| `@vue/runtime-dom` | 15,872 B | Vue 浏览器 DOM runtime |
| `src/ecs/systems/TaskSystem.ts` | 15,561 B | Runtime 任务系统 |
| `src/ecs/systems/QuayCraneSystem.js` | 15,279 B | Runtime 岸桥业务系统（仍为 JS 权威实现） |
| `three/examples/jsm/utils/BufferGeometryUtils.js` | 14,769 B | `LowDetailFactory.ts` 静态导入 |
| `three/examples/jsm/postprocessing/UnrealBloomPass.js` | 14,541 B | `rendering/RenderSystem.ts` 静态导入 |
| `three/examples/jsm/modifiers/SimplifyModifier.js` | 12,679 B | `LowDetailFactory.ts` 静态导入 |
| `three/examples/jsm/objects/Water.js` | 11,555 B | `GroundSystem.ts` 静态导入 |

## 入口与加载关系

当前主链为 `index.html → src/main.ts → App.vue → PortRuntime.ts`。App 在 `onMounted` 中立即创建并 `await portRuntime.start()`；PortRuntime 静态导入场景、道路/堆场、ECS、资产、渲染和性能模块。渲染链静态导入 Three.js、OrbitControls、EffectComposer、RenderPass、UnrealBloomPass 和 OutputPass；MainScene 静态导入 CSS2DRenderer、Sky；GroundSystem 静态导入 Water；AssetLoader 静态导入 GLTFLoader。`GLTFFactory.ts` 虽也静态 import GLTFLoader，但在当前源码中未找到其生产调用点，且未出现在本次 entry 模块清单中，不应计入当前 chunk 贡献。Rollup entry 的 `dynamicImports` 为空，源码扫描也没有 `import()`/`defineAsyncComponent`。因此目前 3D 核心及场景启动依赖均进入首个 JS chunk。

模型 GLB 并未内联进 JS chunk，Vite 将它们作为单独静态资源输出；本次输出中的货船 GLB 约 24.55 MB、岸桥 GLB 约 11.28 MB，属于资产下载/解析/显存负载，不是 980.59 kB JS chunk 的组成。这些模型大小仍可能影响整体启动时间，但需要单独分析浏览器网络与解码时间。

Lockfile 与构建模块图显示本项目依赖的是一个 `three@0.185.0` 包路径，没有发现多份 Three.js runtime 被重复打入 entry。各业务文件多次 `import * as THREE from "three"`，Rollup 仍将其解析进同一模块图；不能仅因导入语句重复就认定存在多份 Three.js。

## 拆分候选与风险评估

| 优先级 | 候选与当前路径 | 潜在收益 | 风险/影响 | 建议验证 |
| --- | --- | --- | --- | --- |
| 1（先做性能基线，不立即改） | 把 `PortRuntime` / 3D 场景启动改为用户进入 3D 工作区时动态导入。当前 `App.vue` 静态导入 PortRuntime，并在 `onMounted` 立即启动；3D 是当前主界面主体。 | 若未来提供非 3D 首页、登录/帮助页或延迟进入工作区，可让这些页面避免下载 Three.js 核心，收益最大且只对真正非 3D 入口有效。 | 目前没有路由或替代首页；只把导入改成 `import()` 但仍在 mounted 立即执行，只会把同一资源延后到异步请求，并可能增加启动瀑布/白屏时间，不一定改善首屏。Runtime 异步失败和卸载竞态需处理。 | 先定义真实非 3D 页面/交互边界，再做前后构建对比和 Chrome 网络/Performance 记录；验证启动、失败重试、卸载时迟到 Promise、同一 Runtime 唯一性。 |
| 2（小范围） | `LowDetailFactory.ts` 对 `SimplifyModifier` 与 `BufferGeometryUtils` 的静态导入。该功能属于容器低细节模型生成。 | 若确认初始视角/启动不需要生成低模，可在首次进入远距 LOD 或第一次实际构建低模时加载 addon，拆出体积有限的功能 chunk，并可能延后非关键工作。 | 如果 ContainerRenderManager 在初始化时立即预建 LOD，动态导入可能仍然阻塞启动；首次远景切换可能出现卡顿/闪烁，需异步构建、取消与缓存。两项 addon 的 tree-shaken体积约 27 kB（minifier 前模块值，非最终节省量），并不能解决核心 Three.js 大头。 | 跟踪真实 `LowDetailFactory` 调用时机；若可延迟，比较首屏与首次远景 LOD，检查并发只加载一次、失败回退和资源释放。记录各 chunk gzip 与真实网络请求。 |
| 3（谨慎评估） | `RenderSystem.ts` 的 Bloom 后处理链：UnrealBloomPass、EffectComposer、RenderPass、OutputPass。 | 若 Bloom 可作为可选画质能力，关闭时可考虑延后相关 addon；可降低低配置/非 Bloom 模式的启动代码。 | 当前构造即创建 composer 和 bloom pass，画面与颜色管线依赖 pass 顺序；拆分会影响第一帧、resize、quality 切换和销毁。其单模块实测不大，不值得为警告引入脆弱手动分包。 | 先做真实质量配置行为审计；在 bloom off/on、首帧、resize、stop/destroy 和多次切换下做 Chrome 图像及运行时回归，并比较首次交互延迟。 |
| 不建议作为首选 | `manualChunks` 将 Three.js 强制拆成 vendor chunk。当前全应用是单 entry，所有 Three.js 都由首屏 Runtime 静态使用。 | 可以分离缓存边界/并行请求，但首次打开仍要下载同样依赖，未必减少总传输量。 | 可能增加请求、破坏共享依赖执行顺序、导致循环 chunk 或 Runtime 入口额外等待；单纯将同一依赖挪到另一个文件不会消除其重量。 | 只有在多入口或多页面复用明确后再试；比较首屏 waterfall、缓存命中、冷/热启动总耗时和 chunk graph。 |
| 暂无候选 | ECharts、重复 Three.js 包、开发专用诊断模块。 | 可能的常见优化方向。 | 本项目未安装/导入 ECharts；构建模块图未见重复 Three.js 包；`import.meta.env.DEV` 诊断分支有构建期条件，不是已证实的主要体积来源。 | 如果将来引入图表或额外入口，应以新构建模块图重新审计。 |

## 建议实施顺序

1. 先将本报告作为未拆分基线，并以 Chrome Performance/Network 记录冷启动 JS 传输、GLB 请求、模型解析、Runtime.start() 和首帧时间；不要只盯 chunk 阈值。
2. 在产品层确认是否存在真实“非 3D 首页/延迟进入 3D 工作区”需求；若没有，暂不对 PortRuntime 做表面动态导入。
3. 优先追踪低模构建是否阻塞首次可交互；只有确实非关键时，才试验延迟加载低模 addon。
4. 将 Bloom 可选性和体验要求作为独立决策；不要先加 `manualChunks`。
5. 每次候选变更单独比较 minified、gzip（如可用再测 Brotli）、请求数量、冷/热启动、首帧与运行时行为；模型 GLB 资产继续单独测量。

## 第五十九批：生产构建冷/热启动浏览器基线

### 测量实现与边界

- 新增可复现命令：`npm run test:performance:production-startup`，实现位于 `tests/performance/production-startup-baseline.mjs`。它直接调用当前 `vite.config.js` 的 Vite production build，然后在新建系统临时目录生成产物并以本地静态服务器加载；不使用 Vite dev server，也不改变 Vite 配置或生产源代码。
- 正式测量输出：`C:\Users\26057\AppData\Local\Temp\port-startup-59-pmgKh7\production`。机器可读数据：`C:\Users\26057\AppData\Local\Temp\port-startup-59-pmgKh7\samples.json`。路径在项目目录外，未触碰已有 `dist/`。
- 环境：Windows x64、Node `v20.20.2`、系统 Chrome `154.0.8037.99`、Vite `6.4.3`。构建 chunk 与第五十八批一致：JS 980.59 kB（gzip 构建估值 274.58 kB），CSS 10.22 kB（gzip 2.49 kB）。
- 冷启动：同一 Chrome 进程中使用 7 个新的隔离 browser context，每个上下文站点 HTTP cache/service worker 状态为空。它代表浏览器 HTTP 缓存冷启动；操作系统文件缓存、CPU/GPU 状态与机器负载没有清除或控制，因此不代表磁盘冷启动或真实广域网冷启动。
- 热启动：同一个 context 先完成一次缓存预热（不计入样本），再采 7 次重新访问；HTTP cache 保持启用。没有关闭缓存。
- 本地静态服务器对 HTML 使用 `no-cache`，对输出资产使用 `max-age=31536000, immutable`，没有 gzip/Brotli。生产应用的只读 API 请求 `/api/tasks`、`/api/devices`、`/api/db/health` 返回 404；`POST /api/containers/sync` 在本地被无副作用 stub 回 200，以避免连接数据库或写入业务数据。没有启动后端、创建任务或运行 Promote。
- 每个样本有效表示：文档 HTTP 成功、页面创建有效尺寸 Canvas、没有 uncaught page error 或失败请求。Chrome 控制台有预期的无后端 API 404 资源错误；它们被记录但不混作 JS 异常。此定义不能证明 Runtime 已成功完成或后端集成正常。
- 每次采样前注入只读 PerformanceObserver，记录 paint、LCP、Long Task 与 Canvas DOM 插入时刻。一次额外的、明确标记的 WebGL diagnostic 样本在页面脚本前包装 draw API，只用于观察首次 draw，不纳入冷/热主要统计；该包装会扰动诊断样本时序。

### 冷/热样本结果

下表时间均为导航开始后的毫秒。`结束`是脚本从调用导航到 `load` 后等待 `networkidle` 的墙钟时间（包含浏览器的 network-idle 判定，不等同 Runtime ready）；DCL/load/FCP/LCP/Canvas 各自保留其浏览器 API 语义。7 个冷样本和 7 个热样本全部有效，失败样本 0。

| 样本 | 冷：结束 | DCL/load | FCP/LCP | 首 Canvas | 热：结束 | DCL/load | FCP/LCP | 首 Canvas |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4280 | 1150/1150 | 1480/1508 | 1149.6 | 2465 | 208/209 | 236/316 | 207.8 |
| 2 | 2365 | 171/171 | 200/212 | 169.9 | 2618 | 165/165 | 200/256 | 164.5 |
| 3 | 2343 | 164/165 | 188/204 | 164.0 | 2591 | 196/197 | 228/292 | 195.8 |
| 4 | 2477 | 161/161 | 184/212 | 160.5 | 2476 | 178/178 | 216/280 | 177.2 |
| 5 | 2433 | 178/178 | 212/236 | 177.2 | 2398 | 182/182 | 212/240 | 181.9 |
| 6 | 2692 | 188/188 | 220/260 | 187.0 | 2533 | 171/172 | 200/256 | 170.8 |
| 7 | 2533 | 164/164 | 192/220 | 163.0 | 2333 | 193/193 | 228/296 | 193.0 |
| 中位数 | **2477** | **171/171** | **200/220** | **169.9** | **2476** | **182/182** | **216/280** | **181.9** |
| 范围 | 2343–4280 | 161–1150 | 184–1480 / 204–1508 | 160.5–1149.6 | 2333–2618 | 165–208 | 200–236 / 240–316 | 164.5–207.8 |

冷/热 `结束`中位数几乎相同（2.477s / 2.476s），不表示缓存没有作用：此值包含脚本等待 `networkidle`，而不是纯下载时间或 Runtime 完成时间。热样本 JS、CSS 在 7/7 次均从 Chrome disk cache 命中；6 个 GLB 中 4 个命中缓存，约 24.55 MB 货船与 11.28 MB 岸桥模型在本机 Chrome 的 7 次热访问中仍为网络响应（每次均应检查原始记录中的 `fromDiskCache`，本批样本观察到 4/6 个 GLB 命中）。冷样本全部主资源与 6 个 GLB 返回 HTTP 200、均未命中浏览器缓存。热缓存命中响应的 CDP `encodedDataLength` 为 0，这是缓存命中表现，不表示资源内容为空；Resource Timing 中相应 `transferSize` 可能只含响应头/缓存计时开销。

### 网络、主线程与 Runtime 时间点

- Navigation Timing：冷样本 `responseStart` 中位数 2.7ms（范围 2.2–9.9ms），热样本 3.9ms（2.5–5.4ms）。这是 localhost 静态服务，不能代表线上 TTFB。
- Resource Timing 与 CDP 网络响应在冷样本看到 JS encoded body 980,588 B、CSS 10,223 B；Network CDP 编码传输长度约 980,956 B / 10,458 B（含传输/响应开销）。响应没有 `Content-Encoding`；该静态服务器未压缩。因而本次实测不是 gzip/Brotli 部署传输；gzip 数值仅是 Vite 构建估算。冷样本同时下载 6 个 GLB，CDP 编码长度从约 109.8 kB 到 24.55 MB；模型资产体量远大于 JS chunk，但本机实验不代表公网实际下载耗时。
- FCP/LCP：冷中位数 200/220ms；热中位数 216/280ms。Canvas 插入中位数分别 169.9/181.9ms。首次 Canvas 只表示 DOM 中存在非零尺寸 Canvas，不表示 Runtime 完成，也不代表 Canvas 已有有效内容。
- `runtime-ready` 是 `PortRuntime._emitDiagnostic` 的 DEV-only 自定义事件，正式构建不发送。故冷/热主样本的 Runtime ready 明确为**未测量**，没有用 DCL、Canvas 或 network-idle 替代它。
- WebGL 首次绘制在一组额外 diagnostic 样本中测得：Canvas 插入约 164ms、首个 WebGL draw 调用约 1254ms。该时间通过页面加载前包装 WebGL draw API 获得，属于有插桩的单次诊断，不纳入主样本统计且可能受包装扰动。它只证明观察到 draw API 调用，不证明 GPU 完成帧、画面视觉稳定或 Runtime 所有初始化工作均结束。
- Long Task API 在各未插桩主样本记录到约 4–5 个 `>=50ms` 条目，最长单项范围约 1.16–1.90s。该结果支持“Canvas/FCP 后仍存在明显主线程工作，完整场景加载阶段并非只受静态 JS 网络请求支配”。它不能把耗时归因到低模、GLTF parse、地面程序化 Canvas、Bloom 或任何单独模块；本批没有可靠的模块级时间分段。
- 观测到 `systems-started`、`runtime-ready`、首次稳定画面之间的 production 时间间隔不可直接取得；模型加载/解码与低模生成各自耗时、Bloom 初始化耗时、GPU 队列完成时间、真实首帧/稳定场景均未独立测量。没有 CPU profile/完整 Chrome trace、网络节流、Brotli、CDN/HTTP2/HTTP3 或 GPU 压力数据。

### 基于实测的后续顺序

1. **先补精确的 production Runtime 起止观测（测试注入或 Performance trace），再做归因。** 当前可见长任务最长超过 1s，但不能凭其大小断言来自 GLB、低模或 Bloom。任何未来测试标记应只在测试注入，或通过不进入生产 API 的构建外工具取得。
2. **优先验证 GLB 下载与解析/建场景的各自贡献。** 本机缓存热启动中 JS/CSS 和 4 个 GLB 复用，但 2 个最大模型仍重新传输；模型总资源显著大于 JS。下一步记录各模型 response end、decode/parse、加入场景与首绘时间，并在真实网络/部署压缩下复测。优化验证指标应分别是网络 transfer、主线程 long task、Runtime ready/首绘，不只比较 network-idle。
3. **主 JS 体积仍是传输候选，但不是唯一证据。** JS 实测本地未压缩约 981 kB、静态 gzip 估算 274.58 kB；部署服务器实际压缩未测。优先确认生产服务器 gzip/Brotli 与缓存头，再用同一浏览器测量流程比较冷/热 JS 传输与 FCP/Runtime/首绘。
4. **低模与 Bloom 暂不据此建议动态导入。** 本批没有观测到它们独立耗时或首绘阻塞；应先分别加外部诊断时间段，证明发生在首次有效绘制之前且占用显著，再比较延迟执行前后 Runtime ready、首绘、首次 LOD 变化和视觉效果。
5. **继续不手工拆 Three.js。** 单一入口和实际使用范围仍然清晰；这组数据没有证明强制 manualChunks 能缩短主线程工作或总启动时间。只有建立多个真实入口/延迟功能边界或验证可缓存收益后，再开展拆包 A/B 测试。

### 本批验证记录

- `npm run test:performance:production-startup`：通过；项目外临时 production build 成功，冷 7/7、热 7/7 有效，另有一个 WebGL 插桩诊断样本；未调用 Promote。测试输出和原始 JSON 位于上方系统临时目录。
- `npm run type-check`：通过。
- `npm run build -- --outDir C:\Users\26057\AppData\Local\Temp\port-startup-59-final-build-019fa16d37467f50bac0ccab3e29943d`：通过；230 modules。Vite 给出既有 >500kB chunk 建议 warning，非失败；outDir 在项目外。
- `git diff --check`：通过。
- 本批只新增独立测量脚本/命令并更新审计说明；没有修改应用业务、Vite 分包或加载逻辑，没有触碰 `server/` 和项目 `dist/`，没有提交/推送。

## 本批验证与限制

- `npm run build -- --outDir <本批新建系统临时目录>`：Vite 生产构建通过，230 个模块转换；产物没有写入项目 `dist/`。
- 使用 Vite Node API 的临时 `generateBundle` 插件采集 module/chunk 关系；插件只输出诊断信息，不写入项目配置或源码。
- `npm run type-check` 与 `git diff --check` 通过。
- 未安装分析插件，没有运行浏览器启动性能追踪、真实网络限速、Brotli测量、GPU 压测或模型解码性能测试。模块级 `renderedLength` 不是 minified 字节归属图，因此报告只将它用于排名和宽泛模块族诊断，不宣称精确百分比或拆分后节省值。
- 以上结果只对应当前 checkout 与当前安装依赖/构建环境；不代表生产服务器压缩、CDN、缓存或用户设备的实际加载耗时。

## 第六十批：Production 主线程长任务归因与 Chrome CPU Profile

### 诊断方式与数据隔离

- 新增 `tests/performance/production-long-task-diagnostics.mjs` 与 `npm run test:performance:long-task-diagnostics`。使用已安装的 Vite、Playwright、Chrome CDP `Profiler`/`Tracing` 和 `source-map-js`，没有新增依赖或改永久 Vite 配置。
- 按当前 `vite.config.js` 生产配置构建，使用一次性 Vite Node API 参数开启 source map。诊断产物目录：`C:\Users\26057\AppData\Local\Temp\port-long-task-60-bDFTL8\diagnostic-production`；主 JS 980.63 kB、gzip 构建估值 274.61 kB、source map 约 5.00 MB。正式无 source map 基线仍以第五十九批 980.59 kB/274.58 kB 为准，不能混用诊断构建的体积和计时。
- 环境为 Windows x64、Node `v20.20.2`、系统 Chrome `154.0.8037.99`。冷、热各有 3/3 有效 CPU Profile 与 1 份 Trace；额外的并行 Trace/Profile 同页采集用于把 Trace 的 RunTask 时间窗与 Profile 样本关联。摘要在 `C:\Users\26057\AppData\Local\Temp\port-long-task-60-bDFTL8\diagnostics-summary.json`，原始 Profile 在 `profiles\`，原始 Trace 在 `traces\`。
- 冷启动为隔离新 context，热启动在同一 context 先预热再采样。服务器缓存头沿用第五十九批；无 gzip/Brotli。GET API 返回本地 404，`POST /api/containers/sync` 为无副作用 stub。没有运行 Promote、后端或数据库写入。
- CPU Profile/Trace/页面插桩均会产生诊断开销。Profile sample/delta 是统计采样，不是单函数精确 wall-clock；所有数字应作为路径/相对工作量证据，不与第五十九批无插桩时间混合。

### 秒级主线程长任务归因

同页 Trace 的最长 `CrRendererMain` RunTask：冷 `2700.109 ms`，热 `2612.362 ms`。同一页 Long Task API 对应项分别为 `2699 ms`（performance.now 约 1272.7–3971.7 ms）和 `2611 ms`（约 1040.5–3651.5 ms）。首次 WebGL `draw*` API 调用 wrapper 分别观测到约 1812.7 ms 和 1485.8 ms，因此最长任务从首次 draw 前开始并在其后结束。draw API 调用不是 GPU 完成绘制或画面稳定的证据。

并行 Profile 对应的主线程任务窗口内：

- 冷：2018 个采样点；Three.js 帧 1636 个（采样增量估值约 2.300 秒）、应用帧 333 个（约 328 ms）、浏览器/V8 内部 48 个（约 71 ms）。
- 热：1976 个采样点；Three.js 帧 1634 个（估值约 2.290 秒）、应用帧 297 个（约 255 ms）、浏览器/V8 内部 45 个（约 69 ms）。这些增量不是每个函数的精确运行时间，也不应换算为精确 CPU 百分比。

冷、热一致的主要调用链（经 source map 回映）：

`PortRuntime.start → rendering/RenderSystem.start → animate/frame → EffectComposer.render → RenderPass.render → WebGLRenderer.render → renderBufferDirect/setProgram → WebGLState.setTexture2D/uploadTexture → texSubImage2D`

最高频 self frame 映射至 Three.js `three.module.js`：`texSubImage2D` 冷/热分别 936/824 个样本（采样增量估值约 1.561/1.375 秒），`onFirstUse` 分别 306/423 个样本（约 510/699 ms）。同一窗口中也存在应用侧调用 `GroundSystem.create → _createDock → _createConcreteTextures → _createNormalMapFromCanvas`（冷 196 个样本、约 111 ms；热 172 个样本、约 66 ms）与 `_createConcreteTextures`（冷约 133 ms、热约 112 ms）。故证据支持“启动首轮渲染中的 Three.js 材质首次使用/纹理上传为这段长任务的主要 sampled path”，GroundSystem 程序化纹理是次级可测工作。

Trace 能确认长 RunTask 的主线程与 wall interval，但没有在该最长 RunTask 内采到可映射的生产 `FunctionCall` 子事件；函数级归因来自**同一页、同一时间窗**的 CDP CPU Profile 节点和 source map，不是跨运行拼接。Profiler/Tracing 并行会增加负载，具体耗时仍须通过不插桩基线复测。

### 低模、Bloom、模型解析与缓存

- 低模代码**实际运行过**：冷启动其后约 657 ms 的主线程 RunTask/Profile 窗口中出现 `SimplifyModifier.computeEdgeCollapseCost` 10 个样本（采样增量估值约 15 ms）、`modify` 4 个样本、`mergeVertices` 8 个样本（约 10 ms）。但这些不在最长约 2.7 秒任务的主栈中；热启动对应第二长任务也没有显著 Simplify/merge 样本。因此低模是实际次级工作，现有证据不支持它是秒级任务首要成因。
- `UnrealBloomPass.render` 在最长任务内的调用栈中存在，但冷/热分别仅 13/17 个样本；其栈与普通 RenderPass 的首次材质/纹理上传共享 Three.js 工作。当前不能把这部分独立归因成 Bloom 的主线程成本，也不建议仅凭它出现在 bundle 或栈里就延迟/关闭 Bloom。
- 最长任务窗口 top self frames 未出现 GLTFLoader/模型 parse。不能断言模型解析没有开销，只能说 profile 不支持其主导这段最长任务。
- 冷 Trace 的 6 个 GLB 均未命中缓存。热 Trace 中 4 个较小 GLB 命中（CDP encoded bytes 为 0），最大的 `small_cargo_ship`（约 24.55 MB）和 `crane_harbour2`（约 11.28 MB）仍各自通过网络传输。JS/CSS 命中缓存时，热启动仍有约 2.61 秒主线程 RunTask，证明资源 cache hit 不会消除这条 CPU 路径。热 Trace 对两个大 GLB 的 Resource Timing 请求区间约 245/140 ms；这是网络时间，不是解析 CPU，也未证明其网络等待造成该 RunTask。缓存未命中的具体原因尚未确认，不能臆测为 Chrome 因文件大小淘汰。
- Trace/Profile 记录到 GC 事件；最长任务窗口 GC sample 约十余个，远少于 Three.js 主路径。现证据不支持将 GC 列为主要解释。

### 第五十九批基线安全复跑

原始 `npm run test:performance:production-startup` 脚本单独复跑，冷 7/7、热 7/7 有效：本次 `networkidle` 中位数冷 3959 ms（3763–5582）、热 3929 ms（3780–4112）；Long Task 最大项冷约 2.33–3.19 秒、热约 2.30–2.73 秒。此前第五十九批原记中位数为 2477/2476 ms，两次结果不一致；保留两批原始 JSON，不覆盖历史值、不据此宣称变快或变慢。机器负载/运行波动没有控制；`networkidle` 不是 Runtime ready。复跑原始 JSON：`C:\Users\26057\AppData\Local\Temp\port-startup-59-8WgAx6\samples.json`。

### 优化候选顺序

1. 先对首轮渲染的材质首次使用、纹理上传、shader/material 初始化及每个 post-process pass 加同页外部时间段；确认 CPU 上传、shader 编译、GPU 排队分别占多少，再评估纹理格式/尺寸、上传组织或预热。
2. 单独度量 GroundSystem Canvas 纹理/法线图，评估保持视觉质量前提下的生成分辨率与调用时机。
3. 对已观察到的低模工作测其是否发生在首次有效 draw 之前、首个远距 LOD 的响应和时长，再考虑延迟/异步；当前不应视作最长任务主因。
4. 对 Bloom 做逐 pass 同页对照后再决定是否可选化；目前不建议直接延迟或关闭。
5. 动态导入或手动拆包针对下载/代码组织，不能直接消除当前已执行的纹理上传/渲染 CPU 工作；不作为本批长任务的直接修复。

本批未改生产逻辑、永久 Vite 配置、分包和依赖；未改 `server/` 或覆盖项目 `dist/`，未提交/推送。仍未验证 GPU 命令实际完成时刻、Runtime ready、模型解析独立阶段、公网压缩/缓存/CDN、真实 GPU 压力与其他浏览器。
