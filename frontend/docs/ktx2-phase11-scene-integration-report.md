# 第十一阶段：单岸桥真实港口场景 KTX2 集成报告

日期：2026-11-10。最终状态：**PARTIAL**。

真实 AMD 物理 GPU 上，两种模型均经项目 RuntimeAssetLoader 在实际 PortRuntime 场景中加载和渲染成功；KTX2 确认使用 BC7，五轮切换、测试资源释放和业务拾取通过。本轮足以支持继续讨论第二个模型的独立试点，**不构成批量迁移或正式替换批准**。纯 GPU 上传时间、实际显存、缓存命中性能、跨 GPU 和完整美术验收仍缺证据。

## 1. 环境与复现

| 项目 | 实际值 | 状态 |
|---|---|---|
| 系统 | Windows 10 x64；显卡驱动 24.20.13022.5005 | PASS |
| 浏览器 | 本机有界面 Microsoft Edge 156.0.4314.42，独立测试上下文 | PASS |
| Three.js | 实际 REVISION 185（0.185.0） | PASS |
| WebGL | WebGL 2.0 / Chromium | PASS |
| Unmasked Vendor | Google Inc. (AMD) | PASS |
| Unmasked Renderer | ANGLE (AMD, AMD Radeon (TM) R7 350 (0x00006610) Direct3D11 vs_5_0 ps_5_0, D3D11) | PASS |
| PHYSICAL_GPU_VALIDATION | PASS，未使用 SwiftShader | PASS |
| 页面视口 / 设备 DPR | 1440×900 / 1 | PASS |
| 场景 CSS / 实际 canvas | 1100×900 / 660×540；Renderer pixelRatio=0.6 | PASS |
| 相机 / 质量 | 项目相机 FOV 55、near 1、far 5000；相同 high 质量及 0.6 像素比 | PASS |
| 光照 / 环境 | 原 MainScene 太阳、环境光、Sky、雾；environment=null | PASS |
| 输出 | sRGB、ACESFilmic、曝光 0.65、原 RenderPass/Bloom/OutputPass | PASS |

入口：`http://localhost:5173/dev/ktx2-phase11/index.html?perfDiagnostics=1`。运行方法见 `dev/ktx2-phase11/README.md`。

开始时复用已有 Vite 5173 和后端 3003，不停止用户服务。Vite 当时仅监听 ::1，首个 127.0.0.1 请求被拒绝，改用 localhost 后成功。后期补拍时检测到两服务均已停止，使用现有 npm dev/start 命令重新启动；后端进程级 PORT=3003，不改配置或环境文件。默认后端 3002 的短暂启动已停止，最终在稳定 3003 下重拍。测试服务的启动不新增任务；Runtime 仍执行原有 `/api/containers/sync` 流程。

## 2. 接入方式及发布边界

实施前报告为 `docs/ktx2-phase11-project-audit.md`。真实链路：

`DEV 页面 → Pinia + new PortRuntime → MainScene 的 Renderer → 原 Runtime 初始化、业务资产池、ECS 与 RenderSystem → 测试 createRuntimeAssetLoader(同一个 Renderer) → AssetLoader.load → GLTFLoader → KHR_texture_basisu → KTX2Loader → Basis Worker → BC7 → Wheel 材质 → 原 EffectComposer`。

测试与正式 Runtime 各自拥有加载器；测试加载器在 Renderer 存在后经原工厂执行 detectSupport 和 setKTX2Loader，切换时始终复用一个测试加载器。没有访问正式私有 loader、复制 AssetManager 或修改正式加载方式。

每次测试 GLTF 独立加载，资源不进入正式 AssetManager。复用原 AssetNormalizer 的 targetSize=131.25、excludeNodes=['Cube']，与正式岸桥一致；原始结果的全部独占资源在归一化前记入集合，含被移除节点资源，卸载时不会漏掉。测试 Group 位于 `(420,0,80)`，Y 旋转 π，独立于三座正式岸桥；两版的缩放、包围盒、相机和材质参数相同。

测试资产放在 `dev/ktx2-phase11/assets/`，**不使用 public**。默认生产入口 main 和既有 ktx2Test 不引用本轮模块；独立临时生产构建已检查全部输出文件及 HTML/JS 内容，未发现 phase11 页面、脚本、PNG control 或 fallback GLB。本轮仅 DEV 接入，不以整目录静态复制为发布方式。

## 3. 资产完整性

