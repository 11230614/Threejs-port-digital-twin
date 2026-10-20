// ============================================================================
// GroundSystem.js —— 地面系统（Ground System：海、岸、场、路的场景搭建总承包）
//
// 【这个文件干什么】
// 把一片空场地变成一个码头。它按顺序造出：
//   海水 → 浪花 → 浮标 → 码头地坪 → 护舷与系船柱
//   → 堆场（调用 YardSystem）→ 堆场路网（调用 RoadSystem）→ AGV 巡航环线
// create() 一口气跑完全部步骤，返回一份"场景清单"给上层。
//
// 【它与 YardSystem / RoadSystem 的分工】
//   YardSystem  只管"箱子的数据台账"，不知道自己在哪个码头
//   RoadSystem  只管"路怎么画、怎么导航"，不知道路是给谁修的
//   GroundSystem 才是那个知道"这个码头长什么样"的角色——
//     它决定堆场分几个区、每区多大、留多宽的路，然后把参数喂给上面两位。
// 所以本文件里全是具体数字与布局决策，而那两个文件里全是通用算法。
//
// 【最值得注意的一段：_createTerminalYards 的自适应布局】
// 堆场不是把箱区硬摆在写死的坐标上，而是反过来算：
//   码头总宽多少 → 减掉两侧环路 → 剩下的宽度够放几个箱区模块 →
//   模块之间的路能留多宽（够宽就留宽的，不够就压缩到安全最小值）→
//   实在放不下就砍掉最右边那个模块
// 这样改一个配置里的 terminalWidth，整个堆场会自己重排，
// 不必手工调几十个坐标。代价是这段代码的算术密度很高。
//
// 【程序化纹理：本文件后半段全是画画】
// 混凝土、水面法线、浪花、法线贴图，全都用 canvas（画布）现场画出来，
// 不加载任何图片文件。好处是零网络请求、零包体积、分辨率随时可调；
// 代价是启动时要花几十毫秒画图。
//
// 【本文件含有三段死代码（dead code）】
//   _createLegacyContainerYard  —— 旧版堆场，已被 YardSystem 取代
//   _createRoadMarks            —— 旧版路面标线，已被 RoadSystem 取代
//   _createContainerYard 里第一行 return 之后的整段
//   _buildContainerBlock / _createRandomContainerModel（仅被死代码调用）
// 它们没有任何调用点，保留着大概是为了对比参考。相关位置都已标注，
// 后续重构可以整段删除。
//
// 【术语翻译】
//   Ground（地面）        dock（码头地坪）      fender（护舷）
//   bollard（系船柱）     buoy（浮标）          foam（浪花泡沫）
//   Water（Three.js 的水面对象）
//   uniforms（着色器全局变量）
//   terminal（码头、场站）  zone（作业区）      module（箱区模块）
//   pitch（间距）          clearance（净空、退让距离）
//   TEU（标准箱当量，二十英尺集装箱的计量单位）
//   CSS2DObject（贴在三维位置上的 HTML 标签）
//   project（把世界坐标投影成屏幕坐标）
//   NDC（归一化设备坐标，范围 -1 ~ 1）
//   diffuse / roughness / normal map（漫反射 / 粗糙度 / 法线贴图）
//   luminance（亮度）      gradient（渐变）      anisotropy（各向异性过滤）
//   ImageData（画布的原始像素数据）
//   emissive（自发光）     depthWrite（写入深度缓冲）
//   InstancedMesh（实例化网格）
//   String.fromCharCode（由字符编码取字符，此处用来生成 A、B、C 区名）
// ============================================================================

// 导入 Three.js 全量命名空间
import * as THREE from "three";
// CSS2DObject（二维 HTML 标签对象）：把一个 div 挂在三维坐标上，
// 用于堆场区名的悬浮标签。它不是三维物体，而是由 CSS 定位的真实 DOM
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
// Water（水面）：Three.js 官方示例里的水面着色器，
// 自带反射、折射与波纹动画。自己写这套效果要几百行着色器代码
import { Water } from "three/examples/jsm/objects/Water.js";
// 导入三份空间配置：AGV 环线、集装箱尺寸、堆场布局
import {
  PORT_AGV_LOOP_CONFIG,
  PORT_CONTAINER_LAYOUT_CONFIG,
  PORT_YARD_LAYOUT_CONFIG,
} from "../config/PortSpatialConfig.ts";
// 导入道路系统与堆场系统——本文件是它们的使用者
import { RoadSystem } from "./RoadSystem.ts";
import { YardSystem } from "./YardSystem.ts";
import type { ContainerLayout } from "./YardSystem";
import type { YardSlotInput } from "./RoadSystem";

interface GroundSystemOptions {
  modelAssetManager?: { clone(id: string): THREE.Object3D } | null;
  containerAssetIds?: readonly string[];
  camera?: THREE.Camera | null;
  containerLayout?: ContainerLayout;
  yardLayout?: typeof PORT_YARD_LAYOUT_CONFIG;
  agvLoopLayout?: typeof PORT_AGV_LOOP_CONFIG;
}

interface GroundYardLayout {
  moduleColumns: number;
  rows: number;
  layers: number;
  modulesPerZone: number;
  requestedZoneColumns: number;
  zoneRows: number;
  terminalCenterX: number;
  terminalCenterZ: number;
  terminalWidth: number;
  preferredModuleRoadWidth: number;
  minimumModuleRoadWidth: number;
  zoneRoadWidth: number;
  outerRoadWidth: number;
  gap: ContainerLayout["gap"];
}

interface GroundYard {
  id?: string;
  x: number;
  z: number;
  name: string;
  moduleCenters?: number[];
  targetCount?: number;
  labelHeight?: number;
  count?: string;
  blockSize?: { x: number; y: number; z: number };
}

interface GroundLayoutResult extends GroundYardLayout {
  zoneColumns: number;
  zoneCount: number;
  moduleWidth: number;
  moduleDepth: number;
  moduleRoadWidth: number;
  requestedModulesAcross: number;
  modulesAcross: number;
  removedBlocks: number;
  containerCount: number;
}

interface GroundYardResult {
  yards: GroundYard[];
  containerCount: number;
  slots: GroundRoadSlot[];
  layout: GroundLayoutResult;
}

interface GroundRoadSlot extends YardSlotInput {
  blockId: string;
  xIndex: number;
  zIndex: number;
}

interface GroundCreateResult {
  dock: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  water: Water | null;
  yards: GroundYard[];
  containerCount: number;
  yardSystem: YardSystem | null;
  yardLayout: GroundLayoutResult;
  roadNetwork: ReturnType<RoadSystem["createYardNetwork"]>;
  roadSystem: RoadSystem | null;
  agvRoadId: string;
  agvLaneId: string | undefined;
}

interface GroundDisposable { dispose?: () => void }
interface GroundLabelCandidate {
  label: CSS2DObject;
  x: number;
  y: number;
  z: number;
  distance: number;
}

// export（导出）class（类）：声明并公开"地面系统"
export class GroundSystem {
  readonly scene: THREE.Scene;
  readonly modelAssetManager: GroundSystemOptions["modelAssetManager"];
  readonly containerAssetIds: readonly string[];
  readonly camera: THREE.Camera | null;
  private readonly labelRenderer?: { domElement: HTMLElement };
  readonly containerLayout: ContainerLayout;
  readonly yardLayout: typeof PORT_YARD_LAYOUT_CONFIG;
  readonly agvLoopLayout: typeof PORT_AGV_LOOP_CONFIG;
  yardSystem: YardSystem | null;
  roadSystem: RoadSystem | null;
  water: Water | null;
  foamTexture: THREE.CanvasTexture | null;
  buoys: THREE.Group[];
  yardLabels: CSS2DObject[];
  created: boolean;
  destroyed: boolean;
  private _createResult: GroundCreateResult | null;
  private _ownedObjects: Set<THREE.Object3D>;
  private _ownedResources: Set<GroundDisposable>;
  private _roadRoot: THREE.Group | null;

  // constructor（构造函数）：scene（场景根节点）+ options（可选配置）
  constructor(scene: THREE.Scene, options: GroundSystemOptions = {}) {
    this.scene = scene;
    // 模型资源管理器。默认 null（空）——纯几何体兜底也能跑，
    // 这让本系统在没有加载任何模型时仍可用于快速调试
    this.modelAssetManager = options.modelAssetManager ?? null;
    // 可用的集装箱模型编号列表，转交给 YardSystem 做随机外观
    this.containerAssetIds = options.containerAssetIds ?? [];
    // 相机。标签遮挡剔除要用它做投影计算
    this.camera = options.camera ?? null;
    // 三份布局配置，都允许外部覆盖，默认取全局配置。
    // 【为什么要留覆盖口】测试与"小规模预览"场景需要把堆场缩小十倍，
    // 改全局配置会影响正式场景，从这里注入才互不干扰
    this.containerLayout = options.containerLayout ?? PORT_CONTAINER_LAYOUT_CONFIG;
    this.yardLayout = options.yardLayout ?? PORT_YARD_LAYOUT_CONFIG;
    this.agvLoopLayout = options.agvLoopLayout ?? PORT_AGV_LOOP_CONFIG;
    // 下面几个都是 create() 过程中才填的字段。
    // 【为什么要在构造函数里先声明成 null】JS 不强制声明字段，
    // 但先列出来等于给读者一份"这个类到底持有什么"的清单，
    // 也避免后面某处误用了未定义的字段却毫无提示
    this.yardSystem = null;
    this.roadSystem = null;
    this.water = null;
    // foamTexture（浪花纹理）：update 里要滚动它的 offset 制造流动感
    this.foamTexture = null;
    // buoys（浮标列表）：update 里要逐个做浮沉摆动
    this.buoys = [];
    // yardLabels（堆场标签列表）：遮挡剔除要遍历它
    this.yardLabels = [];
    // 生命周期状态：create 成功后返回同一份清单，destroy 后禁止再次建场。
    this.created = false;
    this.destroyed = false;
    this._createResult = null;
    this._ownedObjects = new Set();
    this._ownedResources = new Set();
    this._roadRoot = null;
  }

