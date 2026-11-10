# 第十二阶段 A：small_cargo_ship 复杂材质 KTX2 压缩与质量验证

日期：2026-11-10。模型级结论：**PARTIAL**。

已完成只读审计、4 张原始图片无损提取、6 组实际编码、每组完整 13 级 CPU 解码与同算法参考比较，以及纹理图像视觉复核。未打包 GLB，未接入 Runtime。

当前产物不应直接进入正式替换：Normal 存在局部大角度压缩误差，部分参考 Mipmap 本身含近零法线；全 UASTC 的下载体积也大于原图片。没有预先约定的质量阈值，不将编码/结构成功写成质量 PASS。

## 1. 测试环境和工具版本

| 项目 | 实际结果 |
|---|---|
| 系统 | Windows 10 x64，10.0.19045 |
| Python | 3.11.2，使用已有 NumPy 2.4.4、Pillow 12.2.0 |
| 编码器 | 官方源码构建 Basis Universal v2.50.0 x64 |
| EXE | `C:\Users\26057\AppData\Local\KTX-Tools\BasisUniversal\basisu.exe` |
| EXE SHA-256 | `99383F1D63B78CC8EA125A16F3C62D7FF6C967E56015077662619F4BAA9C3F0C` |
| 官方源码 | `C:\Users\26057\AppData\Local\KTX-Tools\Source\basis-universal-073eb6a` |
| HEAD | `073eb6a0a34a23d77e75e54f41dcd9653a52da83`，重新执行 rev-parse 核实 |
| 源码状态 | 既有未跟踪构建产物 `bin/basisu.exe`，不宣称源码目录完全干净；本阶段未改源码 |
| 功能输出 | SSE4.1=1、Zstandard=1、OpenCL=0；`--help` 退出码 0 |
| 测试根目录 | `C:\Users\26057\AppData\Local\KTX-Tools\Tests\SmallCargoShip` |

完整帮助保存在测试根目录 `logs/basisu-help.txt`。未安装工具、依赖或修改 PATH。仅使用已有编码器及已有 Python 库。CPU RGBA32 解码不需要启动 Three.js、浏览器或 GPU；本阶段也不将 CPU 结果称为 GPU 转码/渲染验收。

可复现脚本位于上述外部根目录：`audit_stage.py`、`encode_stage.py`、`validate_stage.py`、`normal_diagnostics.py`、`finish_artifacts.py`、`final_checks.py`、`check_artifacts.py`。编码脚本拒绝覆盖已存在的编码输出；验证脚本保留检查点、解码 DDS/PNG、精确参考 Mipmap 和日志。

## 2. 正式 GLB 完整性

源文件：`F:\desktop\threejs完整版\码头升级\vue+three\frontend\model\small_cargo_ship.glb`。

| 项目 | 审计结果 |
|---|---|
| 文件大小 | 24,550,580 bytes |
| 修改时间 UTC | 2026-07-23T07:12:05.786686+00:00 |
| SHA-256，审计前后相同 | `300BF0D4599E9DA04B4819AC2756E3F8F7D6BBF210A3ABE66311E13A2481B6AF` |
| Header | `glTF`，版本 2，声明长度与实际一致 |
| JSON chunk | chunk header offset 12；payload offset 20，347,612 bytes |
| BIN chunk | chunk header offset 347,632；payload offset 347,640，24,202,940 bytes |
| 边界/对齐 | 两个 chunk 均在文件内、4-byte 对齐，JSON 可解析 |
| 数量 | images=4、textures=4、materials=1、bufferViews=8、accessors=1620、meshes=324、nodes=650、animations=0 |
| 扩展 | extensionsUsed、extensionsRequired 均为空；未发现 KHR_texture_basisu 或 KHR_texture_transform |

“复杂材质”在本文件中指多种纹理语义，不是多个材质：实际只有一个 `Ship` 材质。完整原始 JSON、Mesh/Primitive→Material 和每条纹理引用保存在 `audit/gltf-original.json`、`audit/manifest.json`，不根据文件名推断用途。

## 3. Image / Texture / Material 引用关系

以下关系全部来自实际 JSON；所有图片为 GLB BIN 内嵌资源，无外部 URI。