| 资产 | 字节数 | SHA-256 |
|---|---:|---|
| 正式 `model/crane_harbour2.glb`（只读） | 11,280,344 | B6BA78E1ED75BD3F3246A82DD2B28DD9AC1F8642DA6E16EDB16012F442014FA6 |
| 测试 `assets/crane_harbour2_png_control.glb` | 19,057,428 | 9397E1CB78DF8BD2EB13A832AA67EB052960412ACFAC39F9A1C41718B8F7FCB7 |
| 测试 `assets/crane_harbour2_ktx2_fallback.glb` | 19,057,564 | 15F0C0A8A7F61571AEDB8E3C4392CA4A275F93DA50193B8DCE6ABA3458CB0E7A |

状态 PASS。源目录为 `%LOCALAPPDATA%/KTX-Tools/Tests/CraneHarbour2/`，分别来自 `validation/phase10/crane_harbour2_png_only_control.glb` 和 `converted/crane_harbour2_ktx2_fallback.glb`。复制时间 UTC 2026-11-10 00:41:56；复制前后 hash 一致。两者 GLB v2、文件总长、JSON 均检查通过，各有4 image/2 texture；KTX2 版 extensionsUsed 含 KHR_texture_basisu，extensionsRequired 为空，texture.source 保留 PNG fallback。

PNG-only control 仍带未引用的 KTX2 字节，因此不能把它的 19 MB 称为原始 PNG 模型体积。fallback 版比真正正式源文件大 7,777,220 字节，增加约 68.95%；本阶段没有网络体积收益证明。

## 4. 纹理及模型结果

| 属性 | PNG BaseColor | PNG Normal | KTX2 BaseColor | KTX2 Normal |
|---|---|---|---|---|
| 材质 / 网格 | Wheel / Object_5 | 同左 | 同左 | 同左 |
| width×height | 2048² | 2048² | 2048² | 2048² |
| isCompressedTexture | false | false | true | true |
| Three format | RGBAFormat | RGBAFormat | RGBA_BPTC_Format (36492) | RGBA_BPTC_Format (36492) |
| colorSpace | srgb | 空字符串 NoColorSpace | srgb | 空字符串 NoColorSpace |
| flipY / channel | false / 0 | false / 0 | false / 0 | false / 0 |
| generateMipmaps | true（原有默认） | true（原有默认） | false | false |
| 显式 mipmaps | 无；由原 PNG 路径生成 | 同左 | 12 级，2048→1 | 12 级，2048→1 |

两版原始加载结果均为9 Mesh、7唯一材质、14个 Three Object3D（含场景 root；glTF JSON 为13个 node），没有把 root 额外算成 glTF node。归一化只执行原项目的 Cube 排除。归一化后世界包围盒均为 min `(391.436107846,0,14.375)`、max `(448.563892154,58.726746884,145.625)`。

Wheel metalness=0.0618182010948658，roughness=0.8799999952316284，side=DoubleSide，normalScale=[1,-1] 在两版一致；该 normalScale 来自既有 GLTFLoader 无 TANGENT 的处理，未修改材质或反转纹理。KTX2 组每次两个 KTX 回调、零 PNG ImageBitmap 回调；PNG 组两个 PNG 回调、零 KTX 回调，未发现 fallback 覆盖 KTX。状态 PASS。

## 5. GPU 实际转码与上传

能力：BPTC/BC7=true、S3TC/DXT=true；ASTC、ETC1、ETC2、PVRTC=false。GLTFLoader 返回的两张纹理均为 RGBA_BPTC_Format。

测试仅包装该 Renderer 的 WebGL 调用并原样转发，记录 texStorage2D 和 compressedTexSubImage2D：

| 语义 | 实际内部格式 | 证据 |
|---|---|---|
| BaseColor | 36493 / 0x8E8D / COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT | 实际 sRGB BC7 分配及逐级压缩上传 |
| Normal | 36492 / 0x8E8C / COMPRESSED_RGBA_BPTC_UNORM_EXT | 实际线性 BC7 分配及逐级压缩上传 |

Basis JS/WASM 均从 `/basis/` 返回200。完整 mip 0..11 的尺寸和数据长度已记录；例如 level0=4,194,304 bytes，1=1,048,576 bytes，10/11 各16 bytes。每次 GL getError=0，真实场景帧已执行。状态 PASS，证据不是只依据 detectSupport 布尔值。

此结果只属于该 AMD/D3D11 环境，不能将第三阶段软件 ASTC 结果混入，也不能推广到移动端或其他 GPU。实际 GPU 显存为 NOT TESTED。

## 6. 视觉、UV 热点和截图