  // create（搭建整个地面场景）：本系统的唯一入口，顺序执行全部步骤
  create(): GroundCreateResult {
    if (this.destroyed) {
      throw new Error("GroundSystem has been destroyed");
    }
    if (this.created && this._createResult) {
      return this._createResult;
    }

    const initialChildren = new Set(this.scene.children);
    try {
    // ---- 水域部分（三步，彼此独立，顺序无所谓）----
    this._createWater();
    this._createFoam();
    this._createBuoys();
    // ---- 陆地部分 ----
    // 码头地坪。返回值要传给上层（相机的地面拾取、阴影配置都要用它）
    const dock = this._createDock();
    // 护舷与系船柱
    this._createFender();
    // 道路系统必须在堆场之前建好——下面 _createYardRoads 要用它。
    // 【为什么不在构造函数里建】RoadSystem 一建就会往场景里加节点，
    // 而本类允许"建好但先不 create"的用法（例如只想拿它算布局参数）
    this.roadSystem = new RoadSystem(this.scene);
    this._roadRoot = this.roadSystem.group ?? null;
    // 建堆场。返回箱位清单、区名列表、布局参数
    const yardResult = this._createContainerYard();
    if (!("slots" in yardResult) || !("layout" in yardResult)) {
      throw new Error("GroundSystem legacy yard implementation is not supported");
    }
    // 建堆场路网。
    // 【严格的依赖顺序】路是从箱位的空隙里推导出来的，
    // 所以必须等堆场建完、拿到 slots 才能建路。
    // 顺序颠倒的话 createYardNetwork 会拿到空的箱位清单，
    // 推不出任何条带，整个路网为空，车全靠直线兜底行驶
    const roadResult = this._createYardRoads(
      yardResult.slots,
      yardResult.layout,
    );
    // AGV 巡航环线要绕在堆场路网外面，所以它依赖路网的边界
    const agvRoad = this._createAGVRoad(roadResult.network.bounds);

    // 汇总返回。上层（PortRuntime）拿这份清单去装配其余系统
    const result = {
      dock,
      water: this.water,
      yards: yardResult.yards,
      containerCount: yardResult.containerCount,
      // 把 YardSystem 实例本身交出去。
      // 【为什么把实例给出去而不只给数据】集装箱系统要直接调它的
      // releaseContainer 等方法，只给数据快照就没法改状态了
      yardSystem: this.yardSystem,
      yardLayout: yardResult.layout,
      roadNetwork: roadResult.network,
      roadSystem: this.roadSystem,
      agvRoadId: agvRoad.id,
      // 只取主车道。AGV 环线有两条车道（一正一反），
      // 上层默认用第一条
      agvLaneId: agvRoad.laneIds[0],
    };
    this._ownedObjects = new Set(
      this.scene.children.filter(
        (object) => !initialChildren.has(object) && object !== this._roadRoot,
      ),
    );
    this._collectOwnedResources();
    this._createResult = result;
    this.created = true;
    return result;
    } catch (error) {
      this._rollbackCreate(initialChildren);
      throw error;
    }
  }

