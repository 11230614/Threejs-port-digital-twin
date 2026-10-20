# 3D 码头数字孪生 - 自动巡航 Demo

单文件 Three.js 示例，无需 npm，无需外部模型文件。

## 运行方式

由于使用了 ES Module（`import` 语法），**不能直接双击 HTML 打开**，必须通过本地 HTTP 服务器访问。任选一种：

### 方式 1：VS Code Live Server（推荐）
1. VS Code 安装 `Live Server` 扩展
2. 右键 `index.html` → `Open with Live Server`

### 方式 2：Python（系统已装 Python）
```bash
cd 码头Demo
python -m http.server 8080
```
浏览器访问 `http://localhost:8080`

### 方式 3：Node.js
```bash
npx serve 码头Demo
```

## 功能演示

- **天空 + 海面**：`Sky` + `Water` 真实海天效果
- **3 台岸桥 (QC)**：程序化几何体，小车 + 吊具自动往复作业
- **4 个堆场**：A/B/C/D 区，每区数百个集装箱（`InstancedMesh` 批量渲染）
- **5 辆 AGV**：沿 `CatmullRomCurve3` 闭环路径自动行驶，带发光路径线
- **自动巡航相机**：点击左上角按钮切换"自动巡航 / 手动查看"
- **CSS2D 标签**：堆场名称悬浮在 3D 场景中，跟随相机
- **Bloom 后处理**：发光路径、吊具自发光
- **PBR + 阴影**：DirectionalLight + PCFSoftShadowMap

## 替换为真实模型

把代码里 `buildCrane()` / `buildAGV()` 程序化几何替换成 `GLTFLoader` 加载即可：

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
loader.load('models/crane.glb', gltf => {
  const crane = gltf.scene;
  crane.position.set(-220, 0, 30);
  crane.traverse(o => o.isMesh && (o.castShadow = true));
  scene.add(crane);
});
```

## 接入实时数据

```js
const ws = new WebSocket('ws://your-server/twin');
ws.onmessage = e => {
  const data = JSON.parse(e.data);
  // 例如更新 AGV 真实坐标
  agvs[data.id].mesh.position.set(data.x, 0, data.z);
};
```

## 性能优化方向

- 集装箱已用 `InstancedMesh`（约 250-380 个箱子，1 次 draw call）
- 远景可加 LOD：远处堆场降级为 billboard 贴图
- `.glb` 用 Draco/Meshopt 压缩
- 阴影范围用级联（CSM）替代固定正交相机