最终采用 `final-visual-results.json` 和 `screenshots/final-*.png`。PNG/KTX2 四组相机 position/quaternion/target 完全一致；光照、渲染尺寸、曝光、后处理和模型参数未切换。原始相机记录发现初版斜视角过小（测试向量被乘法修改），已修正测试代码并补拍45°斜视；原始五轮性能的 overall 相机不受该问题影响，旧记录保留，不能把旧 oblique 截图当45°证据。

热点 `(1214,1697)` 使用像素中心映射为 UV0 `(0.593017578125,0.828857421875)`；依据 glTF 顶部图像原点及 flipY=false，不将图像 Y 再翻转。逐三角形重心坐标检查发现17个覆盖实例；不是屏幕坐标猜测。

首个覆盖在 Object_5 三角形276，重心权重 `(0.342054145,0.563581544,0.094364311)`，世界点 `(394.763619215,5.949438012,86.886853922)`，插值几何法线约 `(-0.176830374,0.983643311,-0.034305336)`。近景距离5、45°斜视距离7.071、远景距离38；相机中心射线均先命中该 Object_5 点，交点 UV 与目标相同，距离误差约5.86e-14。斜视候选方向先检查遮挡，最终没有用被支架挡住的视角声称检查热点。

| 截图组（均在证据 screenshots/） | 检查结果 |
|---|---|
| final-png-overall / final-ktx2-overall | 模型整体结构、位置一致，未见新增缺失。原场景远景发白、Bloom和天空较强，限制细节判断 |
| final-png-near / final-ktx2-near | 可见轮胎花纹与明暗交界；本条件下未见明显额外色偏、法线翻转或贴图缺失 |
| final-png-oblique / final-ktx2-oblique | 实际45°轮胎、轮毂与表面细节对照，未见明显新增压缩块或方向异常；暗部仍限制细微差别识别 |
| final-png-distance / final-ktx2-distance | 远距表现相近，不能仅凭此认定近景质量合格 |

并排图为 `comparison-overall.png`、`comparison-near.png`、`comparison-oblique.png`、`comparison-distance.png`。脚本仅无缩放并排加标签，未美化像素。最终截图显示 RGB 平均绝对差分别0.0569、0.0472、0.1494、0.00606（0..255）；这只是屏幕差异描述，包含动画背景、过滤和显示量化，不是纹理指标或验收阈值。

视觉结论 PARTIAL：已实际检查可见热点及两距离/斜角，但原 Normal 最大44.436°的离线角度误差不会因截图相近而消失。本轮没有控制 GPU 的具体 LOD 采样，也没有证明最大误差单个 texel 在 level0 被独立采样；多级过滤可能掩盖差异。完整光照、所有17个覆盖区域和美术人工验收尚未完成，未擅自设定质量阈值。

## 7. 性能原始记录与口径

首个 PNG / KTX2 加载分别696.2 / 695.2 ms；首 KTX 包含 Worker/WASM 初始化，单列为 warmup，不混入均值。随后在同一 overall 相机、同一活跃港口场景下交替五轮；每例再预热1秒，记录2秒连续帧。无并行生产构建干扰采样。业务 AGV、水面和遥测继续运行，场景不是冻结的静态基准。

| 轮次 | PNG load ms | KTX2 load ms | PNG Frame ms / FPS | KTX2 Frame ms / FPS |
|---|---:|---:|---:|---:|
| 1 | 373.7 | 577.4 | 16.725 / 59.79 | 16.792 / 59.55 |
| 2 | 435.1 | 575.7 | 17.314 / 57.76 | 16.848 / 59.36 |
| 3 | 435.3 | 554.6 | 16.742 / 59.73 | 16.661 / 60.02 |
| 4 | 964.4 | 596.1 | 17.005 / 58.81 | 16.286 / 61.40 |
| 5 | 399.7 | 548.9 | 16.398 / 60.98 | 16.708 / 59.85 |
| 均值 | 521.64 | 570.54 | 16.837 / 59.41 | 16.659 / 60.04 |