  // destroy（销毁）：只清理本系统直接创建并拥有的节点与资源。
  // RoadSystem 的节点由它自己拥有，本系统只在本次创建失败/销毁时移除根节点，
  // 不猜测并释放道路内部的共享几何体与材质。
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this._detachOwnedObjects();
    this._disposeOwnedResources();
    if (this._roadRoot?.parent) this._roadRoot.parent.remove(this._roadRoot);
    this._resetRuntimeReferences();
  }

  private _rollbackCreate(initialChildren: Set<THREE.Object3D>): void {
    const createdRoots = this.scene.children.filter((object) => !initialChildren.has(object));
    const roadRoot = this.roadSystem?.group ?? this._roadRoot;
    this._ownedObjects = new Set(createdRoots.filter((object) => object !== roadRoot));
    this._collectOwnedResources();
    this._detachOwnedObjects();
    this._disposeOwnedResources();
    if (roadRoot?.parent) roadRoot.parent.remove(roadRoot);
    this._resetRuntimeReferences();
    this.created = false;
    this.destroyed = false;
    this._createResult = null;
  }

  private _resetRuntimeReferences(): void {
    this.yardSystem = null;
    this.roadSystem = null;
    this.water = null;
    this.foamTexture = null;
    this.buoys = [];
    this.yardLabels = [];
    this._roadRoot = null;
    this._ownedObjects.clear();
    this._ownedResources.clear();
  }

  private _detachOwnedObjects(): void {
    this._ownedObjects.forEach((object) => {
      if (object.parent) object.parent.remove(object);
    });
  }

  private _collectOwnedResources(): void {
    const resources = this._ownedResources;
    const collectMaterial = (material: THREE.Material | null | undefined): void => {
      if (!material) return;
      resources.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) resources.add(value);
      });
      const uniforms = material instanceof THREE.ShaderMaterial ? material.uniforms : undefined;
      Object.values(uniforms ?? {}).forEach((uniform) => {
        if (uniform?.value instanceof THREE.Texture) resources.add(uniform.value);
      });
    };
    this._ownedObjects.forEach((root) => {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.geometry?.dispose) resources.add(object.geometry);
        const material = object.material;
        if (Array.isArray(material)) material.forEach(collectMaterial);
        else collectMaterial(material);
      });
    });
  }

  private _disposeOwnedResources(): void {
    this._ownedResources.forEach((resource) => {
      if (typeof resource.dispose !== "function") return;
      try {
        resource.dispose();
      } catch (error) {
        // 释放失败不能覆盖 create() 的原始异常，也不能阻止其余资源继续释放。
        console.error("GroundSystem resource disposal failed", error);
      }
    });
  }

  // update（每帧更新）：本系统只有三样东西需要动画
  //   dt（本帧耗时，秒）、elapsedTime（累计运行时长，秒）
  update(dt: number, elapsedTime: number): void {
    if (this.water) {
      // 推进水面着色器的时间变量。
      // 【为什么用 += dt 而不是 = elapsedTime】水面的 time 是着色器内部
      // 用来算波形相位的，累加 dt 使得暂停仿真时波纹也跟着停；
      // 直接赋 elapsedTime 的话即便暂停了水面还在动，看起来很割裂
      this.water.material.uniforms.time.value += dt;
    }

    if (this.foamTexture) {
      // 让浪花纹理沿 X 方向滚动，制造"泡沫顺着岸边流动"的效果。
      // % 1（对 1 取模）把偏移量循环限制在一个纹理周期内。
      // 【为什么必须取模】offset 若无限增大，几小时后会大到浮点精度
      // 无法表示小数变化，纹理会卡住不动甚至开始抖动
      this.foamTexture.offset.x = (elapsedTime * 0.04) % 1;
    }

    this.buoys.forEach((buoy) => {
      // 三条正弦/余弦曲线叠出浮标的漂浮感：上下浮沉 + 左右摇 + 前后摇。
      // 三条曲线的频率各不相同（0.8 / 0.6 / 0.5），
      // 【为什么要用不同频率】若三者同频，浮标的运动会呈现明显的
      // 周期性"机械感"；错开频率后合成运动的周期变得很长，看起来自然
      buoy.position.y = Math.sin(elapsedTime * 0.8 + buoy.userData.phase) * 0.4;
      buoy.rotation.z = Math.sin(elapsedTime * 0.6 + buoy.userData.phase) * 0.08;
      buoy.rotation.x = Math.cos(elapsedTime * 0.5 + buoy.userData.phase) * 0.06;
      // 每个浮标各有一个随机的 phase（相位），保证它们不会齐步走
    });

  }

  // updateLabels（更新标签可见性）：单独一个方法而非放进 update。
  // 【为什么要分开】标签遮挡剔除要做投影计算，成本比水面动画高得多，
  // 上层把它挂在一个较低频率的帧任务上（不必每帧都算），
  // 而 update 必须每帧跑。分成两个方法才能分开调度
  updateLabels(): void {
    this._updateYardLabelVisibility();
  }

  // _createWater（内部方法：建水面）
  // 注意本方法体的缩进与文件其余部分不一致（少两格），是历史遗留的格式问题，
  // 不影响运行
  private _createWater(): void {
  // 先生成水面的法线纹理（决定波纹的细节形状）
  const waterNormals = this._createWaterNormalTexture();

  const water = new Water(
    // 5000×5000 米的巨大平面，分成 64×64 个网格。
    // 【为什么要分段而不是一整块】水面着色器需要顶点来做起伏，
    // 单段平面只有四个角点，波浪无从体现
    new THREE.PlaneGeometry(5000, 5000, 64, 64),
    {
      // 反射贴图的分辨率。1024 是清晰度与显存的折中，
      // 调到 2048 水面倒影会更锐利但显存占用翻四倍
      textureWidth: 1024,
      textureHeight: 1024,
      waterNormals,

      // 调整太阳方向，避免高光正对相机
      // 方向向量要 normalize（归一化）：着色器假定它是单位向量，
      // 不归一化会让高光强度整体偏移
      sunDirection: new THREE.Vector3(
        -0.3,
        1.0,
        -0.5
      ).normalize(),

      // 最关键：降低太阳高光亮度
      // 0x020202 几乎是纯黑——等于把镜面高光彻底关掉。
      // 默认值会在水面上留下一大片刺眼的白斑，把码头设施都盖住了
      // 港口场景不使用太阳镜面高光；过强的 Water specular 会在远处
      // 形成孤立的白色高亮点（尤其在法线纹理滚动时更明显）。
      sunColor: 0x000000,

      // 水体本身的颜色（深蓝偏青）
      waterColor: 0x0a4059,

      // 降低倒影扭曲和亮斑扩散
      distortionScale: 1.8,

      // alpha（不透明度）：0.95 留一点透明，让水下的地坪边缘微微透出来
      alpha: 0.95,
      // 参与场景雾效，让远处的海面融进天空
      fog: true,
    }
  );

  // 躺平到水平面
  water.rotation.x = -Math.PI / 2;
  // 沉到 -0.2 米：略低于地面（0），确保岸线处是"地压着水"
  // 而不是两者共面闪烁。Z 偏移 250 让水域主体位于码头前方
  water.position.set(0, -0.2, 250);

  // 降低波纹密度
  // size 越小波纹越大越舒缓。默认值在这个尺度的场景里会显得像小水塘
  water.material.uniforms.size.value = 3;

  this.scene.add(water);
  this.water = water;
}

  // _createFoam（内部方法：建岸边浪花）
  // 做法是画一条"上下透明、中间发白"的渐变纹理，
  // 贴在一条长条平面上沿岸线铺开，再靠 update 滚动纹理制造流动感
  private _createFoam(): void {
    // 1024×64 的细长画布，与要贴的长条平面比例一致
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    // createLinearGradient（线性渐变）：从上边缘(0,0)到下边缘(0,64)
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    // 四个色标构成"透明 → 白 → 淡蓝 → 透明"的横向条带。
    // 两端都是全透明，这样浪花与海面、与岸线的交界处不会有硬边
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    // 0.4 处最白（浪花最厚的地方），刻意偏上一点而非居中，
    // 让浪花看起来是"从岸边往外扑"的
    gradient.addColorStop(0.4, "rgba(255,255,255,0.85)");
    // 0.7 处转成淡蓝：泡沫散开后混进海水的颜色
    gradient.addColorStop(0.7, "rgba(220,240,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1024, 64);

    // 再撒 400 个半透明白圆点，制造泡沫的颗粒感。
    // 纯渐变太规整，看起来像一条丝带而不是浪花
    for (let i = 0; i < 400; i += 1) {
      // 透明度随机（0~0.5），让泡沫有深浅层次
      context.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
      context.beginPath();
      // arc（画圆弧）：半径 1~4 像素的小圆
      context.arc(
        Math.random() * 1024,
        Math.random() * 64,
        1 + Math.random() * 3,
        0,
        // 0 到 2π 是整圆
        Math.PI * 2,
      );
      context.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    // 只设 wrapS（横向重复）。
    // 【为什么不设 wrapT】纵向不需要重复——那个方向就是渐变本身，
    // 重复了会在长条中间出现一道突变的接缝
    texture.wrapS = THREE.RepeatWrapping;
    // 横向平铺 8 次，把 1024 像素的图案压缩成更细密的浪花
    texture.repeat.set(8, 1);

    const foam = new THREE.Mesh(
      // 1200 米长、8 米宽的长条，沿岸线铺开
      new THREE.PlaneGeometry(1200, 8),
      new THREE.MeshBasicMaterial({
        map: texture,
        // transparent（启用透明混合）：必须开，否则纹理里的
        // alpha 通道被忽略，浪花会变成一整条不透明的白带
        transparent: true,
        // depthWrite（写入深度缓冲）关掉。
        // 【这一行很关键】浪花贴在水面上方，若它写入深度，
        // 会遮住后面本该透出来的水面波纹，出现一条"挖空"的痕迹。
        // 半透明物体通常都要关掉深度写入
        depthWrite: false,
        opacity: 0.9,
      }),
    );
    foam.rotation.x = -Math.PI / 2;
    // Y 取 0.1（略高于水面 -0.2），Z 取 36（正好在岸线外侧）
    foam.position.set(0, 0.1, 36);
    this.scene.add(foam);
    // 存下纹理引用，update 里要滚动它
    this.foamTexture = texture;
  }

  // _createBuoys（内部方法：建航道浮标）
  private _createBuoys(): void {
    // 四个浮标的位置，手工指定成不规则分布——
    // 均匀排列会显得像人工标桩而不是航道浮标
    const points = [
      [-280, 180],
      [-100, 240],
      [120, 200],
      [320, 260],
    ];

    // map（映射）而非 forEach：要把生成的 Group 收进 this.buoys 供动画使用
    this.buoys = points.map(([x, z]) => {
      // 每个浮标是一个 Group（分组）：锥形浮体 + 顶部灯。
      // 套一层 Group 让整体的浮沉与摇摆只需改一个节点的变换
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        // ConeGeometry（圆锥）：底半径 2.2、高 6、圆周分 12 段。
        // 12 段在这个尺寸与观看距离下已经看不出棱角，再多纯属浪费顶点
        new THREE.ConeGeometry(2.2, 6, 12),
        new THREE.MeshStandardMaterial({
          // 航标红
          color: 0xff2a2a,
          // emissive（自发光）：给一点暗红的自发光，
          // 让浮标在阴影里也不会黑成一团
          emissive: 0x441000,
          emissiveIntensity: 0.3,
          roughness: 0.6,
        }),
      );
      // 抬高 1.5 让锥底大致落在水面上（锥的原点在几何中心）
      body.position.y = 1.5;
      group.add(body);

      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 10, 8),
        new THREE.MeshStandardMaterial({
          color: 0xff7a22,
          emissive: 0x7a2208,
          // 自发光强度 1.5（大于 1）：配合泛光后处理（bloom）
          // 会在灯周围晕出光圈，夜景里很显眼
          emissiveIntensity: 0.45,
        }),
      );
      light.position.y = 5;
      group.add(light);

      group.position.set(x, 0, z);
      // phase（相位）：给每个浮标一个 0~2π 的随机初相。
      // 【这是浮标动画自然感的全部来源】没有它，四个浮标会
      // 完全同步地上下起伏，像被同一根绳子牵着。
      // 存在 userData（用户自定义数据）里——这是 Three.js 约定的
      // "往对象上挂业务数据"的地方
      group.userData.phase = Math.random() * Math.PI * 2;
      this.scene.add(group);
      return group;
    });
  }

  // _createDock（内部方法：建码头地坪）
  private _createDock(): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
    // 先生成混凝土的三张贴图（漫反射 / 粗糙度 / 法线）
    const textureSet = this._createConcreteTextures();
    const material = new THREE.MeshStandardMaterial({
      map: textureSet.map,
      // roughnessMap（粗糙度贴图）：让地面局部油污处更光滑、
      // 干燥处更粗糙，这种不均匀是真实感的关键
      roughnessMap: textureSet.roughnessMap,
      // normalMap（法线贴图）：用像素编码的法线扰动制造凹凸感，
      // 不增加任何顶点却能看出水泥的粗糙表面
      normalMap: textureSet.normalMap,
      // normalScale（法线强度）：0.6 削弱一点。
      // 程序化生成的法线图对比度偏高，取 1 会让地面看起来像揉皱的纸
      normalScale: new THREE.Vector2(0.6, 0.6),
      // roughness 取 1（全粗糙）：实际粗糙度由 roughnessMap 逐像素决定，
      // 这个基值会与贴图相乘，取 1 等于"完全交给贴图"
      roughness: 1,
      metalness: 0,
    });
    // BoxGeometry（立方体）而不是平面。
    // 【为什么用有厚度的盒子】码头地坪有 4 米厚，侧面要能看到断面；
    // 用平面的话从侧面看是一张纸，岸壁就不存在了
    const dock = new THREE.Mesh(new THREE.BoxGeometry(1200, 4, 420), material);
    // 下沉 2 米（盒子高 4，原点在中心），使顶面正好落在 y=0
    dock.position.set(0, -2, -90);
    // 只接收阴影不投射。地坪是最底层的承载面，
    // 它自己往哪儿投影都看不见，开了纯属浪费阴影贴图的分辨率
    dock.receiveShadow = true;
    // 命名便于上层按名字找到它（相机的地面拾取要用）
    dock.name = "dock-ground";
    this.scene.add(dock);
    return dock;
  }

  // _createFender（内部方法：建护舷与系船柱）
  private _createFender(): void {
    const fender = new THREE.Mesh(
      // 一条贯通整个岸线的黑色橡胶护舷条
      new THREE.BoxGeometry(1200, 1.2, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.7 }),
    );
    // Z 取 30.5：贴在岸线（约 z=30）外缘
    fender.position.set(0, 0.4, 30.5);
    // 护舷两个阴影开关都开：它凸出于岸壁，会在地面投下细影，
    // 这道影子是"岸边有东西"的重要视觉线索
    fender.castShadow = true;
    fender.receiveShadow = true;
    this.scene.add(fender);

    // 每 112 米一个系船柱，从 -560 到 560 共 11 个。
    // 【为什么用 for 循环而不是列一张坐标表】等距分布用循环表达最清楚，
    // 而且改间距只需动一个数字
    for (let x = -560; x <= 560; x += 112) {
      const bollard = new THREE.Mesh(
        // CylinderGeometry（圆柱）：上半径 1.2 小于下半径 1.5，
        // 形成微微的锥度——真实系船柱都是这个形状，
        // 上粗下细会让缆绳滑脱
        new THREE.CylinderGeometry(1.2, 1.5, 3, 12),
        // 米黄色，roughness 0.7 表现刷漆的铸铁
        new THREE.MeshStandardMaterial({ color: 0xfff2a8, roughness: 0.7 }),
      );
      // Y 取 1.5（柱高 3，原点在中心）使柱底落在地面
      bollard.position.set(x, 1.5, 28);
      bollard.castShadow = true;
      bollard.receiveShadow = true;
      this.scene.add(bollard);
    }
  }

  // ==========================================================================
  // 【死代码区间开始】_createRoadMarks 与 _createLegacyContainerYard
  // 这两个方法在全项目里都没有调用点，功能已分别被 RoadSystem 的
  // 标线系统与 YardSystem + ContainerRenderManager 取代。
  // 保留它们只作历史参考，后续重构可整段删除。
  // 下面仍逐行注释，是因为它们里面有若干值得知道的技法。
  // ==========================================================================

  // _createRoadMarks（旧版路面标线）—— 死代码，无调用点
  private _createRoadMarks(): void {
    // 内联工具函数：画一条横贯全场的标线
    const paintLine = (color: THREE.ColorRepresentation, width: number, z: number, opacity = 0.85) => {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(820, width),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          transparent: true,
          opacity,
          // polygonOffset（多边形偏移）：这是解决 z-fighting（深度冲突）
          // 的另一条路子——不改物体位置，而是让显卡在做深度比较时
          // 给这个物体的深度值加一个小偏移。
          // 负的 Factor 表示"往靠近相机的方向偏"，于是标线总能压在地面之上。
          // 【与本项目主流做法的区别】RoadSystem 用的是抬高 Y 坐标，
          // 更直观也更可控；polygonOffset 的实际偏移量由显卡决定，
          // 不同硬件表现可能有差异
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.05, z);
      line.receiveShadow = true;
      this.scene.add(line);
    };

    // 四条实线：白、黄、黄、白，分隔不同的作业区
    paintLine(0xffffff, 0.6, -260);
    paintLine(0xffd84a, 0.6, -180);
    paintLine(0xffd84a, 0.6, -10);
    paintLine(0xffffff, 0.6, 10);

    // 一排黄色虚线。
    // 【这里有一处值得学的写法】几何体与材质都在循环外只建一份，
    // 循环里所有 dash 共用它们。Three.js 允许多个 Mesh 共享同一份
    // 几何体与材质，共享后显存只占一份、材质切换也只发生一次
    const dashGeometry = new THREE.PlaneGeometry(6, 0.5);
    const dashMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd84a,
      roughness: 0.6,
    });
    for (let x = -400; x <= 400; x += 14) {
      const dash = new THREE.Mesh(dashGeometry, dashMaterial);
      dash.rotation.x = -Math.PI / 2;
      // Y 取 0.06，比上面的实线（0.05）再高一点，避免相交处闪烁
      dash.position.set(x, 0.06, -125);
      this.scene.add(dash);
    }
  }

  // _createLegacyContainerYard（旧版堆场）—— 死代码，无调用点。
  // 它用一个 InstancedMesh 直接画出所有箱子，没有任何数据台账，
  // 所以箱子无法被选中、无法被搬运，只是"看起来像个堆场"。
  // 现版本改用 YardSystem（数据）+ ContainerRenderManager（渲染）分离的架构
  private _createLegacyContainerYard(): { yards: GroundYard[]; containerCount: number } {
    const geometry = new THREE.BoxGeometry(12, 2.6, 2.4);
    // translate（平移几何体本身）：把原点从几何中心挪到底面中心。
    // 【为什么在几何体层面平移而不是在 Mesh 上】下面用实例化矩阵摆放时，
    // 矩阵只有一个平移量；若原点在中心，每个实例都要额外加半个箱高。
    // 把偏移烘进几何体，摆放坐标就能直接用"箱底该在哪儿"
    geometry.translate(0, 1.3, 0);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
    });
    // palette（调色板）：七种集装箱常见涂装色
    const palette = [
      0xc94a4a,
      0x3a78c9,
      0x4aa05a,
      0xd6a14a,
      0x6c4ac9,
      0xc94a9a,
      0x2cb5a8,
    ];
    // 四个箱区，坐标与 TEU 数量都是写死的
    const yards: GroundYard[] = [
      { x: -330, z: -220, name: "A 区", count: "128 TEU" },
      { x: -110, z: -220, name: "B 区", count: "96 TEU" },
      { x: 110, z: -220, name: "C 区", count: "112 TEU" },
      { x: 330, z: -220, name: "D 区", count: "80 TEU" },
    ];

    // max（实例容量上限）：4 区 × 6 排 × 4 列 × 4 层。
    // 【为什么要预先算上限】InstancedMesh 的容量在创建时就固定了，
    // 之后无法扩容。按最大可能值申请，实际用多少由下面的 mesh.count 决定
    const max = yards.length * 6 * 4 * 4;
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // instanceColor（逐实例颜色）：手工建一个缓冲属性。
    // 每个实例三个浮点数（RGB），所以长度是 max * 3。
    // 有了它才能让同一个 InstancedMesh 里的箱子颜色各不相同——
    // 否则一万个箱子只能是同一种颜色
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(max * 3),
      3,
    );

    // 循环外建好复用的矩阵与颜色对象，避免循环里产生几百个临时对象
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let index = 0;

    yards.forEach((yard) => {
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          // stack（这一柱堆几层）：2~4 层随机。
          // 随机的堆高让堆场轮廓参差不齐，比整齐的方块阵真实
          const stack = 2 + Math.floor(Math.random() * 3);
          for (let level = 0; level < stack; level += 1) {
            // makeTranslation（构造纯平移矩阵）：比 compose 更省，
            // 因为这些箱子都不旋转不缩放
            matrix.makeTranslation(
              yard.x - 36 + row * 14,
              level * 2.6,
              yard.z - 6 + col * 3.2,
            );
            mesh.setMatrixAt(index, matrix);
            // 从调色板随机取色
            color.setHex(palette[Math.floor(Math.random() * palette.length)]);
            mesh.setColorAt(index, color);
            index += 1;
          }
        }
      }

      this._addYardLabel(yard);
    });

    // 把实际使用的实例数告诉 Three.js。
    // 【少了这一行会怎样】mesh.count 保持为 max，
    // 那些没设过矩阵的实例会全部堆在原点（矩阵是全零），
    // 场景中心出现一坨黑色的方块
    mesh.count = index;
    // 同样必须置位 needsUpdate，否则矩阵不会上传显卡
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);

    return {
      yards,
      containerCount: index,
    };
  }

  // _createContainerYard（建堆场）
  // 【注意】本方法第一行就 return 了，后面全部是不可达的死代码。
  // 真正生效的只有这一行转发。下面那两大段是两代旧实现：
  //   第一段（大括号包起来的）—— 八个写死坐标的箱区
  //   第二段（return 之后的）—— 六列两行的网格布局
  // 现行实现是 _createTerminalYards 的自适应布局。
  // 后续重构应把 return 后的所有代码删除，只留转发
  private _createContainerYard(): GroundYardResult | { yards: GroundYard[]; containerCount: number } {
    return this._createTerminalYards();

    // ↓↓↓ 以下全部不可达（unreachable code）↓↓↓
    // 这个裸大括号块是把第一代实现整段"括起来"隔离的痕迹
    {
    // 第一代：八个箱区的坐标与目标箱数全部写死。
    // 【为什么被淘汰】改码头尺寸要手工重算八组坐标，
    // 而且箱区之间的路宽是隐含在坐标差里的，改一个就得全盘验算
    const yards: GroundYard[] = [
      { id: "YARD-A", x: -330, z: -220, name: "A 区", targetCount: 48 },
      { id: "YARD-B", x: -110, z: -220, name: "B 区", targetCount: 43 },
      { id: "YARD-C", x: 110, z: -220, name: "C 区", targetCount: 39 },
      { id: "YARD-D", x: 330, z: -220, name: "D 区", targetCount: 35 },
      { id: "YARD-E", x: -330, z: -170, name: "E 区", targetCount: 31 },
      { id: "YARD-F", x: -110, z: -170, name: "F 区", targetCount: 27 },
      { id: "YARD-G", x: 110, z: -170, name: "G 区", targetCount: 23 },
      { id: "YARD-H", x: 330, z: -170, name: "H 区", targetCount: 19 },
    ];

    // 注意这里给 YardSystem 传了 scene 与 modelAssetManager——
    // 现版本的 YardSystem 是纯数据的，根本不接这两个参数。
    // 这也印证了这段代码写于架构重构之前
    this.yardSystem = new YardSystem({ sourceAssetIds: [...this.containerAssetIds] });

    let index = 0;
    yards.forEach((yard) => {
      // 每区 4 排 4 列 3 层
      const block = this.yardSystem!.createCenteredBlock(4, 4, 3, yard.x, yard.z, {
        name: `${yard.name}-containers`,
        count: yard.targetCount,
        blockId: yard.id,
        area: yard.name,
      });
      // getSize 需要传接收向量，取出箱区的三维尺寸
      const blockSize = block.bounds.getSize(new THREE.Vector3());
      yard.count = `${block.count} TEU`;
      // 摊成普通对象存。
      // 【为什么不直接存 Vector3】这份数据会传给 Vue 界面层，
      // Vector3 被 Pinia 的响应式代理包装后内部属性访问会出问题
      yard.blockSize = {
        x: blockSize.x,
        y: blockSize.y,
        z: blockSize.z,
      };
      index += block.count;
      this._addYardLabel(yard);
    });

    return {
      yards,
      containerCount: index,
    };
    }

    // Terminal layout is a neat grid of container blocks separated by lanes.
    // `columns` = block centers on X (left group / central road / right group),
    // `rows` = front & back block centers on Z (transfer lane between them).
    // Tune `block` to trade visual density against draw calls.
    // 第二代：网格布局。原注释说明了三个数组的含义——
    // columns 是箱区在 X 上的中心（左组 / 中央大道 / 右组），
    // rows 是前后两排箱区在 Z 上的中心（中间夹一条转运通道），
    // 调 block 参数可以在"视觉密度"与"绘制调用数"之间权衡。
    // 【为什么也被淘汰】比第一代好在有规律，但坐标仍是写死的，
    // 换个码头尺寸还是要重算
    const columns = [-300, -195, -90, 90, 195, 300];
    const rows = [-192, -242];
    const block = {
      rows: 4, // stacks along X (container length axis)
      bays: 4, // stacks along Z (container width axis)
      // pitch（间距）：X 方向 13 米（箱长 12 + 1 米缝），
      // Z 方向 3.25 米（箱宽 2.4 + 缝）
      rowPitch: 13,
      bayPitch: 3.25,
      levelHeight: 2.65,
      // 堆高范围 2~4 层，随机取
      minStack: 2,
      maxStack: 4,
    };

    // Four named zones keep driving the asset panel / labels / task anchors.
    // They are mapped onto front-row block cells so labels sit on real stacks.
    // 原注释：四个命名区继续驱动资产面板、标签与任务锚点，
    // 它们被映射到前排的箱区格子上，好让标签落在真实的堆垛上
    const yards: GroundYard[] = [
      { x: columns[0], z: rows[0], name: "A 区", count: "128 TEU" },
      { x: columns[2], z: rows[0], name: "B 区", count: "96 TEU" },
      { x: columns[3], z: rows[0], name: "C 区", count: "112 TEU" },
      { x: columns[5], z: rows[0], name: "D 区", count: "80 TEU" },
    ];

    // 套一层 Group：这一代用真实模型摆箱子（不是实例化），
    // 上千个 Mesh 挂在一个分组下便于整体管理
    const yardGroup = new THREE.Group();
    yardGroup.name = "container-yard";
    let index = 0;

    // 双层遍历铺满 2×6 = 12 个箱区
    rows.forEach((centerZ) => {
      columns.forEach((centerX) => {
        index += this._buildContainerBlock(yardGroup, centerX, centerZ, block);
      });
    });

    this.scene.add(yardGroup);
    yards.forEach((yard) => this._addYardLabel(yard));

    return {
      yards,
      containerCount: index,
    };
  }
  // ==========================================================================
  // 【死代码区间结束】下面回到正在使用的代码
  // ==========================================================================

  // _createTerminalYards（现行实现：自适应堆场布局）
  //
  // 这是本文件算术密度最高的方法。它不写死任何坐标，而是从
  // "码头总宽"一路推导出每个箱区模块该摆在哪儿。
  //
  // 【三级结构】
  //   zone（作业区，对应界面上的 A 区 / B 区）
  //     └ module（箱区模块）—— 一个 zone 含 modulesPerZone 个模块
  //         └ container（集装箱）
  //
  // 【横向（X）的推导链】
  //   码头总宽 terminalWidth
  //     - 两侧外环路 outerRoadWidth × 2
  //     = 可用内部宽度 availableInteriorWidth
  //     ÷ (模块宽 + 最小路宽) → 最多能放几个模块 modulesAcross
  //   然后把剩余空间平摊成模块之间的路（但不超过 preferredModuleRoadWidth）
  //   放不下的模块直接砍掉（removedBlocks 记录砍了几个）
  //
  // 【纵向（Z）的推导链】
  //   zone 之间隔 zoneRoadWidth，整体以 terminalCenterZ 为中心对称分布
  private _createTerminalYards(): GroundYardResult {
    // 合并配置：堆场布局 + 集装箱之间的缝隙。
    // 展开成新对象而非直接改 this.yardLayout，避免污染共享配置
    const layout = { ...this.yardLayout, gap: this.containerLayout.gap };
    const { size, gap } = this.containerLayout;
    // moduleWidth（一个模块的宽度）：n 个箱子 + (n-1) 道缝。
    // 缝数比箱数少一是关键——首尾两侧不留缝，那是路的事
    const moduleWidth = layout.moduleColumns * size.x + (layout.moduleColumns - 1) * gap.x;
    // moduleDepth（一个模块的深度）：同理，沿 Z 方向
    const moduleDepth = layout.rows * size.z + (layout.rows - 1) * gap.z;
    // requestedModulesAcross（期望横向摆几个模块）= 期望的区数 × 每区模块数
    const requestedModulesAcross = layout.requestedZoneColumns * layout.modulesPerZone;
    // availableInteriorWidth（可用内部宽度）：总宽减掉两侧外环路
    const availableInteriorWidth = layout.terminalWidth - layout.outerRoadWidth * 2;
    // modulesAcross（实际能摆几个）：取"期望值"与"物理上限"的较小者
    const modulesAcross = Math.min(
      requestedModulesAcross,
      Math.floor(
        // 这个公式值得拆开看：
        //   n 个模块需要 n × moduleWidth + (n-1) × roadWidth 的空间
        //   解 n ≤ (available + roadWidth) / (moduleWidth + roadWidth)
        // 分子上加一个 roadWidth，正是为了补上"最后一个模块右边不需要路"
        // 这一项。少了它会少算一个模块的位置
        (availableInteriorWidth + layout.minimumModuleRoadWidth) /
        (moduleWidth + layout.minimumModuleRoadWidth),
      ),
    );
    // 连一个模块都放不下就是配置写错了，当场抛异常。
    // 【为什么不静默兜底】继续往下走会得到空堆场、空路网，
    // 然后车全靠直线兜底、任务全部失败，现象离原因太远
    if (modulesAcross < 1) {
      throw new Error("Terminal width cannot fit a single expanded container module.");
    }

    // The gap is reduced only to the configured safe minimum. If this still
    // cannot fit all requested modules, the rightmost module is omitted.
    // 原注释：路宽只会压缩到配置的安全最小值；若这样仍放不下全部模块，
    // 就省掉最右边那个模块。
    // moduleRoadWidth（模块之间的路宽）三层嵌套：
    //   只有一个模块时无所谓路宽（取 0）
    //   否则先把剩余空间平摊：(可用宽 - 模块总宽) / 间隔数
    //   与 preferred 取小（不要修得比需要的更宽，浪费场地）
    //   再与 minimum 取大（不能比安全下限更窄，车过不去）
    const moduleRoadWidth = modulesAcross > 1
      ? Math.max(
        layout.minimumModuleRoadWidth,
        Math.min(
          layout.preferredModuleRoadWidth,
          (availableInteriorWidth - modulesAcross * moduleWidth) / (modulesAcross - 1),
        ),
      )
      : 0;
    // modulePitchX（模块中心间距）= 模块宽 + 路宽
    const modulePitchX = moduleWidth + moduleRoadWidth;
    // 第一个模块的中心：从码头中心往左退半个总跨度。
    // (n-1) 而非 n，同 createCenteredBlock 里的道理——
    // 首尾中心之间只有 n-1 个间距
    const firstModuleCenterX =
      layout.terminalCenterX - ((modulesAcross - 1) * modulePitchX) / 2;
    // moduleGroups（把模块按 modulesPerZone 打包成组，一组就是一个 zone）
    const moduleGroups: Array<{ moduleStart: number; count: number; centerX: number; centers: number[] }> = [];
    for (let moduleStart = 0; moduleStart < modulesAcross; moduleStart += layout.modulesPerZone) {
      // count（本组实际含几个模块）：最后一组可能不满，用 Math.min 截断
      const count = Math.min(layout.modulesPerZone, modulesAcross - moduleStart);
      // 算出本组各模块的中心坐标
      const centers = Array.from(
        { length: count },
        (_, index) => firstModuleCenterX + (moduleStart + index) * modulePitchX,
      );
      moduleGroups.push({
        moduleStart,
        count,
        // 组的中心取各模块中心的算术平均。
        // 【为什么要算这个】区名标签要挂在整个区的正中间；
        // 若直接用第一个模块的中心，标签会偏到区的左侧
        centerX: centers.reduce((sum, x) => sum + x, 0) / count,
        centers,
      });
    }
    // zonePitchZ（作业区在 Z 上的间距）= 模块深 + 区间道路宽
    const zonePitchZ = moduleDepth + layout.zoneRoadWidth;
    // 各作业区行的 Z 中心，以 terminalCenterZ 为中心对称分布。
    // (index - (n-1)/2) 这个表达式是"居中分布"的标准写法：
    // n=2 时得到 -0.5、+0.5；n=3 时得到 -1、0、+1
    const zoneCentersZ = Array.from(
      { length: layout.zoneRows },
      (_, index) => layout.terminalCenterZ + (index - (layout.zoneRows - 1) / 2) * zonePitchZ,
    );
    const yards: GroundYard[] = [];

    // 双层遍历，行 × 组，生成每个作业区的描述
    zoneCentersZ.forEach((z, rowIndex) => {
      moduleGroups.forEach((group, columnIndex) => {
        // 把二维下标压成一维序号，用来生成 A、B、C……
        const index = rowIndex * moduleGroups.length + columnIndex;
        yards.push({
          // String.fromCharCode(65 + index)：65 是字母 A 的编码，
          // 于是 index 0→A、1→B、2→C。
          // 【局限】超过 26 个区就会跑到 '[' '\\' 这些符号上去。
          // 目前区数远小于 26，暂时无碍
          id: `YARD-${String.fromCharCode(65 + index)}`,
          x: group.centerX,
          z,
          name: `Yard ${String.fromCharCode(65 + index)}`,
          moduleCenters: group.centers,
          // 目标箱数 = 单模块满载量 × 本组模块数
          targetCount: layout.moduleColumns * layout.rows * layout.layers * group.count,
          // labelHeight（标签悬浮高度）：堆满时的箱堆顶再加 3 米，
          // 保证标签永远浮在箱子上方而不被埋进堆垛里
          labelHeight: size.y * layout.layers + 3,
        });
      });
    });

    // 现在才建 YardSystem。注意只传两个参数——它是纯数据系统，
    // 不需要 scene 也不需要模型管理器（对比上面死代码里的旧写法）
    this.yardSystem = new YardSystem({
      sourceAssetIds: [...this.containerAssetIds],
      containerLayout: this.containerLayout,
    });

    // slots（箱位清单）：攒起来交给 RoadSystem 推导路网
    const slots: GroundRoadSlot[] = [];
    let containerCount = 0;
    yards.forEach((yard) => {
      // 每个区自己的包围盒，逐模块 union（求并集）扩张
      const yardBounds = new THREE.Box3();
      let yardCount = 0;

      // 逐个模块建箱区数据
      const moduleCenters = yard.moduleCenters ?? [];
      for (let moduleIndex = 0; moduleIndex < moduleCenters.length; moduleIndex += 1) {
        const blockId = `${yard.id}-M${moduleIndex + 1}`;
        const moduleCenterX = moduleCenters[moduleIndex];
        const block = this.yardSystem!.createCenteredBlock(
          // 注意参数顺序：createCenteredBlock(rows, cols, layers, ...)
          // 这里传的是 moduleColumns 当 rows、layout.rows 当 cols。
          // 【看似颠倒其实正确】YardSystem 的 row 沿 X 排开、col 沿 Z 排开；
          // 而本文件的 moduleColumns 指的是"沿 X 方向有几列箱子"。
          // 两套命名的轴向约定不同，这里做的就是对齐
          layout.moduleColumns,
          layout.rows,
          layout.layers,
          moduleCenterX,
          yard.z,
          {
            name: `${blockId}-containers`,
            // 摆满
            count: layout.moduleColumns * layout.rows * layout.layers,
            blockId,
            area: yard.name,
          },
        );
        yardBounds.union(block.bounds);
        yardCount += block.count;

        // 把每个箱位摘成路网需要的最小形式。
        // 【为什么不直接把 record 传过去】RoadSystem 只需要 id 与包围盒，
        // 传整个 record 会让它意外依赖堆场的数据结构，
        // 将来改 record 的字段就会连带改坏路网
        block.containers.forEach((record) => {
          slots.push({
            id: record.id,
            bounds: record.bounds,
            blockId,
            xIndex: record.slot.row,
            zIndex: record.slot.col,
          });
        });
      }

      const blockSize = yardBounds.getSize(new THREE.Vector3());
      // 界面上显示的 TEU 数量文本
      yard.count = `${yardCount} TEU`;
      // 摊成普通对象，理由同前（Pinia 响应式代理与 Vector3 不兼容）
      yard.blockSize = { x: blockSize.x, y: blockSize.y, z: blockSize.z };
      containerCount += yardCount;
      this._addYardLabel(yard);
    });

    return {
      yards,
      containerCount,
      slots,
      layout: {
        // 展开原配置，再补上一批"推导出来的实际值"。
        // 【为什么要回传这些中间量】它们是自适应布局的计算结果，
        // 调试面板要显示"期望 12 个模块、实际放了 10 个、砍了 2 个"，
        // 不回传就无从得知布局究竟被压缩到了什么程度
        ...layout,
        zoneColumns: moduleGroups.length,
        zoneRows: zoneCentersZ.length,
        zoneCount: yards.length,
        moduleWidth,
        moduleDepth,
        moduleRoadWidth,
        requestedModulesAcross,
        modulesAcross,
        // removedBlocks（被砍掉的模块总数）：横向砍掉的数量 × 行数
        removedBlocks: (requestedModulesAcross - modulesAcross) * zoneCentersZ.length,
        containerCount,
      },
    };
  }

  // _createYardRoads（内部方法：建堆场路网）：一层薄转发
  private _createYardRoads(
    slots: GroundRoadSlot[],
    layout: GroundLayoutResult,
  ): { network: ReturnType<RoadSystem["createYardNetwork"]> } {
    const network = this.roadSystem!.createYardNetwork({
      slots,
      // 外环路宽度沿用堆场布局里的配置，保证路网边界与堆场规划一致
      outerRoadWidth: layout.outerRoadWidth,
      // 内部通道的最小宽度写死 7.5 米，比 layout 里的
      // minimumModuleRoadWidth 略小一点。
      // 【为什么要略小】布局阶段按 minimumModuleRoadWidth 规划路宽，
      // 但浮点运算后实际缝隙可能比它小零点几毫米。
      // 路网识别的门槛若与规划值完全相等，那些"刚好达标"的缝隙
      // 会因为微小误差被判为"太窄不是路"，整排箱区就无路可达了。
      // 留一点余量是必要的容错
      minimumMainRoadWidth: 7.5,
      minimumCrossRoadWidth: 7.5,
    });
    // 包一层对象返回而不是直接返回 network。
    // 这留了扩展余地——将来若还要回传别的东西（比如统计信息），
    // 调用点的解构写法不用改
    return { network };
  }

  // _createAGVRoad（内部方法：建 AGV 巡航环线）
  // 这条环线绕在堆场路网外围，是车辆的"主动脉"：
  //
  //        ┌──────────────────┐  ← rearZ（堆场后方）
  //        │                  │
  //        │   [堆场路网]     │
  //        │                  │
  //        ├──────────────────┤  ← innerZ（堆场前方）
  //        └──────────────────┘  ← dockLoopZ（岸边作业线）
  private _createAGVRoad(yardRoadBounds: { min: THREE.Vector3; max: THREE.Vector3 }) {
    const { min, max } = yardRoadBounds;
    // rearZ（后方边界）：堆场路网最小 Z 再往后退一段净空
    const rearZ = min.z - this.agvLoopLayout.rearClearance;
    // innerZ（堆场前方那条横线）：取两者的较大值。
    // 【为什么要 Math.max】堆场前缘加净空得到一个值，
    // 但环线也不能压到岸边作业区里去（dockApproachZ 是那条底线）。
    // 取大者保证两个约束同时满足——堆场小的时候由 dockApproachZ 兜底，
    // 堆场大的时候由堆场边界决定
    const innerZ = Math.max(
      this.agvLoopLayout.dockApproachZ,
      max.z + this.agvLoopLayout.frontClearance,
    );
    return this.roadSystem!.createAGVRoad({
      id: "AGV_LOOP_01",
      // 六个点勾出一个"回"字形的闭合环线：
      // 从左前 → 左后 → 右后 → 右前（绕堆场一圈）
      // → 右侧下到岸边 → 左侧岸边（再由 closed 自动接回起点）
      points: [
        new THREE.Vector3(min.x, 0.12, innerZ),
        new THREE.Vector3(min.x, 0.12, rearZ),
        new THREE.Vector3(max.x, 0.12, rearZ),
        new THREE.Vector3(max.x, 0.12, innerZ),
        // 这两点把环线延伸到岸边，车才能开到岸桥下装卸
        new THREE.Vector3(max.x, 0.12, this.agvLoopLayout.dockLoopZ),
        new THREE.Vector3(min.x, 0.12, this.agvLoopLayout.dockLoopZ),
      ],
      // closed（闭合）：车绕完一圈自动回到起点继续循环。
      // 少了这个标记，环线会缺一段，车开到最后一点就没路了
      closed: true,
      width: this.agvLoopLayout.width,
      // 转角半径由配置给出，让车能平滑过弯（见 RoadSystem 的倒角逻辑）
      cornerRadius: this.agvLoopLayout.cornerRadius,
      // 两条车道，一正一反：offset 一负一正把它们分到中心线两侧，
      // direction 一个 1 一个 -1 让它们行驶方向相反。
      // 这就是双向环线的实现方式——同一条几何曲线服务两个方向
      lanes: [
        { id: "AGV_LOOP_01_L1", offset: -this.agvLoopLayout.laneOffset, direction: 1 },
        { id: "AGV_LOOP_01_L2", offset: this.agvLoopLayout.laneOffset, direction: -1 },
      ],
    });
  }

  // ==========================================================================
  // 【死代码】_buildContainerBlock 与 _createRandomContainerModel
  // 只被上面 _createContainerYard 的不可达段调用，实际不会执行
  // ==========================================================================

  // _buildContainerBlock（旧版：用真实模型逐个摆出一个箱区）—— 死代码
  private _buildContainerBlock(
    parent: THREE.Object3D,
    centerX: number,
    centerZ: number,
    spec: { rows: number; bays: number; rowPitch: number; bayPitch: number; levelHeight: number; minStack: number; maxStack: number },
  ): number {
    const { rows, bays, rowPitch, bayPitch, levelHeight, minStack, maxStack } =
      spec;
    // 中心 -> 起点的换算，同 createCenteredBlock 的做法
    const startX = centerX - ((rows - 1) * rowPitch) / 2;
    const startZ = centerZ - ((bays - 1) * bayPitch) / 2;
    // stackSpan（堆高的可取值个数）：+1 是因为上下界都要包含。
    // 2~4 层是三种可能，maxStack - minStack 只有 2，会永远取不到 4 层
    const stackSpan = maxStack - minStack + 1;
    let count = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let bay = 0; bay < bays; bay += 1) {
        const stack = minStack + Math.floor(Math.random() * stackSpan);
        for (let level = 0; level < stack; level += 1) {
          // 每个箱子都是一个独立 Mesh。
          // 【这正是本方法被淘汰的原因】上千个独立 Mesh 意味着上千次
          // 绘制调用，帧率会掉到个位数。现版本改用实例化渲染
          const container = this._createRandomContainerModel();
          container.position.set(
            startX + row * rowPitch,
            // 0.08 是离地净空，与 YardSystem 的 startY 默认值一致
            0.08 + level * levelHeight,
            startZ + bay * bayPitch,
          );
          parent.add(container);
          count += 1;
        }
      }
    }

    return count;
  }

  // _createRandomContainerModel（旧版：随机取一个集装箱模型）—— 死代码
  private _createRandomContainerModel(): THREE.Object3D {
    const id =
      this.containerAssetIds[
        Math.floor(Math.random() * this.containerAssetIds.length)
      ];

    // 有模型就克隆一份。
    // 【注意是 clone 而不是 acquire】这一代没有资源池的借还机制，
    // 每个箱子都克隆出独立的对象树，显存占用与箱数成正比
    if (id && this.modelAssetManager) {
      return this.modelAssetManager.clone(id);
    }

    // 兜底：没有模型时用一个蓝色的盒子代替。
    // 尺寸 12×2.6×2.4 就是一个 40 英尺集装箱的大致比例
    const fallback = new THREE.Mesh(
      new THREE.BoxGeometry(12, 2.6, 2.4),
      new THREE.MeshStandardMaterial({
        color: 0x3a78c9,
        roughness: 0.85,
        metalness: 0.05,
      }),
    );
    // 抬高半个箱高，让盒子底面落在指定的坐标上
    fallback.position.y = 1.3;
    fallback.castShadow = true;
    fallback.receiveShadow = true;
    return fallback;
  }

  // ==========================================================================
  // 【死代码结束】以下方法正在使用
  // ==========================================================================

  // _addYardLabel（内部方法：给一个堆场区加悬浮标签）
  private _addYardLabel(yard: Pick<GroundYard, "name" | "count" | "x" | "z" | "labelHeight">): void {
    // 建一个真实的 DOM 元素。CSS2DObject 走的是"HTML 贴在三维位置上"
    // 的路线，而不是把文字画进三维场景。
    // 【为什么用 HTML 而不是三维文字】文字永远清晰不受透视影响、
    // 可以用 CSS 做样式与动画、还能选中复制；
    // 代价是它永远画在最上层，不会被三维物体遮挡——
    // 这正是下面 _updateYardLabelVisibility 要手工处理遮挡的原因
    const label = document.createElement("div");
    label.className = "yard-label";
    // innerHTML 里放区名与 TEU 数量。样式由外部 CSS 里的 .yard-label 决定
    label.innerHTML = `<b>${yard.name}</b><span>${yard.count}</span>`;
    const object = new CSS2DObject(label);
    // labelHeight 由 _createTerminalYards 算出（堆顶再加 3 米）；
    // ?? 28 是兜底值，供那两代旧实现使用（它们不算这个字段）
    object.position.set(yard.x, yard.labelHeight ?? 28, yard.z);
    this.scene.add(object);
    // 收进列表，供遮挡剔除遍历
    this.yardLabels.push(object);
  }

  // _updateYardLabelVisibility（内部方法：标签的防重叠剔除）
  //
  // 【要解决的问题】CSS2DObject 是 HTML，永远画在画面最上层。
  // 镜头拉远时十几个区名标签会挤成一团互相覆盖，什么也读不清。
  // 本方法的做法是：把所有标签投影到屏幕坐标，按"离相机由近到远"排序，
  // 逐个检查"它与已经决定显示的标签是否重叠"，重叠就隐藏。
  // 近的优先保留——因为近处的区才是用户正在关注的。
  //
  // 【⚠ 现存缺陷：本方法当前一行都执行不到】
  // 下面第一行守卫读的 this.labelRenderer，在本文件里从未被赋值过——
  // 构造函数只从 options 里取了 camera（见文件开头的 this.camera 那行），
  // 调用方 PortRuntime 建 GroundSystem 时也没传 labelRenderer
  //（它把 labelRenderer 交给了 LabelSystem / RenderSystem）。
  // 于是 this.labelRenderer 恒为 undefined，?. 让整个条件成立，
  // 每次调用都在第一行原地返回。
  // 症状：镜头拉远时区名标签仍会挤成一团，本方法白写。
  // 修法有两条——构造时把 labelRenderer 一并注入，
  // 或改用 this.camera 自带的视口尺寸推算屏幕坐标。
  // 这里只做标注不动代码，因为本轮任务是加注释而非改行为。
  private _updateYardLabelVisibility(): void {
    // 相机或标签渲染器缺失就直接返回（当前后者恒缺失，见上方缺陷说明）
    const camera = this.camera;
    const rendererElement = this.labelRenderer?.domElement;
    if (!camera || !rendererElement) return;
    const width = rendererElement.clientWidth;
    const height = rendererElement.clientHeight;
    // 尺寸为 0 说明画布还没布局完（初始化的第一帧常见）。
    // 【必须挡住这种情况】宽高为 0 会让下面的屏幕坐标全算成 0，
    // 所有标签都判为"互相重叠"，于是只剩一个标签可见
    if (!width || !height) return;

    // 两个复用向量，避免在循环里产生垃圾对象
    const worldPosition = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const candidates = this.yardLabels
      .map((label) => {
        // 取标签的世界坐标
        label.getWorldPosition(worldPosition);
        // project（投影到相机的 NDC 空间）：结果各分量落在 -1~1 之间
        projected.copy(worldPosition).project(camera);
        return {
          label,
          // NDC -> 屏幕像素坐标的标准换算。
          // X：(-1~1) → (0~1) → (0~width)
          x: (projected.x * 0.5 + 0.5) * width,
          // Y 要额外取负号，因为 NDC 的 Y 向上、屏幕坐标的 Y 向下
          y: (-projected.y * 0.5 + 0.5) * height,
          // 保留 z 用来判断是否在视锥内
          z: projected.z,
          // 用距离的平方排序，省掉开方
          distance: camera.position.distanceToSquared(worldPosition),
        };
      })
      // 由近到远排序。这个顺序决定了"谁优先获得显示权"
      .sort((left, right) => left.distance - right.distance);
    // visible（已确定显示的标签）：后来者要与它们逐个比对
    const visible: GroundLabelCandidate[] = [];

    candidates.forEach((candidate) => {
      // inView（在视锥内）：NDC 的 z 在 -1~1 之间表示落在近远裁剪面之间。
      // 【为什么必须判这一条】相机背后的物体投影后 z 会超出这个范围，
      // 但 x/y 仍可能落在屏幕内。不判的话身后的标签会出现在画面上
      const inView = candidate.z >= -1 && candidate.z <= 1;
      // overlaps（与已显示的标签重叠）：用矩形包围盒近似判断。
      // 124×52 像素是标签的大致尺寸——横向阈值远大于纵向，
      // 因为标签是横向的文字块，宽远大于高
      const overlaps = visible.some(
        (accepted) =>
          Math.abs(accepted.x - candidate.x) < 124 &&
          Math.abs(accepted.y - candidate.y) < 52,
      );
      const show = inView && !overlaps;
      // 用 visibility 而不是 display 控制显隐。
      // 【区别很重要】display: none 会让元素退出布局流，
      // CSS2DRenderer 下一帧重新定位时会有布局抖动；
      // visibility: hidden 保留占位，切换时不产生重排
      candidate.label.element.style.visibility = show ? "visible" : "hidden";
      // 只有真正显示的才加入比对基准。
      // 【为什么隐藏的不能加】否则一个被隐藏的标签会继续"占位"，
      // 把它周围本可以显示的标签也挤掉，最后画面上标签寥寥无几
      if (show) visible.push(candidate);
    });
  }

  // _createConcreteTextures（内部方法：程序化生成混凝土地面的三张贴图）
  //
  // 【为什么不直接用图片文件】码头地面面积极大（1200×420 米），
  // 想不重复地铺满需要一张巨大的图。程序化生成的好处是：
  //   · 零下载体积，不占网络请求
  //   · 分辨率可调，想要更细就改一个数字
  //   · 每次运行的花纹都不同，不会出现"两块地面一模一样"的机械感
  //
  // 【返回三张图，各管一件事】
  //   map（颜色贴图）        —— 地面是什么颜色、有什么污渍
  //   roughnessMap（粗糙度贴图）—— 哪里反光哪里不反光（油渍处更光滑）
  //   normalMap（法线贴图）   —— 表面凹凸的错觉，让平面看起来有颗粒感
  private _createConcreteTextures(): {
    map: THREE.CanvasTexture;
    roughnessMap: THREE.CanvasTexture;
    normalMap: THREE.CanvasTexture;
  } {
    // 1024×1024：在细节与显存之间取的折中。
    // 512 会明显糊，2048 每张图要 16MB 显存，三张就 48MB
    const width = 1024;
    const height = 1024;
    // 用离屏 canvas（画布）当画纸。这是浏览器里"程序化画图"的标准手段
    const diffuse = document.createElement("canvas");
    diffuse.width = width;
    diffuse.height = height;
    const context = diffuse.getContext("2d")!;
    // 第一步：铺一层灰底色。#8e9499 是带一点冷调的水泥灰
    context.fillStyle = "#8e9499";
    context.fillRect(0, 0, width, height);

    // 第二步：叠 60 团半透明的径向渐变，做出大尺度的明暗不均。
    // 【为什么需要这一步】纯色底 + 细颗粒噪声看起来像砂纸，
    // 而不像混凝土。真实的水泥地是一片片深浅不一的——
    // 浇筑批次、日晒雨淋都会留下大块色差。这些渐变团就是在模拟它
    for (let i = 0; i < 60; i += 1) {
      const radius = 60 + Math.random() * 180;
      // createRadialGradient（建径向渐变）的六个参数是
      // 内圆心 x,y,r 与外圆心 x,y,r。
      // 【注意内外圆心用了不同的随机值】这不是笔误也不是巧合——
      // 两个圆心错开会让渐变团变成偏心的、被拉扯过的形状，
      // 比正圆更像自然的水渍。若两处用同一坐标，60 个正圆叠出来
      // 会有明显的"圆形斑点"感
      const gradient = context.createRadialGradient(
        Math.random() * width,
        Math.random() * height,
        0,
        Math.random() * width,
        Math.random() * height,
        radius,
      );
      // 亮度在 130~169 之间随机，比底色略亮
      const value = 130 + Math.floor(Math.random() * 40);
      // 三个通道递增 0/+4/+8：让亮团略微偏蓝，符合水泥的冷色调。
      // 三通道完全相同会得到纯灰，看起来发死
      gradient.addColorStop(0, `rgba(${value},${value + 4},${value + 8},0.35)`);
      // 外圈完全透明，渐变团才能柔和地融进底色而不留硬边
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      // 每次都填满整张画布。渐变本身在半径外已经透明，
      // 所以填满与只填圆形区域的结果相同，但代码简单得多
      context.fillRect(0, 0, width, height);
    }

    // 第三步：逐像素加细颗粒噪声。
    // getImageData（取像素数据）拿到一个扁平数组，
    // 每四个数字是一个像素的 R、G、B、A
    const image = context.getImageData(0, 0, width, height);
    for (let i = 0; i < image.data.length; i += 4) {
      // 同一个 noise 值加到三个通道上，保证是"明暗"扰动而非"变色"。
      // 若三个通道各取独立随机值，会得到彩色雪花点，像坏掉的电视
      const noise = (Math.random() - 0.5) * 22;
      // clamp（钳制到 0~255）是必须的：底色 142 加上 +11 没问题，
      // 但上一步的亮团可能已经把某些像素推到 250 以上，
      // 再加噪声会溢出。Uint8 数组溢出后会回绕成 0——
      // 画面上出现刺眼的黑点
      image.data[i] = THREE.MathUtils.clamp(image.data[i] + noise, 0, 255);
      image.data[i + 1] = THREE.MathUtils.clamp(image.data[i + 1] + noise, 0, 255);
      image.data[i + 2] = THREE.MathUtils.clamp(image.data[i + 2] + noise, 0, 255);
    }
    // 把改好的像素写回画布
    context.putImageData(image, 0, 0);

    // 第四步：画 25 个深色椭圆当油渍。
    // 【顺序很重要：必须在噪声之后】油渍是覆盖在水泥表面的，
    // 若先画油渍再加噪声，噪声会把油渍搅得斑驳，看起来像是渗进去的
    for (let i = 0; i < 25; i += 1) {
      // 近黑色，不透明度 0.1~0.35 随机——深浅不一的油渍更真实
      context.fillStyle = `rgba(20,20,25,${0.1 + Math.random() * 0.25})`;
      context.beginPath();
      // ellipse（画椭圆）：中心 x,y，横半轴，纵半轴，旋转角，起止角。
      // 横半轴 8~48、纵半轴 3~18——刻意让椭圆扁长，
      // 因为漏油滴在地上会被车轮拖抹开，不会是正圆
      context.ellipse(
        Math.random() * width,
        Math.random() * height,
        8 + Math.random() * 40,
        3 + Math.random() * 15,
        // 随机旋转，避免所有油渍朝同一方向
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    // 第五步：画混凝土板的伸缩缝网格。
    // 【为什么必须有这些线】没有它们，地面就是一片无特征的噪声，
    // 人眼失去参照物，车开在上面会感觉不到速度。
    // 每 128 像素一条线，配合下面 repeat(8, 4) 的平铺，
    // 换算到世界坐标就是规整的水泥板分块
    context.strokeStyle = "rgba(40,40,45,0.55)";
    context.lineWidth = 2;
    // 横线
    for (let y = 0; y <= height; y += 128) {
      // 每条线都要 beginPath（开新路径）。
      // 少了它，所有线段会累积在同一条路径里，
      // 每次 stroke 都把之前所有线重画一遍——越画越慢，
      // 而且半透明的线会叠加变深
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    // 纵线，同理
    for (let x = 0; x <= width; x += 128) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    // ---- 第二张图：粗糙度贴图 ----
    // 单独画一张，不复用颜色贴图。
    // 【为什么不能复用】颜色深浅与粗糙度没有必然关系：
    // 深色的油渍是光滑的（粗糙度低、会反光），
    // 深色的阴影却与周围一样粗糙。直接拿颜色当粗糙度会让
    // 所有暗处都变得反光，地面像打过蜡
    const roughness = document.createElement("canvas");
    roughness.width = width;
    roughness.height = height;
    const roughnessContext = roughness.getContext("2d")!;
    // 底色 #d8d8d8（约 0.85）：水泥整体是粗糙的、几乎不反光
    roughnessContext.fillStyle = "#d8d8d8";
    roughnessContext.fillRect(0, 0, width, height);

    // 同样画 25 个深色椭圆，代表油渍处更光滑（值越小越光滑）。
    // 【注意这批椭圆的坐标与颜色图那批是独立随机的】
    // 严格来说两者应当对齐——同一处油渍既该发暗又该反光。
    // 这里没对齐，视觉上表现为"暗斑与亮斑错位"，
    // 在远景与俯视视角下几乎看不出来，属于可接受的简化
    for (let i = 0; i < 25; i += 1) {
      roughnessContext.fillStyle = `rgba(60,60,60,${0.4 + Math.random() * 0.4})`;
      roughnessContext.beginPath();
      roughnessContext.ellipse(
        Math.random() * width,
        Math.random() * height,
        10 + Math.random() * 50,
        4 + Math.random() * 18,
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      roughnessContext.fill();
    }

    // ---- 第三张图：法线贴图 ----
    // 由颜色图推导，不单独绘制。
    // 【依据】颜色图里的明暗变化本来就来自表面的凹凸，
    // 所以"亮度的梯度"近似等于"表面的坡度"。这是廉价但有效的近似
    const normal = this._createNormalMapFromCanvas(diffuse);
    return {
      // 三张图都平铺 8×4 次。
      // 【为什么 X 方向 8 次而 Z 方向 4 次】码头地面是 1200×420 米的长方形，
      // 长宽比约 2.86:1。用 8:4 = 2:1 的平铺比例，
      // 让贴图在两个方向上的实际拉伸接近，纹理不会被拉扁
      map: this._makeRepeatedTexture(diffuse, 8, 4),
      roughnessMap: this._makeRepeatedTexture(roughness, 8, 4),
      normalMap: this._makeRepeatedTexture(normal, 8, 4),
    };
  }

  // _createNormalMapFromCanvas（内部方法：由灰度图推导法线贴图）
  //
  // 【原理】法线贴图（normal map）用 RGB 三个通道编码表面朝向：
  //   R 存 X 方向的坡度、G 存 Y 方向的坡度、B 存朝上的分量。
  // 而一张灰度图里"亮度变化快的地方"正对应"表面陡的地方"。
  // 所以求出亮度在横纵两个方向的梯度（gradient，变化率），
  // 就能得到一份足以骗过眼睛的法线。
  //
  // 【中心差分（central difference）】
  // 求某点的横向梯度，用它右边邻居减左边邻居：
  //     gx = L(x+1) - L(x-1)
  // 比用"自己减左邻居"（前向差分）更准确、更对称——
  // 前向差分会让整张法线图整体偏移半个像素，
  // 表现为凹凸的位置与颜色纹理错开
  private _createNormalMapFromCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const width = canvas.width;
    const height = canvas.height;
    // 一次性取出全部源像素。
    // 【为什么先整块取出】getImageData 是较慢的调用（涉及 GPU 到 CPU 的回读），
    // 一百万个像素若逐个调用会卡死几十秒。取一次到普通数组里，
    // 后面全是纯内存运算
    const source = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    const normal = document.createElement("canvas");
    normal.width = width;
    normal.height = height;
    const context = normal.getContext("2d")!;
    // createImageData（建空白像素缓冲）：初值全 0（透明黑）。
    // 下面只填写内部像素，最外一圈保持全 0
    const target = context.createImageData(width, height);
    // luminance（亮度）：按人眼对三原色的敏感度加权。
    // 0.299/0.587/0.114 是 ITU-R BT.601 标准系数——
    // 人眼对绿色最敏感、对蓝色最不敏感。
    // 若简单取 (R+G+B)/3，蓝色区域的亮度会被高估，
    // 推出来的凹凸方向就偏了
    const luminance = (i: number) =>
      0.299 * source[i] + 0.587 * source[i + 1] + 0.114 * source[i + 2];

    // 循环从 1 开始、到 -1 结束：跳过最外一圈像素。
    // 【为什么必须跳过】边界像素的左邻居（i - 4）会越界到上一行的末尾，
    // 甚至在第 0 行时索引变成负数。中心差分需要两侧都有邻居，
    // 最外圈天生不满足。代价是边缘一圈是透明黑，
    // 贴图平铺后接缝处有一像素的瑕疵——远景下不可见，可以接受
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        // 当前像素在扁平数组里的起始下标。乘 4 是因为每像素占四个字节
        const i = (y * width + x) * 4;
        // 横向梯度：右邻居（+4 个字节 = 下一个像素）减左邻居
        const gx = luminance(i + 4) - luminance(i - 4);
        // 纵向梯度：下一行同列（+width*4）减上一行同列
        const gy = luminance(i + width * 4) - luminance(i - width * 4);
        // 编码：128 是"没有坡度"的中点（因为法线的 x/y 分量可正可负，
        // 而字节只能存 0~255，所以把 0 映射到中间值 128）。
        // ×0.6 是强度衰减——梯度原始值可达 ±255，
        // 不衰减会得到极端的法线，地面看起来像揉皱的锡纸
        target.data[i] = 128 + gx * 0.6;
        target.data[i + 1] = 128 + gy * 0.6;
        // B 通道固定 255：表示法线主要朝上（Z 分量最大）。
        // 混凝土只有细微起伏，不存在朝侧面的表面
        target.data[i + 2] = 255;
        // A 通道 255（完全不透明）。
        // 【不能省】ImageData 初值是 0（全透明），
        // 不写 A 通道的话浏览器把整张图当透明处理，
        // 转成贴图后 RGB 全被清零，法线失效、地面变得平坦无光
        target.data[i + 3] = 255;
      }
    }

    // 写回画布并返回画布本身（不是贴图）。
    // 调用方还要用 _makeRepeatedTexture 包一层，
    // 所以这里返回 canvas 保留了灵活性
    context.putImageData(target, 0, 0);
    return normal;
  }

  // _createWaterNormalTexture（内部方法：生成水面法线贴图）
  //
  // 【和地面法线的区别】这张不是从灰度图推导的，而是直接生成随机噪声。
  // 因为水面的细节起伏本来就是无规律的，Water 着色器还会
  // 用两套不同速度的 UV 去采样它，叠出粼粼波光的效果——
  // 输入越随机，叠出来的波纹越不容易看出重复
  private _createWaterNormalTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    // 只用 256×256。
    // 【为什么比地面小得多】水面法线会被高频平铺并持续流动，
    // 单个像素在屏幕上停留的时间极短，人眼根本分辨不出细节。
    // 256² 只占 256KB，是很划算的取舍
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(256, 256);

    for (let i = 0; i < image.data.length; i += 4) {
      // 120~150：围绕中点 128 的小幅扰动，代表轻微的水面倾斜。
      // 【为什么范围这么窄】值离 128 越远，法线偏斜越大。
      // 平静港湾里的水只有细波，若用 0~255 的全范围，
      // 水面会变成剧烈翻腾的一锅粥
      const value = 120 + Math.random() * 30;
      // R 与 G 用同一个值：意味着每个像素的倾斜方向都是斜 45 度。
      // 【这是一处刻意的简化】严格来说 X 与 Y 应当独立随机。
      // 但 Water 着色器会把两套错开的 UV 采样结果相减，
      // 那一步已经打散了方向的一致性，所以这里省一半随机数调用无妨
      image.data[i] = value;
      image.data[i + 1] = value;
      // B 通道 255、A 通道 255，同地面法线的道理
      image.data[i + 2] = 255;
      image.data[i + 3] = 255;
    }

    context.putImageData(image, 0, 0);
    // 平铺 4×4。水面是接近正方形的一大片，所以两轴取相同倍数
    return this._makeRepeatedTexture(canvas, 4, 4);
  }

  // _makeRepeatedTexture（内部方法：把画布包装成可平铺的贴图）
  // 四行设置各有各的必要性，少任何一行都会出问题
  private _makeRepeatedTexture(
    canvas: HTMLCanvasElement,
    repeatX: number,
    repeatY: number,
  ): THREE.CanvasTexture {
    // CanvasTexture（画布贴图）：让 GPU 直接读取 canvas 的像素
    const texture = new THREE.CanvasTexture(canvas);
    // wrapS / wrapT（横向 / 纵向的越界处理方式）设为 RepeatWrapping（重复平铺）。
    // 【必须设置】Three.js 的默认值是 ClampToEdgeWrapping（拉伸边缘像素）。
    // 保持默认的话，下面的 repeat.set(8, 4) 会让贴图只显示一次，
    // 剩下的区域全是边缘那一行像素被拉长的条纹
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // repeat（平铺次数）：在这个面上横向重复 repeatX 次、纵向 repeatY 次
    texture.repeat.set(repeatX, repeatY);
    // anisotropy（各向异性过滤级别）：改善"以极小的掠射角看向地面"时的画质。
    // 【为什么这个场景特别需要】码头是一大片水平地面，
    // 相机几乎总是斜着看它。默认的过滤方式在远处会把纹理糊成一片灰，
    // 伸缩缝的网格线在中景就消失了。设成 8 能让线条一直延伸到远处，
    // 极大增强纵深感。代价是采样次数增加，但只影响这几张地面贴图，
    // 开销可以忽略
    texture.anisotropy = 8;
    return texture;
  }
}