| Material | 材质槽位 | Texture | Image | bufferView | BIN 内 byteOffset | 原图 bytes |
|---|---|---:|---:|---:|---:|---:|
| 0 Ship | pbrMetallicRoughness.baseColorTexture | 0 | 0 | 4 | 3,492,984 | 3,791,631 |
| 0 Ship | pbrMetallicRoughness.metallicRoughnessTexture | 1 | 1 | 5 | 7,284,615 | 5,603,906 |
| 0 Ship | occlusionTexture | 1 | 1 | 5 | 7,284,615 | 同一资源，不重复计数 |
| 0 Ship | emissiveTexture | 2 | 2 | 6 | 12,888,521 | 211,089 |
| 0 Ship | normalTexture | 3 | 3 | 7 | 13,099,610 | 11,103,328 |

以上 BIN offset 以 manifest 的原始 bufferView 为准。独立图片总量 **20,709,954 bytes**。图片哈希互不相同，没有内容重复图片。Texture 1 同时承担 MR 与 AO；仅编码一次 ORM，R/G/B 分别分析。

四个 texture 都使用 sampler 0：magFilter=9729（LINEAR），minFilter=9987（LINEAR_MIPMAP_LINEAR），wrapS/T=10497（REPEAT）。全部材质纹理使用默认 texCoord=0，无纹理变换、无 texture 扩展。不存在跨材质图片语义冲突。

材质 `doubleSided=true`，`emissiveFactor=[1,1,1]`；alphaMode 缺省为 OPAQUE，alphaCutoff 缺省 0.5；normalTexture.scale、occlusionTexture.strength、metallicFactor、roughnessFactor 均缺省为 1。未修改这些值或任何 Mesh/Node/UV。

## 4. 每张图片的语义和颜色空间

| Image / 提取副本 | 实际格式 / 通道 | 尺寸 | 语义 | 处理 |
|---|---|---|---|---|
| 0 / source/image-00.jpg | JPEG / RGB | 4096×4096 | BaseColor | sRGB；无 alpha |
| 1 / source/image-01.png | PNG / RGB | 4096×4096 | R=AO、G=Roughness、B=Metallic | Linear / Non-color；不做 Gamma 转换 |
| 2 / source/image-02.jpg | JPEG / RGB | 4096×4096 | Emissive | sRGB；发光主要为稀疏红色区域 |
| 3 / source/image-03.png | PNG / RGB | 4096×4096 | RGB 切线空间法线 | Linear / Non-color；不做 Gamma 转换 |

| Image | 原始内嵌 bytes 与提取副本相同的 SHA-256 |
|---|---|
| 0 | `61EA3E74F94F09643A95C1C4B8CC472176D38F8E185F0A69FA6644B338239F78` |
| 1 | `6350103A7A738CCE90886AB042B7C5A0A31A4AA1D03E4D286ED1ACAFD253930F` |
| 2 | `D5DFDB098EE503BE10CB37A7385667BC43BD5BF34F080B4347DF4250DD508FE2` |
| 3 | `A831955DBF737C74BE6FE4E6B34327E3DE01EBE5AE87393E83EC8C4484F9660E` |

提取直接切出 bufferView 字节，不重新保存原始 JPEG/PNG。像素预览 PNG 是另外的派生文件，不替代源图片。4 张图的 Pillow RGB 像素与编码器 debug L0 输入逐字节相同，未出现 JPEG 解码器差异干扰本轮指标。

## 5. 编码策略及参数

先建立 `audit/encoding-plan.json`，再顺序执行六个候选。UASTC level 3 是当前帮助定义的最高实用 effort；未使用极慢的 level 4，未开启额外有损 RDO。ETC1S q=200、comp_level=2 作为颜色纹理的体积对照，不当作已通过质量阈值的最终方案。

| 候选名称 | 输入 | 专用参数 |
|---|---|---|
| basecolor-uastc | image-00.jpg | `-uastc -uastc_level 3 -srgb -mip_srgb` |
| basecolor-etc1s | image-00.jpg | `-etc1s -q 200 -comp_level 2 -srgb -mip_srgb` |
| emissive-uastc | image-02.jpg | `-uastc -uastc_level 3 -srgb -mip_srgb` |
| emissive-etc1s | image-02.jpg | `-etc1s -q 200 -comp_level 2 -srgb -mip_srgb` |
| orm-uastc | image-01.png | `-uastc -uastc_level 3 -linear -mip_linear` |
| normal-uastc | image-03.png | `-uastc -uastc_level 3 -linear -mip_linear -normal_map -mip_renorm` |

每次公共命令形式如下；输入/输出均为绝对路径，完整已执行 argv 和 Windows 命令字符串保存在 `encoded/encoding-results.json`，并非仅提供计划命令：

