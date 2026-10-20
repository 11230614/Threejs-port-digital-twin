// ============================================================================

export interface PortModelAsset {
  id: string;
  url: string;
  targetSize: number;
  excludeNodes?: string[];
}

export type ContainerAssetId = "container-blue" | "container-red" | "container-green";

export interface ContainerRenderConfig {
  readonly lodDistances: Readonly<{ near: number; medium: number }>;
  readonly streamingDistances: Readonly<{ load: number; unload: number }>;
}
// PortSceneConfig.js —— 场景资源配置（Scene Config：模型清单与渲染阈值）
//
// 【这个文件干什么】
// 两件事：
//   1) 声明本项目要加载哪些三维模型文件（PORT_MODEL_ASSETS 模型资产清单），
//      并给每个模型指定 targetSize（目标尺寸）——因为不同人做的模型原始大小
//      千差万别，加载后必须统一归一化到码头的真实比例。
//   2) 把 PortSpatialConfig（空间配置）里的常量再导出一遍（re-export，转发导出），
//      这样其它模块只需 import 这一个文件即可，不用记住参数究竟放在哪。
//
// 【术语翻译】
//   Scene（场景）              Config（配置）
//   asset（资产，此处指模型文件）  url（资源地址）
//   glb（GLTF 的二进制打包格式，一个文件装下模型+材质+贴图）
//   ?url（Vite 的导入后缀，表示"我只要这个文件的最终网址字符串"）
//   targetSize（目标尺寸，加载后要归一化到的世界单位长度）
//   excludeNodes（排除节点，加载后要删掉的多余子物体）
//   re-export（转发导出，把别的模块的导出原样再导出一次）
//   LOD（Level of Detail，细节层级）
//   streaming（流式加载）      threshold（阈值）
// ============================================================================

// 导入 AGV（无人集卡）模型地址。?url 让 Vite 只返回打包后的文件网址
import agvModelUrl from "../../model/cc.glb?url";
// 导入岸桥/港口起重机模型地址
import harbourCraneModelUrl from "../../model/crane_harbour2.glb?url";
// 导入小型货船模型地址
import smallCargoShipModelUrl from "../../model/small_cargo_ship.glb?url";
// 导入集装箱模型 1（蓝箱）地址。jzx 即"集装箱"拼音首字母
import containerModelUrl1 from "../../model/jzx1.glb?url";
// 导入集装箱模型 2（红箱）地址
import containerModelUrl2 from "../../model/jzx2.glb?url";
// 导入集装箱模型 3（绿箱）地址
import containerModelUrl3 from "../../model/jzx3.glb?url";
// 导入集装箱布局配置，下面要用它的 size.x 当作集装箱的目标长度
import { PORT_CONTAINER_LAYOUT_CONFIG } from "./PortSpatialConfig.ts";

// re-export（转发导出）：把空间配置里的七组常量原样再导出。
// 好处是调用方统一 import 自 PortSceneConfig，将来参数搬家也不影响外部
export {
  // AGV 环线配置
  PORT_AGV_LOOP_CONFIG,
  // 区块划分配置
  PORT_CHUNK_CONFIG,
  // 集装箱布局配置
  PORT_CONTAINER_LAYOUT_CONFIG,
  // LOD 细节层级配置
  PORT_LOD_CONFIG,
  // LOD 阴影策略配置
  PORT_LOD_SHADOW_CONFIG,
  // 渲染资源回收配置
  PORT_RENDER_RESOURCE_CONFIG,
  // 堆场布局配置
  PORT_YARD_LAYOUT_CONFIG,
} from "./PortSpatialConfig.ts";

// PORT_MODEL_ASSETS（模型资产清单）：资产管理器按这张表批量预加载模型
export const PORT_MODEL_ASSETS = Object.freeze([
  // 蓝色集装箱：targetSize（目标尺寸）取布局配置里的箱长，保证模型与布局严丝合缝
  { id: "container-blue", url: containerModelUrl1, targetSize: PORT_CONTAINER_LAYOUT_CONFIG.size.x },
  // 红色集装箱：同上
  { id: "container-red", url: containerModelUrl2, targetSize: PORT_CONTAINER_LAYOUT_CONFIG.size.x },
  // 绿色集装箱：同上
  { id: "container-green", url: containerModelUrl3, targetSize: PORT_CONTAINER_LAYOUT_CONFIG.size.x },
  // 货船：145.152 米，对应一条小型支线集装箱船的实际船长
  { id: "ship", url: smallCargoShipModelUrl, targetSize: 145.152 },
  // 岸桥
  {
    id: "crane",
    url: harbourCraneModelUrl,
    // 131.25 米：岸桥归一化后的整体尺寸
    targetSize: 131.25,
    // excludeNodes（排除节点）：原模型里带了个名为 "Cube" 的多余方块
    //（多半是建模时的辅助体），加载后要删掉，否则场景里会多出一个怪盒子
    excludeNodes: ["Cube"],
  },
  // AGV 无人集卡：5 米长，接近真实平板运输车尺寸
  { id: "agv", url: agvModelUrl, targetSize: 10 },
] satisfies readonly PortModelAsset[]);

// PORT_CONTAINER_ASSET_IDS（集装箱资产编号清单）：
// 生成堆场时从这三种颜色里随机挑，让箱区看起来有层次而不是一片纯色
export const PORT_CONTAINER_ASSET_IDS = Object.freeze([
  "container-blue",
  "container-red",
  "container-green",
] satisfies ContainerAssetId[]);

// PORT_CONTAINER_RENDER_CONFIG（集装箱渲染阈值配置）
export const PORT_CONTAINER_RENDER_CONFIG = Object.freeze({
  // 港口默认巡航相机距离堆场约数百米，因此近景阈值不能过小。
  // lodDistances（细节层级距离）：相机距离 < 650 用高模，650~1200 用中模，更远用低模
  lodDistances: Object.freeze({ near: 650, medium: 1200 }),
  // streamingDistances（流式加载距离）：进入 1500 米内开始加载，
  // 超出 1700 米才卸载。两个数字刻意留 200 米差值形成 hysteresis（滞回），
  // 否则相机在阈值线上小幅晃动就会疯狂反复加载/卸载，造成卡顿
  streamingDistances: Object.freeze({ load: 1500, unload: 1700 }),
} satisfies ContainerRenderConfig);