| 指标 | PNG | KTX2 | 限制 |
|---|---|---|---|
| 对照 GLB bytes | 19,057,428 | 19,057,564 | 两个对照均含两套 payload，真正原模型为11,280,344 |
| 网络 Resource Timing 平均 duration | 153.06 ms | 147.24 ms | 本机HTTP200，含下载与调度，不是公网收益 |
| 两张图片/纹理回调耗时 | 每张131.4..231.1 ms | 每张297.2..327.8 ms | 观察到的回调区间，含解码/任务调度；并发不可相加，非纯算法耗时 |
| 纹理 GPU 上传纯耗时 | NOT TESTED | NOT TESTED | 记录调用格式，没有隔离 GPU timer |
| 首次可见准确时间 | NOT TESTED | NOT TESTED | 仅保存 load 到两次提交帧的代理值：均604.88/615.46 ms；不等同实际显示完成 |
| Renderer calls 示例 | 967..971 | 967..971 | PerformanceSystem 关闭 autoReset，beginFrame reset；为整场景含阴影/后处理的计数 |
| Renderer triangles 示例 | 3,590,725..3,592,963 | 同数量级 | 实际值见逐帧 JSON，受动态场景影响 |
| GPU 格式 | 普通 RGBA+sRGB/Linear | sRGB BC7 / Linear BC7 | 纹理大小不等于实际显存 |
| 可观测 GPU 显存 | NOT TESTED | NOT TESTED | 未将估算当实测 |
| 缓存命中加载性能 | NOT TESTED | NOT TESTED | 测试直接走 AssetLoader，无应用模型缓存；Resource Timing 均为200且完整 transferSize，无可靠命中样本 |

原始 JSON 的性能字段名 `lastPassCalls/lastPassTriangles` 保留可追溯；经复核 PerformanceSystem 的 autoReset=false，它们实际是当前帧累计计数，不能解释为只有 OutputPass。完整 Resource Timing、每帧数据在 browser-results.json；提炼数据在 summary.json。load 是完整 GLTF Promise 耗时，不能将其全部归于纹理转码。小幅整场景 FPS 差异不能归因为两张纹理，当前不宣称性能提升。

## 8. 所有权、重复加载和销毁

PASS：完整测试执行13次加载与13次卸载（含预热及额外 PNG 切换），五轮正式 PNG/KTX2 对照共10次；每次重新解析的独立资源都经 Set 去重释放。最终测试计数117 geometry、91 material、26 texture dispose，测试 root=0，正式 dispose 监听事件=0。

两张 KTX 预热后测试 Worker=2，之后五轮不增长；测试加载器始终一个。闭合串行任务链先排空，closing 阻止新请求、迟到结果释放后不加入场景；dispose 不假装取消网络或转码。完整关闭的重复调用返回同一个 Promise。

最终补拍会话另外实测2次加载/卸载、18 geometry / 14 material / 4 texture 释放，测试 decoder dispose=1，Worker 数从2降为0，正式 Runtime.destroy 完成。生产 Runtime 生命周期延迟失败测试仍通过。

卸载后的 textures 始终30；geometry 五轮约690..691且没有随测试轮次累加。启动初值651随后受正式场景惰性资源/空间状态变化升至约690，**不能声称所有计数严格回到启动初值或已经证明长期无泄漏**。正式模型池全程6 resident、13 references、0 pending、0 disposed，与初始相同。更长时间、驱动内存和失败解码器部分分配回收仍不在本轮证明范围。

## 9. 回归和自动化验证

| 项目 | 结果 |
|---|---|
| 正式首页 / Runtime 初始化 | PASS，独立正常首页 runtime-ready，26实体；截图 formal-home.png |
| 正式模型 URL | PASS，仍请求 `/model/crane_harbour2.glb`，未请求本轮测试资产 |
| 其他业务模型 | PASS，jzx1/2/3、small_cargo_ship、cc 与正式岸桥请求200；池6 resident |
| AGV 运行 | PASS，5辆、位置持续变化、速度及运行状态更新；不等于完整运输/吊装任务验收 |
| Raycaster | PASS，独立页真实 canvas 鼠标点击选中 AGV_01，不直接调用 SelectionSystem 伪造点击 |
| 设备信息 | PASS（正式首页补验），正常设备列表选中 AGV-01 后档案 AGV 01 / agv、ECS AGV_01 正确显示；截图 formal-home-device.png |
| 遥测 | PASS，主测试收到550条 agv.telemetry，另首页补验55条；独立于 Vite HMR WebSocket |
| ECS 顺序 | PASS，五轮前后18个任务名称和 priority 完全一致；只添加帧观察监听，不重排任务 |
| 正式共享资源 | PASS，0测试期间正式 dispose 事件，资源池引用未改变 |
| type-check | PASS，项目 vue-tsc --noEmit；最后相机修正后独立测试 tsconfig 再检查通过 |
| AssetManager / attach smoke | PASS，缓存、克隆、acquire/release、attach 与清理检查 |
| asset-load-drain smoke | PASS，含真实 PortRuntime start/destroy、延迟预加载、动态加载、异常和幂等测试 |
| 生产构建 | PASS，现有 Vite 命令加临时 outDir；退出0，5.18秒；未覆盖既有 dist |
| 发布排除 | PASS，临时构建中本轮测试资产/入口均不存在；既有 ktx2Test 页面本来就在 build input，不在本轮改动范围 |
| git diff --check | PASS，未提交或推送 |