```text
basisu.exe -file <测试根目录>\source\<输入>
  -output_file <测试根目录>\encoded\<候选名称>\<候选名称>.ktx2
  -ktx2 <上表专用参数>
  -mipmap -mip_filter kaiser -max_threads 4 -debug_images
```

| 已核实参数 | 当前版本实际含义 |
|---|---|
| -ktx2 / -file / -output_file | 输出 KTX2、指定输入和输出 |
| -etc1s -q 200 -comp_level 2 | 显式 ETC1S；q 控制质量/体积，comp_level 控制 effort |
| -uastc -uastc_level 3 | UASTC LDR 4×4，实用高 effort |
| -srgb / -linear | 颜色误差评估方式与 DFD transfer，默认影响 mip 滤波空间；不是自动识别纹理用途 |
| -mip_srgb | 先转 Linear 滤波，再编码回 sRGB |
| -mip_linear | 数据纹理直接滤波，不应用 sRGB 变换 |
| -normal_map | 法线相关调优，Linear metrics/filtering、无 sRGB 等；不等于质量合格 |
| -mip_renorm | 滤波后调用编码器法线重归一化逻辑；有近零哨兵和容差，非保证每个向量严格单位化 |
| -mipmap -mip_filter kaiser | 生成完整 mip 链，Kaiser 核 |
| 默认边界与 mip 模式 | wrapping，与 sampler REPEAT 一致；当前源码 bool_param 默认 mip_fast=true，逐级生成 |
| -debug_images | 保存压缩前输入 slice；会显著增加调试 I/O，耗时不代表纯编码基准 |

Normal 未增加会改变 L0 的 `-renorm`，未交换/删减通道；ORM 不套用法线重归一化。四张源图无 alpha，没有为体积统一更改其语义。

## 6. KTX2 结构验证

**PASS：本地有界结构解析与官方 CPU 解码执行。NOT TESTED：独立 Khronos Validator。** 没有安装新验证器；未将编码器自身与自编解析器称作独立标准认证。

六个输出均满足：Identifier 合法、vkFormat=0、typeSize=1、4096×4096、pixelDepth=0、layerCount=0、faceCount=1、levelCount=13。Header+Level Index 至 offset 392；DFD offset=392/length=44，基础 block offset=396、version=2、size=40。解析 DFD samples、KVD 与 SGD，不只看扩展名。

| 候选 | DFD model | primaries | transfer | Supercompression | SGD |
|---|---:|---:|---:|---|---|
| BaseColor / Emissive UASTC | 166 | 1 BT709 | 2 sRGB | 2 Zstandard | 无 |
| BaseColor / Emissive ETC1S | 163 | 1 BT709 | 2 sRGB | 1 BasisLZ | 有，解析全局表及 13 个 ImageDesc |
| Normal / ORM 原始 UASTC | 166 | 1 BT709 | 1 Linear | 2 Zstandard | 无；非颜色 primaries 尚不符合 glTF 要求 |
| Normal / ORM noncolor 副本 | 166 | 0 Unspecified | 1 Linear | 2 Zstandard | 无 |

RGB DFD 均为单 sample channelType=0，无 alpha/premultiplication。UASTC bitLength=127，bytesPlane[0]=16；ETC1S bitLength=63，bytesPlane[0]=8。KTXswizzle、KTXorientation 为省略或合法默认 rgba/rd。逐一检查 Header、DFD/KVD/SGD、全部 Level Index 的非重叠和文件边界；UASTC 每级未压缩长度核对 `ceil(w/4)*ceil(h/4)*16`；ETC1S 核对全局表总长度、RGB slice 区间和 alpha 缺省。所有 payload 非空，文件完整到最后一段，无截断。

数据纹理修正遵循已保存的官方 KHR_texture_basisu 文本：非颜色数据必须 primaries=Unspecified、transfer=Linear。依据快照：`C:\Users\26057\AppData\Local\KTX-Tools\Tests\CraneHarbour2\original-audit\KHR_texture_basisu-spec.md`，上游为 KhronosGroup/glTF 的该扩展 README。

不是定位固定字节后盲改：先按 Header 找 DFD，解析 block，求出 colorPrimaries offset，本次两文件均为 **405**；仅将该值 1→0，写入独立 `*-noncolor.ktx2`，保留 raw。验证全部 13 级压缩 payload 哈希不变，并分别执行两文件的 RGBA32 解码，**13/13 对 RGBA 像素 SHA-256 完全相等**，DXGI 均为 28 Linear。只证明此元数据修正不改变本轮 CPU 像素，不声称已证明浏览器所有消费者行为。

