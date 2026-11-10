# AGV 地面雷达交付报告

日期：2026-11-10。实现前已单独输出并保存 [接入审计](./agv-radar-audit.md)。以下行号指本轮完成后的源码；审计文件保留修改前位置。

## 1. 原有 AGV 位置更新链路

实际设备资源为 `src/config/PortSceneConfig.ts:39,93` 的 **cc.glb**，targetSize=10。`AssetManager.preload:54` → `AssetNormalizer.normalize:9` 缩放内部 GLB、XZ 居中、底部对齐 0，外层 asset-agv 保存修正；`AssetManager.clone:65` 返回标准化根节点的 clone(true)。不是 GLTFFactory 的另一条旧入口。

`PortRuntime._createStaticWorld:1002` → `PortEquipmentBuilder.createAGVs:34` → `AGVFactory.create:34` 创建五台设备。层级为场景 → wrapper → asset-agv → GLB 根及子 Mesh；cargoSlot 是 wrapper 下的另一个子节点。工厂现有 modelBox 是尚未加入场景、wrapper 无变换时的底部中心，适合记录 wrapper-local 锚点。本次实际模型锚点约 `[1.79e-14,0,-4.44e-16]`，归一化后数值上等于原点，但实现不依赖该假设。

`MotionSystem.update:97` → `_updateAGVs:134` → 遥测分支 `_updateTelemetryTransform:145`，或本地 command/free cruise 分支 → `_applyLaneTransform:230`。最终均直接写 `Transform.wrapper.position/lookAt`；Transform 不另存一个等待渲染同步的位置字段。任务通过 TaskSystem → PathManager.createYardRoute → AGVSystem.dispatch → MotionSystem.moveAGV 驱动；PathManager 只生成路线。

`PortRuntime._startTelemetry:1087` 已选择 websocket。`TelemetryGateway:20` 创建 WebSocket、JSON 解析、sequence 去重，agvId 映射 assetId，使用 payload.entityId 定位实体。`TelemetrySystem._applyTelemetry:60` 写 MotionComponent.telemetryDriven/telemetryTarget/speed；100ms、priority=4 的遥测任务不直接改 wrapper。priority=1 的 motion 下一帧才使用新目标并沿现有道路插值。未收到遥测时运行本地巡航/任务；既有断线策略不会自动清除 telemetryDriven。本轮不改变此行为。

两个 RenderSystem 的实际职责：`systems/render/RenderSystem` 派发 LOD，不做 ECS 位置同步；`rendering/RenderSystem.start:29` 执行 FrameObserver.update → beforeRender → composer.render → afterRender。ObjectRenderAdapter 只切换 wrapper 内 detail/proxy。雷达位于 beforeRender，所有任务完成后读取最终世界矩阵，无独立位置仿真。

## 2. 新增和修改的文件清单

新增：

- `src/ecs/components/AgvRadarComponent.ts`：纯扫描配置。
- `src/rendering/AgvRadarEffectSystem.ts`：每实体视觉状态、坐标同步、相位积分、资源管理。
- `src/rendering/shaders/agvRadar.ts`：完整 GLSL 顶点和片元源码。
- `tests/browser/agv-radar.smoke.mjs`：真实 Runtime、实际 GLB、真实 WebGL 的回归与像素采样。
- `docs/agv-radar-audit.md`、本报告；`tests/browser/results/agv-radar/` 保存原始采样 JSON 与截图。

修改：

- `src/ecs/components/ComponentTypes.ts:31`：AGV_RADAR 注册名。
- `src/ecs/Entity.ts:33,48`：类型联合增加雷达组件。
- `src/ecs/components/TransformComponent.ts:27`：groundAnchor，wrapper 局部坐标的模型底部中心。
- `src/factories/AGVFactory.ts:39,46`：复用现有一次性 modelBox 填写锚点、注册默认禁用的组件。
- `src/app/PortRuntime.ts:411,755,877`：系统创建、beforeRender 注册、业务配置接口、DEV 事件与销毁。

没有改依赖与配置。仓库原来已有大量其他改动，以上只列本轮触及内容。

## 3. 组件、System 的职责和接口