独立页仅挂 DeviceInfoPanel，没有正式 DeviceListPanel 的档案获取流程，故首次点击显示“档案未匹配”；已用正常首页实测档案映射，未为此改正式业务代码。

控制台：两测试页和正常首页均无未捕获 pageerror；GLB/Basis无404或解码错误，WebGL错误0。但都记录到一条未定位 URL 的“Failed to load resource ... 404”控制台消息，response 捕获没有对应 HTTP>=400；不能声称控制台绝对零错误或擅自认定是 favicon。另有共同的 Canvas2D readback 建议和 PCFSoftShadowMap 弃用警告。本轮未扩展处理这些问题。生产构建原有大 chunk 警告和临时 outDir 提示照实保留，不调整分包或阈值。

## 10. 文件、证据与保护

新增文件，未修改正式源代码：

- `docs/ktx2-phase11-project-audit.md`：实施前审计。
- `docs/ktx2-phase11-scene-integration-report.md`：本报告。
- `dev/ktx2-phase11/index.html`、`scene-test.ts`：DEV独立真实场景入口、操作及资源诊断。
- `dev/ktx2-phase11/tsconfig.json`：单独纳入测试 TS，不修改正式 tsconfig。
- `dev/ktx2-phase11/assets/` 下两个 GLB：仅复制的 PNG control / KTX2 fallback。
- `prepare.mjs`：保护基线、复制与 hash 核验。
- `run-browser.mjs`：五轮集成、采样及鼠标拾取。
- `capture-views.mjs`：最终相机及显式清理验收。
- `run-home-regression.mjs`：正常首页档案回归。
- `verify.mjs`：类型/smoke/临时构建/排除/保护检查。
- `summarize.py`：结果统计和原像素并排。
- `README.md`：复现方法和发布边界。

以上脚本均位于 `dev/ktx2-phase11/`，不是业务运行时依赖。

全部机器证据位于：

`C:/Users/26057/AppData/Local/KTX-Tools/Tests/CraneHarbour2/validation/phase11/`

关键文件：asset-manifest.json、browser-results.json、final-visual-results.json、home-regression.json、summary.json、checks-and-build-results.json、verification-results.json、production-exclusion.json、protected-before.json、protection-after.json、git-status-before/after.txt、各项 .log、screenshots/。失败尝试（IPv4拒绝、测试AGV大小写、服务停止、补拍端口调整）分别保留 attempt-*.json，未混入通过计数。构建排除脚本初次误把临时输出目录名 phase11 也当成资源名，修正为相对产物路径后重新检查同一产物，确认为空；没有因此改生产配置。

临时生产构建：`C:/Users/26057/AppData/Local/Temp/port-ktx2-phase11-build-ubDjLk/`。

既有 Git 大量修改保留。195个受保护文件 hash 对比无变化，覆盖正式 src/model/public、backend/server、原 dist 和 frontend/dist、依赖清单/锁文件及 Vite/TS 配置。正式原始 GLB hash 与阶段十相同。未修改或清理后端、正式资源、依赖、系统 PATH，未提交、未推送。

最后复核增加了测试帧序号，避免诊断历史达到10,000条上限后“等待两帧”被数组长度卡住；修正后独立测试类型检查及最终加载/截图/幂等清理再次通过。补拍会话退出后，已停止本轮自行启动的 Vite 和后端验证服务；未停止其他用户进程。

## 11. 最终判断与下一步

**PARTIAL**：加载、物理 AMD BC7 上传、纹理语义、热点可见性、短期资源生命周期及关键交互回归已验证；完整性能和质量证据不足，且共享控制台404尚未定位。

| 决策 | 建议 |
|---|---|
| 扩大到第二个模型 | 可以在人工审核本轮近景/斜视截图后，继续一个独立、保留原件的第二模型试点；本轮停止，不自动执行 |
| 正式模型迁移评估 | 可进入方案评估，但不批准正式URL替换或批量迁移；先确定美术可接受性及目标GPU覆盖 |
| PNG fallback | 继续保留；本轮仅证明支持KTX时正确选用，不证明所有消费者都支持 |
| 必须先补充的证据 | Normal热点在更多光照/LOD下的人工确认，其他目标GPU及不支持扩展消费者；有性能收益要求时再补真实缓存、GPU计时/显存，不能用当前FPS差异代替 |

本轮未转换其他模型、未创建无 fallback 版本、未正式替换任何资产。