| 文件 | SHA-256 |
|---|---|
| basecolor-uastc.ktx2 | `88D59EC8DE9E29F24E672AA7D5C6AD1B7B6FB3FE764DCFA0F6679F414C7A413B` |
| basecolor-etc1s.ktx2 | `045157F389F3AA8473F5DC22E64FF054C3EBC63E2CD0809311CAD0F4DB44D1AE` |
| emissive-uastc.ktx2 | `88D770ECA32088CA324D0F95EB9AB6343CFB0F03423928FCCC1715E8868D6D4A` |
| emissive-etc1s.ktx2 | `F7F61D75660748FCA9B1F9F7CFA1C9B2BFD4DCF37A48334473AA91761831F337` |
| orm-uastc.ktx2 raw | `C06457F208AF6CA61333254B074F5993EC489D78528D3CD79FA887CB4F59E4EF` |
| orm-uastc-noncolor.ktx2 | `84ED1CDD345B31FBB1DA8620C6D7A0B1957B3774239D51F750741EB356511E13` |
| normal-uastc.ktx2 raw | `9EA86CF63DCB575CE542D0CB86EA6EA7FB05F2EF49A5C7AC7434D2B4B0EBE383` |
| normal-uastc-noncolor.ktx2 | `B1DB536F1418FF6A87F7315C94C6A47F99CAA2534FAE4B905C671F9574F30AAD` |

## 7. BaseColor 质量结果

全部解码命令为已有工具的 `-file <实际ktx2> -export_dds RGBA32 -output_file <外部decoded目录>\raw.dds`，保留完整参数、退出码、耗时、stdout/stderr。读取 DDS DX10 Header，核实 DXGI 29=sRGB 或 28=UNORM、尺寸、13 个层级、全部像素长度和 alpha=255。每个 DDS 为 89,478,632 bytes，导出每级 PNG 并记录 RGBA 哈希。

颜色纹理将参考与解码的相同 sRGB 编码 RGB 用 IEC sRGB 分段函数转换至 Linear [0,1] 后计算；不对不同空间直接做差。PSNR 峰值=1。下表为 L0；通道指标及所有 mip 原始值在 `quality/quality-results.json`。

| L0 Linear RGB 指标 | UASTC | ETC1S |
|---|---:|---:|
| MAE | 0.001067927 | 0.010721627 |
| RMSE | 0.003624536 | 0.021952240 |
| PSNR dB | 48.814953 | 33.170423 |
| 最大绝对误差 | 0.335848416 | 0.847073848 |
| 任一通道误差 >0.05 的像素 % | 0.120157 | 5.379176 |
| R/G/B MAE | 0.001365480 / 0.000952613 / 0.000885688 | 0.013630765 / 0.008351256 / 0.010182859 |
| R/G/B RMSE | 0.004423981 / 0.003159116 / 0.003140088 | 0.025081330 / 0.018224972 / 0.022010901 |
| R/G/B 最大误差 | 0.300833836 / 0.186821226 / 0.335848416 | 0.847073848 / 0.808798317 / 0.847073848 |

0.05 是报告“高误差像素”的描述性分箱（全色域 5%），不是合格阈值。UASTC 本轮数值明显更好，但边界仍有误差；ETC1S 可见更广泛的块状/色阶与细节差异。BaseColor **PARTIAL**，暂以 UASTC 作为质量对照候选，不能忽略其体积增长。

## 8. Normal 质量结果

RGB/255→2RGB−1，不做 sRGB 转换；先计算向量长度、排除精确零向量，再分别归一化，clamp(dot,-1,1)，acos 转为度。所有 mip 已计算。L0 16,777,216 个像素，参考与解码精确零向量均为 0。

| L0 角度与长度指标 | UASTC |
|---|---:|
| Mean / Median | 0.389666557° / 0° |
| P95 / Max | 1.840238203° / 95.179741403° |
| >1° / >3° / >5° 像素比例 | 8.371401% / 3.107125% / 2.049267% |
| 参考 abs(length−1) Mean / Max | 0.000318992 / 0.006209097 |
| 解码 abs(length−1) Mean / Max | 0.002681738 / 0.908955398 |
| L0 解码长度最小值 | 0.091044605 |
| >90° 像素 | 2 |