AgvRadarComponent 只有 enabled（默认 false）、radius（默认 18 世界单位，项目按米建模）、angularSpeed（默认 1.4 rad/s，支持负方向与 0）。不持有 Mesh、材质、Geometry、Uniform 或扫描累计值。

`PortRuntime.configureAgvRadar(entityId, options): boolean` 是业务接口；校验实体 AGV 身份、有限正半径、有限角速度及布尔开关，仅写状态，必要时补组件。目前没有扫描业务协议或安全传感器规则，所以**默认不开启，也不把行驶/停车当成扫描启停规则**。未来遥测业务层可以调用相同接口，不应让效果系统自己连 WebSocket。

`AgvRadarEffectSystem.beforeRender:34` 从雷达组件 store 迭代，避免扫描全部港口实体。每实体独立 Mesh、ShaderMaterial、Uniform、scanPhase；所有 Mesh 共用一个单位 PlaneGeometry。首次启用才创建材质和 Mesh；关闭只隐藏，scanPhase 暂停，重新启用无追赶和资源重建。半径或角速度修改不会重建材质。每帧只更新必要变换和 Uniform；临时向量复用。诊断 API `getDiagnosticSnapshot:68` 提供创建/释放/live/位置/相位/材质标识，是按需采样，不在正式帧中分配快照。

## 4. Shader 顶点与片元计算原理

`shaders/agvRadar.ts:2` 顶点 Shader 传 vUv，通过 projectionMatrix * modelViewMatrix * position 输出裁剪空间位置。平移与半径由 Mesh Transform 表达，不在顶点中另造车辆位置。

片元 `:16` 把 UV 映射到 [-1,1]，先计算 r 并 discard 圆外片元，再进行角度与颜色计算。fwidth/smoothstep 柔化圆边界和同心环。`mod(direction*(phase-angle)+TAU,TAU)` 得到头部后方的周期距离；1.65 rad 拖尾平方衰减、头部边缘 smoothstep；另用 atan(sin(delta),cos(delta)) 生成平滑扫描头。拖尾在头部衔接处也做 smoothstep，避免在 mod 边界产生亮度硬缝。四道同心环及外圈低透明度，低于主要扫描扇形。

Uniform：uScanPhase 为实体独立的累计相位；uDirection 使负角速度时拖尾跟随反向扫描，速度为 0 保留最后方向；uColor 由 THREE.Color 提供线性颜色。输出 gl_FragColor 后使用 Three 的 tonemapping_fragment/colorspace_fragment，与 RenderPass/OutputPass 的目标色彩管理兼容。默认 ShaderMaterial GLSL ES 1.00 接口（varying、gl_FragColor），不混入 GLSL3 专用 in/out。

材质使用 NormalBlending、transparent=true、depthTest=true、depthWrite=false；平面 rotation.x=-PI/2，XY 转 XZ、法线 +Y。世界 Y 偏移 .12 并开启 polygonOffset；共享单位平面用 scale=(2r,2r,1) 表达半径。装饰 Mesh 禁用 raycast，避免遮住设备拾取。

## 5. ECS Transform 到 Shader Uniform 的完整数据链路

位置链：现有 WebSocket/本地任务巡航 → MotionComponent → MotionSystem → Transform.wrapper → updateWorldMatrix → groundAnchor * matrixWorld → 独立雷达 Mesh.position（世界 Y + .12）。父级旋转/缩放纳入锚点计算；独立场景组抵消 scene 自身变换，雷达不继承车身俯仰或缩放，保持水平。不每帧计算模型包围盒。未来替换为不同底部结构的模型时，需要由模型装配方更新 groundAnchor；当前默认标准化资产已经提供一致的地面原点。

状态链：业务 configureAgvRadar/DEV 事件 → AgvRadarComponent → System → Mesh.visible/scale；`scanPhase = mod(scanPhase + angularSpeed * deltaTime,2PI)` → 独立 uScanPhase/uDirection → ShaderMaterial 的 renderer uniform 上传 → 片元颜色/透明度。相位与运动速度完全分离。沿用 Clock 已钳制的 deltaTime（最大 .1s），后台挂起后不跳跃追赶。

`PortRuntime:412` 注册 beforeRender listener priority=5；全部 task（包括 motion、telemetry、LOD）先运行，之后才运行该 listener，再 composer.render。没有将业务判断写入 RenderSystem。

