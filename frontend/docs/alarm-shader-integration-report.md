# 普通 Mesh 报警 Shader 接入与验收

## 实现

- `AlarmMaterialVariants.ts` 由 `AlarmVisualSystem` 持有，按原材质对象和等级缓存、按材质槽计数。最后一个绑定解除后立即释放变体；原材质、Geometry 和贴图均不释放。不同设备仍在使用的变体不受另一设备解除影响。
- `AlarmVisualSystem.update()` 仍由 100ms 帧任务调度，仍使用最高活动报警；仅首次报警、等级变化或 Mesh/材质引用变化时绑定变体。只对报警实体遍历子树，清除报警或模型移除时恢复以前的 Mesh。实例化 Mesh 明确跳过。
- 帧观察器 `beforeRender` 每帧推进共享时间 uniform，Shader 中严重/紧急采用 `0.45 + abs(sin(t*7))*0.55`，提示/警告固定 0.72。每次 `WebGLRenderer.render()` 重置 `_currentMaterialId`、`_currentCamera`（本地 r185 第1792行），所以单个稳定变体每帧仍会刷新 uniform；同一 pass 内共享一个材质的逐对象变量仍不可靠。上一轮报告把“跨帧不刷新”归因于稳定材质并不准确，本轮实测及该重置逻辑修正了这一点。
- 安全注入范围：无自定义 `onBeforeCompile` 的 `MeshStandardMaterial`（包括继承它的 Physical 材质）。等级编入 program cache key，原 key 保留。共享时间引用在首次和再次编译均注入；按标准 chunk 合成 emissive。
- 回退范围：Basic/Lambert/Phong/ShaderMaterial 等其他类型，以及带自定义 compile 钩子的材质，使用共享等级克隆和旧版100ms CPU底色、emissive及透明度写入。实际测试的岸桥和AGV均为 Standard，回退数为0。合成测试含 Basic 回退材质。
- 外观取舍：Shader路径保留原底色、透明度、贴图和原emissive，叠加报警发光；不再像旧版把整个底色染成报警色/白色，也不提高透明度。报警颜色取原系统的 Three.Color 线性值；紧急系数1.6、其余0.8。它沿用原型的叠加策略，不能视为旧版像素等价。
- 选中高亮为独立 Box3Helper，没有替换设备材质。报警恢复对整个引用及数组每槽核对，仅恢复仍属于本系统的槽，不覆盖后来接管的材质。
- `EntityManager.onBeforeRemove()` 在实体资源dispose之前通知报警系统恢复。模型/子节点替换在下次100ms同步发现；调用方若要立即销毁已移除模型，应先调用 `releaseEntity(entity)`，不能在同步前自行销毁仍借用的报警材质。运行时停止渲染后先dispose报警系统，再释放适配器和模型资产。

## 复现

```powershell
npm run dev -- --host 127.0.0.1
node tests/alarm-shader.smoke.mjs
node tests/browser/alarm-scene.smoke.mjs
npm run type-check
npm run build
```

浏览器脚本沿用现有Playwright/本机Edge方式，通过Vite模块启动真实PortRuntime，加载实际GLB，用AlarmStore注入不同等级。为固定采样暂停正式运动/遥测和RAF，使用真实composer/相机/场景渲染并逐RAF推进报警时间；状态同步显式调用。这样检验实际渲染而不把随机遥测/相机运动混入像素差。正常App通过帧监听器推进时间。采样尺寸1100×760、pixelRatio=1，ACES exposure=0.65，composer包含项目的Bloom和OutputPass。

## 验收结果与证据边界

完整实测读数（含65帧时间和RGB）保存在 `tests/browser/results/alarm-shader/results.json`，开关Bloom的四张截图在同目录。

| 项目 | 结果 |
|---|---|
| 实际模型覆盖 | 加载ready的crane和agv资产，岸桥3台每台8个子Mesh，AGV5台每台4个子Mesh；报警验证QC_01/QC_02/AGV_01，共20个子Mesh，材质全为MeshStandardMaterial |
| 单岸桥连续脉动 | 通过：同一变体65个连续RAF采样跨多个周期；波谷186,166,164，波峰216,179,169，固定像素有多种RGB（具体次数和时长见JSON） |
| 同等级共享/多等级 | 通过：两岸桥SEVERE共享变体，AGV URGENT独立；20槽引用对应10变体 |
| 解除一台/保留另一台 | 通过：QC_01所有Mesh恢复原引用，QC_02继续报警 |
| 材质数组/外部接管 | 合成生命周期测试通过：Standard+Basic数组，等级切换、完整引用恢复及后绑定材质保留；实际模型本轮没有覆盖数组材质 |
| 选中报警设备 | 正式场景执行选中/包围盒更新成功，报警绑定不变；截图可复查。未做人工主观可辨性打分 |
| 模型替换/卸载 | 通过：替换QC_02一个子Mesh，旧Mesh恢复、新Mesh获得变体；EntityManager.remove之前恢复模型引用 |
| 销毁/重入 | 通过：运行时销毁后boundMeshes=0、live=0、created=disposed；第二次创建/启动/销毁完成 |
| 资源归属 | 合成测试created=disposed=6，原材质/贴图dispose事件均0；实际运行结果见JSON |
| ACES/Bloom开关 | 正式composer分别渲染严重/紧急波谷波峰并保存像素差与截图；不同等级是否在所有视角容易辨认仍需产品侧视觉复核，项目雾和Bloom会压淡颜色 |
| 构建/类型 | npm run build、npm run type-check通过（同时修正原型已有Mesh参数类型错误） |

零报警和三设备报警固定视角：单次composer重置info统计后draw calls均768；program由23到26。选中后draw calls770、program27。后者包含独立高亮包围盒，不能归因于报警材质。program允许按等级编译分支；变体对象数不等于program数。没有可用同工作区旧版基线，本轮未报告新旧报警任务耗时/帧率提升，CPU扫描与100ms最高等级查询仍存在。也未对透明设备及自定义Shader材质执行真实模型像素验收。

最终包含Bloom等级切换的整轮运行：65帧约1.426秒、29种RGB；累计创建/释放变体28/28。开关Bloom截图可见当前雾与曝光下画面偏白，严重和紧急虽然有不同的注入颜色与强度，但不能宣称已通过所有视角的可辨识性验收。像素选取为全帧变化最大的固定坐标，不是自动设备分割，因此开关Bloom数值只作合成结果证据，不当作等级颜色的定量测色。