L0 最大误差像素 `(1315,60)`：参考 RGB=(204,26,134)，解码=(69,92,139)；参考长度约 0.99817、解码约 0.54422。该处不是参考近零向量，存在真实压缩方向误差。参考 L0 没有负 Z；解码有 2281 个 B<128 像素，尚未证明它们是否处于有效 UV 覆盖内。

### 低级 mip 近零向量必须单独解释

L1 原始全非零统计 Max=180°，但该极端像素参考为 `(128,128,128)`，映射后的长度仅 0.006792356，方向物理意义弱。不能把这一项直接全归因于压缩，也不能隐藏真实 L0 大误差。

已检查官方 `encoder/basisu_enc.h` 的 `image::renormalize_normal_map()`：保留已有 `(128,128,128)`；length<0.077 时也写入该哨兵，长度偏差超过 0.077 才重归一化。该常量来自实际源码，是算法有效性诊断依据，不是本项目质量验收阈值。

`quality/normal-diagnostics.json` 保留每级哨兵、近零数量、负 Z 数量、最差像素与额外稳定向量统计：

| 层级 | 参考哨兵像素数 | 原始 Mean/P95/Max ° | 双方 length≥0.077 后 Mean/P95/Max ° |
|---|---:|---|---|
| L0 | 0 | 0.389667 / 1.840238 / 95.179741 | 相同，全部纳入 |
| L1 | 6924 | 0.812826 / 3.579889 / 180 | 0.715079 / 3.431476 / 108.349792，排除6924 |
| L2 | 375 | 0.812467 / 4.359287 / 171.532868 | 0.789235 / 4.326519 / 125.662453，排除375 |

低级参考 mip 中已存在哨兵及负 Z，说明滤波/重归一化本身需单独评估；本轮只报告，未更改正式 Mipmap 策略、重编码或修复资产。保存完整 L0 角度数组 `quality/normal-uastc/L00-angle-degrees.npy`。Normal **PARTIAL，当前不批准直接用于正式替换**；必须先审核局部 UV 与 mip 语义，平均角度小不能覆盖极端误差。

## 9. Metallic/Roughness 质量结果

共享 ORM，Linear RGB 按通道归一化到 [0,1] 做差，无 Gamma、无通道重排。以下均为 L0。

| 指标 | R Occlusion | G Roughness | B Metallic |
|---|---:|---:|---:|
| MAE | 0.000490813 | 0.000322391 | 0.000136449 |
| RMSE | 0.001954879 | 0.001756027 | 0.001018803 |
| 最大绝对误差 | 0.105882353 | 0.094117647 | 0.121568627 |
| P95 绝对误差 | 0.003921569 | 0.003921569 | 0 |
| 误差 >0.05 像素 % | 0.001049042 | 0.000661612 | 0.000458956 |

逐通道图保留材质区域分布，未发现明显通道交换；局部噪声和锐利边界有量化差异。没有通过三通道平均值掩盖 G/B 数据损失，也不将“分布相近”作为没有压缩通道影响的证明。真实灯光下高光/金属效果尚未验证。Metallic/Roughness **PARTIAL**。

## 10. Occlusion 质量结果

Occlusion 与 MR 共用 texture 1 / image 1，直接复用上一节 R 通道结果，没有独立 AO 图片、额外编码或重复纹理体积。

描述性区域分箱：参考 R<0.25 为高遮蔽、R>0.75 为低遮蔽，不是业务接受阈值。高遮蔽 1,397,903 像素，R MAE=0.000829408；低遮蔽 7,356,544 像素，R MAE=0.000220405。中间区域仍包含在全图统计。全部 mip 同样保留这两类区域计数/误差。Occlusion **PARTIAL**，未检验正式光照和 AO strength 下的视觉影响。

## 11. Emissive 质量结果

同 BaseColor 使用 Linear RGB 误差。L0 的非零参考亮度区域为 31,769 像素，不能靠大面积黑色背景把整体误差稀释后宣称合格。

亮度采用 Linear RGB 的 0.2126R+0.7152G+0.0722B；发光区域=参考亮度>0，高亮区域=亮度≥本层峰值50%，仅作可复现诊断，不是验收阈值。L0 高亮21,970像素。

| L0 指标 | UASTC | ETC1S |
|---|---:|---:|
| 全图 MAE | 0.00000140036 | 0.00001108853 |
| 全图 RMSE | 0.000188288 | 0.001171711 |
| PSNR dB | 74.503562 | 58.623589 |
| 最大绝对误差 | 0.154781434 | 0.554798805 |
| 任一通道误差>0.05 像素 % | 0.000905991 | 0.011390448 |
| 发光区域 MAE | 0.000738788 | 0.005854129 |
| 高亮区域 MAE | 0.000755609 | 0.006941499 |
| 发光区域平均亮度偏差，解码−参考 | −0.000032545 | −0.001819630 |
| 高亮区域平均亮度偏差 | −0.000034238 | −0.002849198 |