## 6. Runtime 生命周期和资源释放方案

沿用真实 `_start`：内联创建系统 → _registerCoreSystems → _createStaticWorld → _createTaskSystems → _createSpatialOptimization → _startTelemetry → renderSystem.start。不存在另外新增的 createSystems/createInitialEntities/startSystems 假入口。

System 构造时创建共享 Geometry/独立效果组并订阅 EntityManager.onBeforeRemove。实体删除立即移除对应雷达并释放其独立材质；仅移除雷达/Transform/AGV 组件，在下一次 beforeRender reconcile 清理。关闭组件状态只隐藏，不释放。动态创建或新增组件在下一帧被发现。

Runtime 销毁先停止渲染、移除 DEV 监听，再 system.dispose：退订实体删除、移除全部雷达 Mesh、释放其材质、移除组、释放共享 Geometry；之后原有报警、适配器、资产池按原顺序清理。dispose 幂等。System 不释放任何设备原材质、贴图或模型 Geometry。

## 7. 开发环境雷达启停操作

在 frontend 目录运行 `npm run dev -- --host 127.0.0.1`，打开 Vite 输出的应用地址，等港口加载。浏览器控制台执行：

```js
window.dispatchEvent(new CustomEvent('runtime-test-agv-radar', {
  detail: { entityId: 'AGV_01', enabled: true, radius: 20, angularSpeed: 1.5 }
}));
window.dispatchEvent(new CustomEvent('runtime-test-agv-radar', {
  detail: { entityId: 'AGV_02', enabled: true, radius: 14, angularSpeed: 0.7 }
}));
// 不传的字段保留；停车也继续扫描。角速度可置 0 暂停旋转或置负反向。
window.dispatchEvent(new CustomEvent('runtime-test-agv-radar', {
  detail: { entityId: 'AGV_01', angularSpeed: 2.5 }
}));
window.dispatchEvent(new CustomEvent('runtime-test-agv-radar', {
  detail: { entityId: 'AGV_01', enabled: false }
}));
```

再次传 enabled:true 从暂停相位继续。该事件仅 DEV 注册；正式业务持有 Runtime 时调用 configureAgvRadar。没有在 App.vue 管理任何效果资源。

复现完整自动化：保持 Vite 在 5173，另开终端 `node tests/browser/agv-radar.smoke.mjs`。使用项目已有 @playwright/test 和本机 Edge，测试页面由路由提供临时宿主，不额外创建仿真路线或替换正式渲染链。测试本身需要 5173；若开发端口被占用，先处理既有服务或修改测试 URL。

## 8. 类型检查和构建结果

- `npm run type-check`：实际执行成功，退出码 0。
- `npm run build`：实际执行成功，退出码 0，163 modules transformed；存在原有的大于 500kB chunk 提示，不影响构建。
- `git diff --check`：本轮修改的已有文件检查通过。

## 9. 浏览器实际测试结果及未验证事项

环境：Windows、本机 Edge headless、Three r185 / WebGLRenderer、1100×760、pixelRatio=1、真实 PortRuntime 和 cc.glb；ACES exposure=.65，项目原有 Bloom（strength .55/radius .7/threshold .45）。真实创建五台 AGV，对 AGV_01/02 开启雷达。初段使用正式 RAF/FrameObserver 运行约 1.2s，测试主动停止外部遥测以固定条件，观测两台扫描相位都推进。随后取消 RAF（不调用会释放 composer 的 stop），以实际 MotionSystem 和 composer 受控绘制。

