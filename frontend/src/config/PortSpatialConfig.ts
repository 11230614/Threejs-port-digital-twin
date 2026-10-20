// ============================================================================

export interface ContainerLayoutConfig {
  readonly scale: number;
  readonly size: Readonly<{ x: number; y: number; z: number }>;
  readonly gap: Readonly<{ x: number; y: number; z: number }>;
}

export interface YardLayoutConfig {
  readonly moduleColumns: number;
  readonly rows: number;
  readonly layers: number;
  readonly modulesPerZone: number;
  readonly requestedZoneColumns: number;
  readonly zoneRows: number;
  readonly terminalCenterX: number;
  readonly terminalCenterZ: number;
  readonly terminalWidth: number;
  readonly preferredModuleRoadWidth: number;
  readonly minimumModuleRoadWidth: number;
  readonly zoneRoadWidth: number;
  readonly outerRoadWidth: number;
}

export interface AgvLoopConfig {
  readonly rearClearance: number;
  readonly frontClearance: number;
  readonly dockApproachZ: number;
  readonly dockLoopZ: number;
  readonly width: number;
  readonly cornerRadius: number;
  readonly laneOffset: number;
}

export interface ChunkConfig {
  readonly chunkSize: number;
  readonly loadDistance: number;
  readonly unloadDistance: number;
}

export interface LodLevelConfig {
  readonly level: number;
  readonly enter: number;
  readonly exit: number;
}

export interface LodConfig {
  readonly debounceMs: number;
  readonly hiddenLevel: number;
  readonly levels: readonly LodLevelConfig[];
}

export interface RenderResourceConfig {
  readonly idleDisposeMs: number;
  readonly assetIdleDisposeMs: number;
}
// PortSpatialConfig.js —— 码头空间参数配置（Spatial Config：所有尺寸的唯一出处）
//
// 【这个文件干什么】
// 把整个港口的"物理尺寸与距离阈值"集中在一处，作为 single source of truth
// （唯一真相来源）。堆场排布、道路生成、LOD 切换、流式加载都从这里取值，
// 改一个数字全场景同步生效，避免同一个尺寸在十个文件里各写一份而对不上。
//
// 所有配置都用 Object.freeze（冻结）包住，运行时只读，防止某个模块偷偷改坏
// 全局参数造成难查的 bug。
//
// 【术语翻译】
//   Spatial（空间的）            Config（配置）
//   world units（世界单位，Three.js 中的长度单位，本项目约定 1 单位 = 1 米）
//   scale（缩放系数）            gap（间隙）
//   yard（堆场，码头上码放集装箱的场地）
//   module / zone（箱区模块 / 大分区，堆场的两级划分）
//   layer（层数，箱子往上摞几层）  row / column（排 / 列）
//   clearance（净空、预留距离）    lane（车道）
//   loop（环线，AGV 绕行的闭合道路）
//   chunk（区块，把大场景切成小格子便于按需加载）
//   LOD（Level of Detail，细节层级：远处用粗模型、近处用精模型）
//   hysteresis（滞回：进入与退出用不同阈值，防止在边界反复抖动切换）
//   debounce（防抖：短时间内的重复触发只算一次）
//   streaming（流式加载：靠近才加载、走远就卸载）
//   proxy（代理体，用最简几何充当远处物体）
//   numeric separator（数字分隔符，15_000 就是 15000，加下划线只为好读）
// ============================================================================

// BASE_CONTAINER_SIZE（集装箱基础尺寸）：未放大前的原始长宽高，单位：米。
// x=12 长、y=2.8 高、z=2.5 宽，接近真实 40 尺集装箱的比例
const BASE_CONTAINER_SIZE = Object.freeze({ x: 12, y: 2.8, z: 2.5 });
// CONTAINER_SCALE（集装箱放大系数）：1.25 即整体放大 25%。
// 放大是为了在远距离俯视时箱子仍清晰可辨，属于视觉表现取舍
const CONTAINER_SCALE = 1.25;

/**
 * The physical source of truth for container rendering and terminal layout.
 * All values are world units after the 25% scale increase.
 *
 * 【译】集装箱渲染与码头布局的物理基准。以下数值均为放大 25% 之后的世界单位。
 */
