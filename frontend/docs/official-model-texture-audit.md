# 正式港口模型纹理审计（KTX2 第四阶段）

审计对象为 `frontend/model/*.glb`，通过解析 GLB 的 JSON/BIN chunk、图片 MIME、图片头部尺寸、材质纹理索引和扩展完成。原始文件未修改。

## 模型汇总

| 模型 | GLB 大小 | Mesh | 材质 | 图片 | 唯一图片引用 | 图片格式 | KTX/其他压缩扩展 |
|---|---:|---:|---:|---:|---:|---|---|
| AGV.glb | 18,284 | 5 | 1 | 0 | 0 | 无内嵌图片 | 无 |
| battery_charger.glb | 18,499,348 | 3 | 3 | 9 | 9 | PNG ×9 | `KHR_materials_specular`, `KHR_materials_emissive_strength` |
| cc.glb | 137,564 | 1 | 4 | 0 | 0 | 无内嵌图片 | 无 |
| container_ship .glb | 35,454,960 | 5 | 3 | 10 | 10 | PNG ×10 | `KHR_materials_specular` |
| Crane.glb | 542,664 | 3 | 6 | 0 | 0 | 无内嵌图片 | 无 |
| crane_harbour.glb | 12,898,976 | 6 | 6 | 2 | 2 | PNG ×2 | 无 |
| crane_harbour2.glb | 11,280,344 | 9 | 7 | 2 | 2 | PNG ×2 | 无 |
| gantry_crane.glb | 38,102,448 | 871 | 92 | 0 | 0 | 无内嵌图片 | 无 |
| jzx1.glb | 109,584 | 1 | 4 | 0 | 0 | 无内嵌图片 | 无 |
| jzx2.glb | 123,564 | 1 | 5 | 0 | 0 | 无内嵌图片 | 无 |
| jzx3.glb | 751,756 | 1 | 1 | 1 | 1 | PNG ×1 | 无 |
| small_cargo_ship.glb | 24,550,580 | 324 | 1 | 4 | 4 | JPEG ×2、PNG ×2 | 无 |

## 纹理明细

- `crane_harbour2.glb`：PNG 2048×2048，3,229,710 bytes；PNG 2048×2048，3,270,091 bytes。材质纹理引用包含 BaseColor 和 Normal，另有 5 个未贴图材质。
- `crane_harbour.glb`：PNG 2048×2048，3,270,091 bytes；PNG 2048×2048，3,229,710 bytes。材质纹理引用包含 BaseColor 和 Normal。
- `jzx3.glb`：PNG 1856×2560，652,912 bytes，作为 BaseColor 使用。
- `small_cargo_ship.glb`：JPEG 4096×4096，3,791,631 bytes；PNG 4096×4096，5,603,906 bytes；JPEG 4096×4096，211,089 bytes；PNG 4096×4096，11,103,328 bytes。单一 `Ship` 材质同时引用 BaseColor、Normal、Metallic/Roughness、Occlusion 和 Emissive 通道。
- `battery_charger.glb`：9 张 PNG，均为 4096×4096，大小范围 13,998–3,598,303 bytes；3 个材质包含 BaseColor、Normal、Metallic/Roughness 和 Emissive 引用，并使用 specular/emissive-strength 扩展。
- `container_ship .glb`：10 张 PNG，均为 4096×4096，大小范围 24,093–4,100,061 bytes；3 个材质包含 BaseColor、Normal、Metallic/Roughness 和部分 Emissive 引用，并使用 specular 扩展。

审计发现的重复内容仅按图片引用关系统计；转换前仍应对图片字节做 hash 去重，不能仅依据文件大小判断重复。

## 试点选择与转换阻塞

推荐 `crane_harbour2.glb`：文件较小、无额外 glTF 材质扩展、包含常见 BaseColor/Normal 纹理、与正式岸桥场景直接相关，适合低风险视觉对照。主要风险是其两个 PNG 仅被部分材质引用，转换后必须保持材质索引和透明材质语义。

当前环境没有发现 `basisu`、`toktx`、KTX-Software、`gltf-transform` 或 `gltf-pipeline` 可执行工具；项目依赖中的 Three.js Basis 文件只有运行时 transcoder，不包含纹理编码器。因此本阶段没有擅自安装工具，也没有生成伪造或不完整的 KTX2 文件，未覆盖原始 GLB。

最小转换方案是使用与目标 Three.js 版本无关的官方 Basis Universal `basisu` 编码器，或 Khronos KTX-Software `toktx` 加 `gltf-transform`/等效 glTF 重写工具：先导出 PNG，颜色纹理与非颜色纹理分别设置编码参数并生成 mipmap，再将图片替换为 `KHR_texture_basisu` source，最后用 glTF validator 和浏览器测试页面验证。获得工具后只应转换上述 `crane_harbour2.glb` 的副本。

## 本阶段结论

正式资产审计已完成，试点模型已确定；由于缺少可靠 KTX2 编码工具，单模型转换和正式港口场景视觉验收暂缓。没有修改正式模型、运行时加载架构、Mipmap 策略或业务代码。
