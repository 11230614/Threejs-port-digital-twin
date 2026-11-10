# AGV 地面雷达：接入前审计（2026-11-10）

以下位置在修改前核对，后续新增代码会使行号后移。

- `src/config/PortSceneConfig.ts:39,93`：实际 AGV 资源是 `cc.glb`，targetSize=10，不是按文件名猜测的 AGV.glb。
- `src/assets/AssetManager.ts:54,65` → `AssetNormalizer.normalize:9`：标准化模型克隆；内部 GLB root 缩放、XZ 居中、minY 对齐 0；外层 asset-agv 保留归一化修正。`GLTFFactory.produce` 不是这里的实际设备标准化入口。
- `PortRuntime._createStaticWorld:988` → `PortEquipmentBuilder.createAGVs:34` → `AGVFactory.create:33`：创建五台 AGV，wrapper → asset-agv → GLB 内部层级；cargoSlot 为 wrapper 的另一个子节点。TransformComponent 持有 wrapper，不另存 ECS position。工厂此时已有 modelBox，适合一次记录底部中心局部锚点。
- `PortRuntime._registerCoreSystems:869` 注册 motion priority=1，每帧执行。`MotionSystem._updateAGVs:134`：telemetryDriven 分支优先；其余走任务 command 或本地巡航。`_updateTelemetryTransform:145` 沿车道插值，`_applyLaneTransform:230` 写 wrapper.position/lookAt。`TaskSystem:361,404,463,571` 通过 PathManager.createYardRoute 获取路线并交给 AGVSystem/MotionSystem；PathManager 自身不渲染或直接驱动车辆。
- 正式 `PortRuntime._startTelemetry:1056` 选择 websocket；`TelemetryGateway:20` 实际创建 WebSocket，JSON 解码、sequence 去重、agvId→assetId、entityId 映射；`TelemetrySystem._applyTelemetry:60` 写 telemetryDriven/target/speed，不直接写 wrapper。telemetry 任务 priority=4、100ms，所以新目标在下帧 motion 使用；未收到遥测时继续本地运动，连接断开后没有自动清除 telemetryDriven 的既有策略。不能依据旧注释断言没有 WebSocket。
- `systems/render/RenderSystem` 只派发 LOD，ObjectRenderAdapter 只替换 wrapper 内的 detail/proxy；没有额外 ECS→wrapper 的位置同步。
- `rendering/RenderSystem.start:29`：FrameObserver.update（全部任务）→ beforeRender listeners → composer.render（RenderPass、Bloom、OutputPass）→ afterRender。雷达应为 beforeRender listener；读取最终 wrapper 世界矩阵，不改运动或遥测。
- `PortRuntime._start:300` 实际是内联创建系统 → _registerCoreSystems → _createStaticWorld → _createTaskSystems → _createSpatialOptimization → _startTelemetry → renderSystem.start，并不存在 createSystems/createInitialEntities/startSystems 方法，沿用现有入口。
- `EntityManager.remove:62` 先 onBeforeRemove，再实体资源释放、删除组件；`removeComponent:58` 直接删组件，效果系统需下一帧 reconcile。`PortRuntime` 先停止渲染再释放效果/适配器/资源池。
- Three.js 锁定/安装 r185，WebGLRenderer；MainScene 默认 ACES exposure=.65，EffectComposer Bloom strength=.55 radius=.7 threshold=.45。使用 ShaderMaterial 默认 GLSL ES 1.00 写法及 Three.js 输出色彩 chunks。

实现计划：状态组件默认禁用，无现有扫描启停业务协议，提供 DEV 事件开关；共享单位平面，每实体独立 ShaderMaterial/uniform，独立场景效果组，deltaTime 积分相位，禁用时暂停。沿用工厂已计算的包围盒记录锚点，不每帧计算包围盒。