// PORT_CONTAINER_LAYOUT_CONFIG（集装箱布局配置）
export const PORT_CONTAINER_LAYOUT_CONFIG = Object.freeze({
  // scale（缩放系数）：对外暴露，加载模型时按它把原始模型缩放到统一大小
  scale: CONTAINER_SCALE,
  // size（实际尺寸）：基础尺寸 × 缩放系数，堆场算间距时用的就是这组值
  size: Object.freeze({
    // x（长度方向）
    x: BASE_CONTAINER_SIZE.x * CONTAINER_SCALE,
    // y（高度方向）
    y: BASE_CONTAINER_SIZE.y * CONTAINER_SCALE,
    // z（宽度方向）
    z: BASE_CONTAINER_SIZE.z * CONTAINER_SCALE,
  }),
  // gap（箱间间隙）：x 方向留 1.2 米便于吊具下爪；
  // y 为 0 表示上下层直接叠放（真实集装箱靠角件互锁，本就贴合）；
  // z 方向留 0.75 米作为人员通行与吊装容差
  gap: Object.freeze({ x: 1.2, y: 0, z: 0.75 }),
} satisfies ContainerLayoutConfig);

/** Physical terminal limits used to keep expanded stacks out of the AGV loop.
 *
 * 【译】码头的物理边界限制，用来保证放大后的箱堆不会越界压到 AGV 环线上。
 */
// PORT_YARD_LAYOUT_CONFIG（堆场布局配置）
export const PORT_YARD_LAYOUT_CONFIG = Object.freeze({
  // moduleColumns（每个箱区模块的列数）：一个模块横向放 5 列箱子
  moduleColumns: 5,
  // rows（排数）：纵向 4 排
  rows: 4,
  // layers（层数）：往上摞 3 层
  layers: 3,
  // modulesPerZone（每个分区含几个模块）：3 个模块拼成一个分区
  modulesPerZone: 3,
  // requestedZoneColumns（期望的分区列数）：想横向排 4 个分区。
  // 叫 requested（请求的）是因为最终能排几个还要看码头总宽够不够，
  // 生成算法会在放不下时自动减少
  requestedZoneColumns: 4,
  // zoneRows（分区排数）：纵向 2 排分区
  zoneRows: 2,
  // terminalCenterX（码头中心 X 坐标）：0 表示以世界原点为横向中心
  terminalCenterX: 0,
  // terminalCenterZ（码头中心 Z 坐标）：-180 表示堆场整体往岸线后方退 180 米，
  // 给岸边的岸桥与船舶留出作业空间
  terminalCenterZ: -180,
  // terminalWidth（码头总宽度）：1100 米，是堆场横向排布的硬上限
  terminalWidth: 1100,
  // preferredModuleRoadWidth（模块间道路的理想宽度）：24 米，够两车对开
  preferredModuleRoadWidth: 24,
  // minimumModuleRoadWidth（模块间道路的最小宽度）：12 米。
  // 与上一项配合形成"弹性布局"：空间够就用 24，不够就压缩到 12，再不够才减模块
  minimumModuleRoadWidth: 12,
  // zoneRoadWidth（分区之间的主干道宽度）：80 米，供大型设备通行与转弯
  zoneRoadWidth: 80,
  // outerRoadWidth（堆场最外圈道路宽度）：12 米
  outerRoadWidth: 12,
} satisfies YardLayoutConfig);

/** The outer AGV loop is derived from the generated yard-road bounds.
 *
 * 【译】外圈 AGV 环线是根据生成出来的堆场道路边界反推出来的。
 */
// PORT_AGV_LOOP_CONFIG（AGV 环线配置）
export const PORT_AGV_LOOP_CONFIG = Object.freeze({
  // rearClearance（后方净空）：环线离堆场后边界再留 34 米
  rearClearance: 34,
  // frontClearance（前方净空）：靠岸一侧留 42 米，因为岸桥大车要横向走位，
  // 需要比后方更宽的余量
  frontClearance: 42,
  // dockApproachZ（进港引道 Z 坐标）：-10，车辆由此驶向岸边作业区
  dockApproachZ: -10,
  // dockLoopZ（岸边环线 Z 坐标）：10，岸边这段环线的具体位置
  dockLoopZ: 10,
  // width（环线路面宽度）：9 米
  width: 9,
  // cornerRadius（转角半径）：24 米。有半径才能生成圆滑转弯，
  // 否则车辆到拐角会瞬间转 90 度，看着极不自然
  cornerRadius: 24,
  // laneOffset（车道中心线偏移）：2.1 米。双向车道各自偏离路中心这么多，
  // 于是往返车流各行其道不会对撞
  laneOffset: 2.1,
} satisfies AgvLoopConfig);