局部对照中 ETC1S 红黑边界块状与亮度变化比 UASTC 更明显。UASTC 在本图仍很小，可作为优先质量候选；未验证曝光、Bloom 或最终发光材质，不将 CPU 图当场景验收。Emissive **PARTIAL**。

## 12. Mipmap 质量结果

**PASS：六文件每个13级的结构、解码与比较执行。PARTIAL：最终 mip 语义/视觉质量接受。** 共78组独立参考/解码层，另对 Normal、ORM 修正副本各解码13级验证像素一致。L0=4096，L12=1×1，尺寸和级数以实际 Level Index 与 DDS 同时核对。

### 参考不是 Pillow 缩小图

使用同次编码的 `-debug_images` 输出 `basis_debug_source_image_0_slice_N.png`。源码 `encoder/basisu_comp.cpp` 的 generate_mipmaps 使用当前编码参数的 Kaiser/sRGB或Linear/法线处理；`extract_source_blocks()` 在块编码前保存原输入 slice。L11=2×2、L12=1×1 的 debug slice 已复制边缘补齐到4×4，仅裁去块填充，未重滤波。其余尺寸逐一相等。

因此，参考→解码指标包含该候选的实际压缩/CPU解码误差，不将 L0→参考 mip 的滤波变化混为压缩误差；相同参考算法并不保证该算法适合当前法线内容。源 JPEG 解码在本轮也逐字节一致。未以任意 resize 替代参考链。

| Level | 尺寸 | BaseColor UASTC MAE | Emissive UASTC MAE | Normal Mean ° | Normal P95 ° | ORM R/G/B MAE |
|---|---:|---:|---:|---:|---:|---|
| 0 | 4096 | 0.00106793 | 1.40036e-6 | 0.38967 | 1.8402 | 0.000490813 / 0.000322391 / 0.000136449 |
| 1 | 2048 | 0.00130673 | 1.69424e-6 | 0.81283 | 3.5799 | 0.000717816 / 0.000377776 / 0.000251824 |
| 2 | 1024 | 0.00152462 | 1.98450e-6 | 0.81247 | 4.3593 | 0.00121466 / 0.000520904 / 0.000452621 |
| 3 | 512 | 0.00203615 | 2.92835e-6 | 0.63377 | 3.9118 | 0.00196910 / 0.000838231 / 0.000915662 |
| 4 | 256 | 0.00311447 | 4.31556e-6 | 0.59115 | 3.1995 | 0.00340175 / 0.00158398 / 0.00173489 |
| 5 | 128 | 0.00511231 | 1.09178e-5 | 0.59339 | 2.7021 | 0.00594794 / 0.00310370 / 0.00342802 |
| 6 | 64 | 0.00793065 | 1.26130e-5 | 0.61061 | 2.2561 | 0.00945159 / 0.00533854 / 0.00663297 |
| 7 | 32 | 0.0133545 | 1.30480e-5 | 0.71190 | 2.2445 | 0.0143382 / 0.00930990 / 0.0118068 |
| 8 | 16 | 0.0197180 | 1.20006e-5 | 0.65774 | 1.5804 | 0.0229013 / 0.0133272 / 0.0213235 |
| 9 | 8 | 0.0291541 | 3.53557e-5 | 0.73777 | 1.6692 | 0.0265319 / 0.0251225 / 0.0220588 |
| 10 | 4 | 0.0274143 | 3.04754e-5 | 0.46956 | 1.4095 | 0.0181373 / 0.0218137 / 0.0397059 |
| 11 | 2 | 0.00597078 | 2.52939e-5 | 0.11597 | 0.39429 | 0.00294118 / 0.00490196 / 0.00196078 |
| 12 | 1 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |

Normal 此表保留原始非精确零统计，近零过滤后的诊断另见第8节及 JSON，不覆盖原始证据。

