# KTX2 第三阶段浏览器验收记录

## 测试资产

- 普通纹理模型：`public/ktx2-tests/ordinary.glb`，来自项目现有 `crane_harbour2.glb`，GLB 内嵌 PNG 纹理，大小 11,280,344 bytes。
- KTX2 模型：Khronos glTF Sample Assets 的 `AnisotropyBarnLamp/glTF-KTX-BasisU`，放在 `public/ktx2-tests/anisotropy/`，不覆盖正式模型。
- KTX2 glTF 声明 `KHR_texture_basisu` 于 `extensionsUsed` 和 `extensionsRequired`，4 个纹理均通过该扩展引用 KTX2 文件；无 Draco 依赖。
- KTX2 目录资源合计 5,225,726 bytes；其中 4 个 KTX2 文件分别为 1,017,986、2,127,072、91,214、1,572,895 bytes。

## 隔离入口与链路

`src/ktx2-test.html` / `src/ktx2-test.ts` 是独立测试页面，不进入正式 PortRuntime。页面创建独立 Renderer，在加载前执行 `KTX2Loader.setTranscoderPath('/basis/').detectSupport(renderer)`，再通过 `GLTFLoader.setKTX2Loader()` 加载普通 GLB 和 KTX2 glTF。页面支持清理并重新加载模型，销毁页面时释放测试 Loader 和 Renderer。

## 实际浏览器结果

`node tests/browser/ktx2-browser.smoke.mjs` 在 Vite 开发服务器和生产预览服务器均通过：

- 普通 PNG GLB：加载成功，有 Mesh 和纹理材质。
- KTX2 模型：3 Mesh、3 材质、4 个压缩纹理，均加入 Scene。
- 4 个纹理尺寸均为 2048×2048，`mipmaps.length` 为 1。
- 实际纹理 `format` 为 Three.js `RGBA_ASTC_4x4_Format`（数值 37808），`type` 为 1009，`isCompressedTexture` 为 true。
- 浏览器检测到 ASTC、ETC2、S3TC；PVRTC 不支持。
- Basis transcoder JS/WASM 和 KTX2 文件均返回 HTTP 200；页面无 uncaught error。
- 清理后再次加载同一 KTX2 模型成功。

## 限制

测试报告的是当前 Chromium/WebGL 环境实际选中的格式，不代表所有 GPU 都选择 ASTC。未修改正式模型、Runtime 生命周期、AssetManager 或 Mipmap 策略，也未进行正式模型批量转换和性能测试。