/** Active spatial partition used by streaming, LOD policy and render adapters.
 *
 * 【译】当前生效的空间划分参数，供流式加载、LOD 策略与渲染适配器共用。
 */
// PORT_CHUNK_CONFIG（区块配置）
export const PORT_CHUNK_CONFIG = Object.freeze({
  // chunkSize（区块边长）：160 米。把整个港口切成 160×160 的格子，
  // 加载/卸载/剔除都以格子为单位批量处理，比逐个物体判断快得多
  chunkSize: 160,
  // loadDistance（加载距离）：区块中心距相机 1500 米内则加载其内容
  loadDistance: 1500,
  // unloadDistance（卸载距离）：超过 1700 米才释放。
  // 比加载距离大 200 米，构成 hysteresis（滞回）缓冲，防止边界抖动反复加卸载
  unloadDistance: 1700,
} satisfies ChunkConfig);

/** Chunk-level LOD policy with distance hysteresis and time debounce.
 *
 * 【译】区块级的 LOD 策略，同时带距离滞回与时间防抖两重保护。
 */
// PORT_LOD_CONFIG（细节层级配置）
export const PORT_LOD_CONFIG = Object.freeze({
  // debounceMs（防抖时长，毫秒）：同一区块 200 毫秒内不允许再次切换层级。
  // 距离滞回防"空间上的抖动"，时间防抖防"相机快速掠过导致的连续切换"
  debounceMs: 200,
  // hiddenLevel（隐藏层级）：层级编号 3 代表"太远了，直接不画"
  hiddenLevel: 3,
  // levels（层级阈值表）：每项含 level（层级号）、enter（进入距离）、exit（退出距离）
  levels: Object.freeze([
    // 层级 0（最精细）：距离小于 550 米进入；大于 650 米才退出
    Object.freeze({ level: 0, enter: 550, exit: 650 }),
    // 层级 1（中等）：1050 米进入，1200 米退出
    Object.freeze({ level: 1, enter: 1050, exit: 1200 }),
    // 层级 2（粗糙）：1450 米进入，1600 米退出。
    // 每一档 enter 都小于 exit，这就是滞回：靠近时要更近才升级，
    // 远离时要更远才降级，中间形成一段"死区"避免临界抖动
    Object.freeze({ level: 2, enter: 1450, exit: 1600 }),
  ]),
} satisfies LodConfig);

/** Derived low-detail/proxy GPU resources stay warm briefly before disposal.
 *
 * 【译】由高模派生出的低模/代理体资源，会先"保温"一小段时间再真正释放。
 */
// PORT_RENDER_RESOURCE_CONFIG（渲染资源回收配置）
export const PORT_RENDER_RESOURCE_CONFIG = Object.freeze({
  // idleDisposeMs（空闲释放时长）：15_000 毫秒即 15 秒。
  // 下划线是 numeric separator（数字分隔符），只为便于阅读，值仍是 15000。
  // 为什么不立刻释放？因为相机常来回摆动，刚走远就释放、回头又要重建，
  // 反复重建的开销远大于多占 15 秒显存
  idleDisposeMs: 15_000,
  // assetIdleDisposeMs（资产空闲释放时长）：30 秒。
  // 完整资产重建成本更高（要重新解析模型），所以给更长的保温期
  assetIdleDisposeMs: 30_000,
} satisfies RenderResourceConfig);

// PORT_LOD_SHADOW_CONFIG（LOD 阴影配置）：目前直接复用 LOD 配置，
// 即阴影的切换阈值与模型细节保持一致。单独起个名字是为了将来想让阴影
// 用更激进的阈值时，只改这一行即可，无需改动所有引用处
export const PORT_LOD_SHADOW_CONFIG = PORT_LOD_CONFIG;