| Level | BaseColor ETC1S Linear MAE | Emissive ETC1S Linear MAE |
|---|---:|---:|
| 0 | 0.0107216 | 1.10885e-5 |
| 1 | 0.0114047 | 1.69647e-5 |
| 2 | 0.0138240 | 2.96489e-5 |
| 3 | 0.0173874 | 4.64525e-5 |
| 4 | 0.0232647 | 7.82800e-5 |
| 5 | 0.0324478 | 0.000179929 |
| 6 | 0.0433371 | 0.000247831 |
| 7 | 0.0610237 | 0.000375605 |
| 8 | 0.0787308 | 0.000506097 |
| 9 | 0.0858155 | 0.000601400 |
| 10 | 0.0678298 | 0.000615943 |
| 11 | 0.0165226 | 0.000236635 |
| 12 | 0.00362866 | 0.000101176 |

每级不仅有 MAE，还保留相应完整颜色、角度、ORM通道/区域指标、精确参考和解码路径/哈希、实际压缩 byteOffset/byteLength/uncompressedByteLength。小 mip 的块压缩误差不能由 L0 指标替代；例如 BaseColor UASTC L9 MAE约0.02915，高于L0。

## 13. 视觉对照和热力图

外部总索引：`C:\Users\26057\AppData\Local\KTX-Tools\Tests\SmallCargoShip\quality\visual-review-index.md`。

六个 `quality/<候选名称>/` 子目录各保留：

- `original-pixel-preview.png`：原图像素预览，源图片仍在 source/；
- `reference-L00.png` 至 `reference-L12.png`：编码器实际未压缩参考；
- `comparison.png`：参考、解码、误差总览及最大误差附近256×256局部的2倍 nearest 放大；
- `L00-error-heatmap.png`：全分辨率误差图，Normal为角度，其余为三通道最大绝对误差；
- `all-mips-contact.png`：13级参考/解码接触表。

真实解码 PNG 存在 `decoded/<候选名称>/raw-L00.png` 至 `raw-L12.png`，未美化或修改像素；noncolor副本另存。ORM另有 `orm-channel-comparison.png` 和 Occlusion/Roughness/Metallic 各通道误差灰度图。

已实际查看六组 L0 对照/局部热力图、BaseColor两组/Normal/ORM/Emissive ETC1S的mip接触表，以及ORM三通道对照。观察范围与结论保存在 `quality/visual-results.json`。接触表的缩略图不等于逐像素检查全部高分辨率区域；所有级的数值比较和原图均已保留。

热力图显示上限：颜色/数据0.05、法线5°，超过上限显示饱和，不表示最大误差只有这些值，也不是质量阈值。局部最大位置按相应数值误差定位，图像只作定位辅助。未做船体表面光照渲染，不能从 RGB 法线图断言表面视觉无异常。

## 14. 文件大小和压缩比例

| 候选 | 原图 bytes | KTX2 bytes（含13级） | 输出/原图 | 编码退出码 | 实际耗时秒 |
|---|---:|---:|---:|---:|---:|
| BaseColor UASTC | 3,791,631 | 8,109,202 | 213.871% | 0 | 52.657 |
| BaseColor ETC1S | 3,791,631 | 1,451,135 | 38.272% | 0 | 22.318 |
| Emissive UASTC | 211,089 | 25,614 | 12.134% | 0 | 1.737 |
| Emissive ETC1S | 211,089 | 9,484 | 4.493% | 0 | 6.369 |
| ORM UASTC | 5,603,906 | 8,880,477 | 158.469% | 0 | 59.643 |
| Normal UASTC | 11,103,328 | 11,520,860 | 103.760% | 0 | 93.032 |

原图仅有L0，而KTX2包含全mip，且JPEG/PNG与GPU通用压缩目标不同；以上是实际网络载荷大小对比，不是同类编码率或显存测量。

四种语义全部选 UASTC 时，总计 **28,536,153 bytes**，相对原图20,709,954增加 **37.790%**。颜色改用本轮ETC1S、数据维持UASTC时，总计 **21,861,956 bytes**，仍增加 **5.563%**。两种组合均不是已打包GLB，更不包括保留fallback后的整体大小。

耗时含 `-debug_images` 和输出I/O，不能作为正式生产编码、下载、纹理上传或 Runtime 性能指标。未测GPU显存、FPS、GPU转码及上传时间，未用文件体积推算它们已改善。

## 15. 风险与未验证项目

