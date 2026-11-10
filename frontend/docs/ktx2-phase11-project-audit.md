# KTX2 第十一阶段：实施前项目审计

审计日期：2026-11-10。状态：PASS（隔离方案可实施，不代表渲染验收通过）。

## 实际加载链路

- `src/app/PortRuntime.ts` 的启动流程先创建 `MainScene`，随后调用 `createRuntimeAssetLoader(mainScene.renderer)`。
- `src/scene/MainScene.ts` 创建实际 WebGLRenderer、天空、雾、太阳和相机。`src/rendering/RenderSystem.ts` 使用同一 Renderer，配置 OrbitControls、Bloom 和 OutputPass。
- `src/loaders/RuntimeAssetLoader.ts` 每个加载体系创建一个 KTX2Loader，设置 `${import.meta.env.BASE_URL}basis/` 后同步 `detectSupport(renderer)`，再通过 `GLTFLoader.setKTX2Loader()` 注入。
- 实际 AssetLoader 路径为 `src/assets/AssetLoader.ts`，不是 `src/loaders/AssetLoader.ts`。它包装 GLTFLoader.load；正式模型经 `AssetManager` 预加载、缓存、克隆，建造器和渲染适配器使用共享资源池。
- `src/config/PortSceneConfig.ts` 保持导入 `../../model/crane_harbour2.glb?url`；`PortEquipmentBuilder` / `QuayCraneFactory` 创建业务岸桥。本阶段不修改 URL、实体、材质或正式池。
- Runtime 销毁先关闭模型 AssetManager 入口、等待在途加载和启动流程，清理模型后再 dispose 共享 KTX2Loader。
- `GLTFFactory` 有独立 GLTFLoader，但未检索到实际业务调用；既有 `src/ktx2-test.ts` 也是独立页面，不能用其结果代替真实港口场景。

## 独立测试方案与所有权

新增 `dev/ktx2-phase11/index.html`，仅在 Vite DEV 执行；实例化真实 PortRuntime 和 Pinia，使用其公开 mainScene/renderSystem。测试模型作为独立 Group 加入同一 Scene，不登记业务实体、不替换正式岸桥。

测试专属加载器通过现有 `createRuntimeAssetLoader(实际场景 renderer)` 创建，所有切换复用该实例。它与正式 Runtime 的私有加载器属于不同所有者，避免读取私有成员或误释放正式 AssetManager 池。每次 GLTFLoader.load 产生独立对象；只释放该结果独占的几何体、材质和纹理，使用 Set 去重，ImageBitmap 最后关闭。测试关闭先排空串行任务，再释放测试 decoder，最后 await 正式 Runtime.destroy()。

相机操作只用于独立页面，使用原 Renderer、灯光、曝光、色调映射和后处理，不修改正式质量配置。DEV 页面提供 PNG/KTX2/卸载、相机、状态、GPU、材质诊断和显式完整清理。

## 生产发布边界

当前 Vite build 仅指定 `index.html` 和既有 `src/ktx2-test.html`。public 会无条件复制，故**不使用 public/test-assets**。本次 GLB 放在 `dev/ktx2-phase11/assets/`，只由 DEV 页面引用，默认生产入口不引用它们。通过独立临时 outDir 生产构建进一步核验排除，保留现有 dist。新增测试单独 type-check，不扩大正式 tsconfig。

## 验证计划和当前限制

先记录既有 Git 状态及受保护文件散列，再复制第十阶段已验证的两个 GLB，比较源/目标 SHA-256 和 GLB 结构。PNG-only 对照仍携带未引用的 KTX2 字节，不能把其体积当原始 PNG GLB。

通过实际 Edge 尝试物理 GPU，记录 unmasked renderer、扩展及实际 WebGL 上传调用；软件渲染明确 BLOCKED。Wheel 热点先以 UV0 三角形覆盖和重心坐标定位，再判断可见性。统一相机进行整体、近景、斜视、远景对照，至少五轮新加载与卸载，预热后每格式五次采样；不将整场景 FPS、调用计数当成两张纹理的性能收益，不虚构异步 GPU 时间或显存。

正式首页、运行时实体、拾取、设备面板、遥测、帧任务顺序需另存证据。尚未执行的物理 GPU、视觉、性能和浏览器回归均为 NOT TESTED；最终以集成报告为准。发现需要修改正式代码时停止并报告。