| 验收项 | 结果与证据层级 |
| --- | --- |
| 静态职责、XZ 平面、独立效果组、场景单位、色彩管理 | 静态代码检查通过 |
| 类型检查、生产构建 | 构建检查通过（真实命令退出码 0） |
| 默认零扫描 | 浏览器通过：创建材质/Mesh 0，共享 Geometry 存在但不产生雷达 draw |
| 真实车道直线与转弯跟随 | 浏览器通过：沿真实车道 100 个位置采样，MotionSystem 写 wrapper 后锚点误差 0；朝向范围 PI |
| 遥测目标跟随 | 浏览器通过：injectForDevelopment 进入现有待处理队列 → TelemetrySystem → MotionSystem，验证最终锚点；本轮未建立后端实时 WebSocket 端到端数据验证 |
| 停车扫描、两台不同半径/角速度、独立关闭 | 浏览器通过：位置不动相位推进；20/14 半径、1.5/.7 rad/s；关闭一台不影响另一台 |
| 变速、关闭再开启 | 浏览器通过：变速 delta=0 时角度不跳；2.5rad/s×.1s=.25rad；禁用暂停，重新启用材质引用不变、创建计数不增 |
| 共享 Geometry、独立材质和 Uniform | 浏览器引用检查通过 |
| 模型缩放/父级平移旋转缩放 | 浏览器通过：wrapper scale=(2,1.5,.75)，父级 scale=1.3 并带旋转位移；世界半径仍 20，法线仍 +Y，世界锚点误差 <1e-6 |
| GPU 连续扫描 | 浏览器像素通过：65 个真实 RAF 提交的受控帧，dt 固定 .08s、2.5rad/s，共 13rad，覆盖超过两圈；固定可见像素 18 种 RGB，0/PI 两相位最大 RGB 差总和 134。实际 wall time 记录在 JSON，不能把固定 dt 当成实时性能/帧率基准 |
| 0/2PI 边界 | 浏览器像素通过：2PI-.00001 和 .00001 两相位的整帧最大通道差 1 |
| 地面无静态闪烁 | 浏览器像素通过：固定相位连续 8 次 draw，整帧最大通道差 0；未进行多硬件长时间动态抗闪烁评估 |
| AGV 遮挡 | 浏览器像素通过：射线选取不透明模型内部像素，排除玻璃和轮廓抗锯齿边缘；100 个像素开关雷达的最大通道差 0。玻璃仍按原有透明排序处理 |
| 动态新增实体、组件移除/添加、实体删除 | 浏览器通过：AGV_TEST 工厂创建/删除，组件下一帧清理/重建，实体删除即时无遗留 Mesh |
| 销毁与重新进入 | 浏览器通过：首轮 created=4/released=4/live=0；第二轮 1/1/0；Geometry disposed、效果组已脱离场景 |
| 两片扫描区域重叠、Bloom 开关 | 真实港口截图已生成并检查：近景环和扫描扇形可见，重叠柔和，设备外形清楚，雷达本身无明显过曝；道路发光是既有场景效果 |
| 巡检距离可辨识度 | 已实测并截图，受场景原有浓雾、设备占屏尺寸影响明显；轮廓仍可见但扇形/拖尾偏弱，不能宣称所有距离下都清晰，通过业务视角复核或后续专门做距离适配 |

像素证据是实际 framebuffer.readPixels，不是只比较 JS 数值。最大变化像素在两张固定相位图之间选择后固定位置；不据此宣称 CPU/GPU 耗时改进。边缘遮挡测试首次纳入玻璃和轮廓混合像素，不能代表不透明遮挡；最终按不透明面内部采样排除该测量误差，不通过改 depthTest 来掩盖问题。

原始数据：`tests/browser/results/agv-radar/results.json`，24 项自动断言全通过，pageerror/Shader/FrameObserver 错误列表为空。截图：`overlap-bloom-false.png`、`overlap-bloom-true.png`、`inspection.png`。

未验证：真实业务扫描启停遥测协议（目前不存在）、后端 WebSocket 持续推送下的完整端到端场景、真机集成 GPU/移动设备、多雷达大规模负载、透明车窗等复杂透明排序、长时间运行的显存曲线。已验证场景为真实项目资产及渲染链，不是实际港口传感器测量或生产部署。

## 10. 本次没有修改的既有系统和架构边界

没有修改水面 Shader、AlarmVisualSystem/AlarmMaterialVariants、选中高亮、GpuResourcePool、InstanceBatch、RenderSystem、MotionSystem、PathManager、TelemetryGateway/TelemetrySystem 或 App.vue。仅在 Runtime 装配雷达并提供状态入口，在 AGV 工厂记录地面锚点和注册纯状态组件。

这是展示 AGV 扫描状态的视觉效果，不包含障碍检测、碰撞查询或传感器覆盖测算；没有凭空添加扫描业务规则或第二套车辆位置模拟。无需建立通用实体特效框架，Shader 保持在 rendering/shaders 下供当前专用系统使用。