| 范围 | 状态 | 依据或限制 |
|---|---|---|
| 原GLB结构、图片提取、用途识别 | PASS | Header/JSON/BIN、逐条引用和字节哈希验证 |
| 六组编码及所有13级CPU解码 | PASS | 退出码0、DDS格式与所有层级逐一检查 |
| DFD数据纹理副本修正 | PASS（本轮解析/像素一致性） | 单字节修正，13级payload及RGBA哈希一致；不涵盖所有外部消费者 |
| BaseColor质量 | PARTIAL | UASTC数值更好但体积变大；局部误差及低级mip需接受标准 |
| Normal质量 | PARTIAL | L0真实角度outlier，低级参考近零与负Z，尚未判定UV覆盖和真实视觉影响 |
| Metallic/Roughness质量 | PARTIAL | G/B逐通道已测，真实高光及金属视觉未测 |
| Occlusion质量 | PARTIAL | 复用ORM-R数据与区域统计，场景遮蔽视觉未测 |
| Emissive质量 | PARTIAL | 已检查发光与高亮区域，Bloom/曝光/最终材质未测 |
| Mipmap质量 | PARTIAL | 全级数值已测，Normal滤波语义异常与小级块误差尚待审核 |
| 独立Khronos KTX Validator | NOT TESTED | 未发现命令可用；未安装工具；自编有界解析不等同标准验证器 |
| 浏览器/GPU转码、GLB打包与场景 | NOT TESTED | 本阶段明确不执行 |
| 新增业务代码的type-check/build | NOT TESTED / 不适用本次资产实验 | 未改业务代码、package/lock或构建流程，不覆盖现有dist |

CPU RGBA32的默认官方转码路径包括工具自身默认解码行为，不能据此预测 BC7/ASTC/ETC 等GPU目标的二次误差。Normal参考mip问题发生于当前候选的滤波/重归一化，不据此声称原GLB或项目原有mipmap已发生故障。全图指标包含UV未覆盖区域，尚未建立有效UV掩码，不能将所有outlier直接等同可见表面异常。

项目保护复核记录在外部 `audit/protection-results.json`：195个受保护文件哈希保持一致；正式GLB前后SHA-256一致；提取图哈希再次一致。已有Git修改完整保留。本轮项目内只新增本报告，项目外测试/日志未纳入Git。执行 `git status --short` 与 `git diff --check`，后者退出码0；未提交、未推送。未修改/清理server、backend、正式模型、正式图片、运行时或dist。

### 机器可读交付与追溯

以下均位于外部测试根目录，不放进正式资源目录：

| 文件 | 内容 |
|---|---|
| audit/manifest.json | GLB、图片原始哈希、引用、sampler/UV/material/Mesh-Primitive关系 |
| audit/encoding-plan.json | 编码前候选与参数 |
| encoded/encoding-results.json | 六组实际命令、退出码、秒数、大小/哈希、原始结构、修正产物与追溯 |
| audit/ktx2-structures.json | Header/DFD/KVD/SGD/全部层级边界、解码与修正一致性证据 |
| quality/quality-results.json | 六候选所有13级完整指标、比较算法、源解码差异 |
| quality/mipmap-results.json | 每层精确参考、解码、实际Level Index与哈希、Normal近零诊断 |
| quality/visual-results.json | 原图/对照/热力图路径、实际视觉复核与限制 |
| quality/normal-diagnostics.json | 每层法线哨兵、近零/负Z/最坏像素和稳定向量统计 |
| audit/protection-results.json | 受保护文件与源模型最终哈希、Git检查结果 |
| audit/artifact-consistency-results.json | 最后重新读取78组参考/解码PNG哈希、26组修正副本像素哈希、元数据仅单字节变化与编码器哈希，全部通过；不代表质量接受 |
| logs/ | 帮助、每组编码和每次解码stdout/stderr、命令/时间、Git diff检查日志 |

## 16. 下一阶段建议

当前只具备继续**人工审核与参数评估**的证据，不具备宣布所有质量通过或自动打包/接入的条件。模型级 **PARTIAL**，五种实际使用语义均 **PARTIAL**，原因不是工具无法编码，而是质量阈值未预定义且Normal存在需解决的具体风险。

优先审核Normal L0最差局部、L1/L2近零参考与实际UV覆盖，明确哪些差异来自滤波、重归一化和压缩。审核BaseColor/Emissive的UASTC与ETC1S取舍，并约定纹理语义各自的质量标准；数据纹理目前没有下载体积收益，不能只以“KTX2”标签决定替换。

之后如另行批准，可在项目外尝试更适合本图的受控候选/质量参数，再执行同样全mip验证。仅在人工接受上述风险与视觉对照后，再规划保留原PNG/JPEG fallback的独立GLB副本与真实场景测试。本轮到此停止，没有打包GLB、替换URL、接入PortRuntime或开始其他模型转换。
