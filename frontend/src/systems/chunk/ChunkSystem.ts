// ============================================================================
// ChunkSystem.js —— 分块系统（Chunk System：把世界切成格子，按需加载）
//
// 【这个文件干什么】
// 码头场景有上万个物体，全部同时参与渲染与逻辑更新会卡死。
// 本文件把 XZ 平面（水平面）切成一张棋盘，每个格子叫一个 chunk（区块）。
// 相机走到哪，就只激活附近的区块，远处的区块整块休眠。
//
//   世界俯视图（chunkSize = 160 米）：
//     ┌─────┬─────┬─────┬─────┐
//     │ -1:1│ 0:1 │ 1:1 │ 2:1 │   每格 160×160 米
//     ├─────┼─────┼─────┼─────┤   格子编号 = "chunkX:chunkZ"
//     │ -1:0│ 0:0 │ 1:0 │ 2:0 │   编号可以是负数
//     ├─────┼─────┼─────┼─────┤
//     │-1:-1│0:-1 │1:-1 │2:-1 │
//     └─────┴─────┴─────┴─────┘
//
// 【本文件刻意不认识业务】
// 文件里没有"集装箱""车""岸桥"这些字眼，只有 handle（登记句柄）。
// 谁都能来登记一个 id 加一个包围盒，本系统只管"它在哪个格子里"。
// 这种 business-agnostic（与业务无关）的设计让同一套分块逻辑
// 能同时服务 ECS 实体、堆场数据记录、渲染分组三种完全不同的东西。
//
// 【最关键的设计：加载与卸载用两个不同的距离】
//   loadDistance   = 1500 —— 近到这个距离就激活
//   unloadDistance = 1700 —— 远过这个距离才休眠
// 中间那 200 米的空档叫 hysteresis（滞回带）。
// 【为什么必须有】若两个距离相等，相机正好停在临界线上抖动时，
// 区块会在"激活-休眠-激活-休眠"之间每帧翻转——
// 画面上一大片物体疯狂闪烁，同时每帧都在重建/销毁渲染资源，
// 比不做分块还慢。留出空档后，抖动落在空档里不会触发任何切换。
//
// 【术语翻译】
//   chunk（区块）           handle（登记句柄，指向被管理对象的一条登记）
//   partition（分区）        XZ（水平面的两个轴，Y 是高度）
//   bounds（包围盒）        Box3（三维包围盒）
//   dynamic（动态的，会移动的）  static（静态的，不动的）
//   register / unregister（登记 / 注销）
//   subscribe（订阅）        listener（监听函数）
//   snapshot（快照）         metrics（度量指标）
//   revision（版本号）       membership（归属关系）
//   hysteresis（滞回，用两个不同阈值避免临界抖动）
//   epsilon（极小量）        clamp（钳制在上下界之间）
//   hypot（求直角三角形斜边，即勾股定理）
//   Object.freeze（冻结对象，使其不可修改）
//   business-agnostic（与业务无关）
// ============================================================================

// 导入 Three.js：用到 Box3、Vector3、MathUtils.clamp
import * as THREE from "three";

// WORLD_Y_LIMIT（世界高度上限）：一百万米。
// 【为什么要这么大】区块只按 XZ（水平）划分，Y（高度）方向不切。
// 一个区块的包围盒在竖直方向必须"从天到地无限高"，
// 才能包住地面、也包住四十米高的岸桥顶端。
// 用 1_000_000 而不是 Infinity（无穷大）是关键：
// Box3 里出现 Infinity 会让 distanceTo、getSize 之类的运算
// 得出 NaN（非数值），而 NaN 参与比较永远为 false，
// 区块会永远激活不了。一个足够大的有限数没有这个问题。
// 下划线分隔符（1_000_000）只是让位数好读，JS 会忽略它
const WORLD_Y_LIMIT = 1_000_000;
// EDGE_EPSILON（边界极小量）：一千万分之一。
// 专门解决"物体正好压在格子边界上"的归属问题，详见 _getChunkKeys
const EDGE_EPSILON = 1e-6;

export interface SpatialHandle {
  id: string;
  bounds: THREE.Box3;
  getBounds: (() => THREE.Box3) | null;
  dynamic: boolean;
  renderType: string | null;
  data: unknown;
  chunkKeys: Set<string>;
}

export interface ChunkRecord {
  key: string;
  x: number;
  z: number;
  bounds: THREE.Box3;
  members: Map<string, SpatialHandle>;
  active: boolean;
  visible: boolean;
  distance: number;
  revision: number;
}

export interface ChunkEvent {
  readonly type: "enter" | "exit";
  readonly chunk: ChunkRecord;
  readonly timestamp: number;
}

export interface ChunkSnapshot {
  readonly currentChunkKey: string | null;
  readonly activeChunks: ChunkRecord[];
  readonly enteredChunks: ChunkRecord[];
  readonly exitedChunks: ChunkRecord[];
}

export interface ChunkMetrics {
  chunkSize: number;
  currentChunk: string | null;
  totalChunks: number;
  activeChunks: number;
  visibleActiveChunks: number;
  spatialHandles: number;
  dynamicHandles: number;
  enteredLastUpdate: number;
  exitedLastUpdate: number;
  transitions: number;
  dynamicMoves: number;
}

export interface ChunkUpdateOptions { isVisible?: ((chunk: ChunkRecord) => boolean) | null }

export interface ChunkRegisterOptions {
  id: string;
  bounds?: THREE.Box3 | null;
  getBounds?: (() => THREE.Box3) | null;
  dynamic?: boolean;
  renderType?: string | null;
  data?: unknown;
}

/**
 * Business-agnostic XZ spatial partition.
 * Registered handles may be ECS entities, world records, or render groups.
 */
// 上面这段英文原注释的意思：
//   与业务无关的 XZ 平面空间分区。
//   登记进来的句柄可以是 ECS 实体、世界数据记录，或渲染分组。
// export（导出）class（类）：声明并公开"分块系统"
export class ChunkSystem {
  readonly chunkSize: number;
  readonly loadDistance: number;
  readonly unloadDistance: number;
  private handles = new Map<string, SpatialHandle>();
  private chunks = new Map<string, ChunkRecord>();
  private activeChunks = new Map<string, ChunkRecord>();
  private listeners = new Set<(event: ChunkEvent) => void>();
  private enteredChunks: ChunkRecord[] = [];
  private exitedChunks: ChunkRecord[] = [];
  private currentChunkKey: string | null = null;
  private transitionCount = 0;
  private dynamicMoveCount = 0;
  private lastTimestamp = 0;
  // constructor（构造函数）
  constructor({
    // chunkSize（格子边长）：160 米。
    // 【这个值怎么定的】太小则格子数量爆炸，每帧要遍历上千个格子算距离；
    // 太大则一个格子里装太多物体，激活时一次性加载造成卡顿。
    // 160 米大约装得下一个箱区加周边道路，是本项目实测的折中值
    chunkSize = 160,
    // 见文件头对滞回带的说明
    loadDistance = 1500,
    unloadDistance = 1700,
  }: { chunkSize?: number; loadDistance?: number; unloadDistance?: number } = {}) {
    // ---- 三道参数校验：宁可建不起来，也不要带着坏参数运行 ----
    // Number.isFinite（是否有限数）同时挡住 NaN、Infinity、字符串、undefined。
    // 【为什么不用 typeof === "number"】NaN 与 Infinity 也是 number 类型，
    // 却会让所有距离计算失效
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      // 抛 RangeError（范围错误）而非普通 Error，语义更准确：
      // 类型对但取值不在允许范围内
      throw new RangeError("ChunkSystem chunkSize must be positive.");
    }
    // 加载距离可以是 0（表示"只激活相机所在的那一格"），所以只挡负数
    if (!Number.isFinite(loadDistance) || loadDistance < 0) {
      throw new RangeError("ChunkSystem loadDistance must be non-negative.");
    }
    // 卸载距离必须 >= 加载距离。
    // 【为什么这条最重要】若卸载距离反而更小，会出现一个死循环区间：
    // 某个距离既满足"近于加载距离"（该激活）又满足"远于卸载距离"（该休眠），
    // update 里两条 if 每帧交替命中，区块永久闪烁。
    // 允许两者相等（滞回带为 0），因为某些测试场景需要确定性的边界行为
    if (!Number.isFinite(unloadDistance) || unloadDistance < loadDistance) {
      throw new RangeError("ChunkSystem unloadDistance must be >= loadDistance.");
    }

    this.chunkSize = chunkSize;
    this.loadDistance = loadDistance;
    this.unloadDistance = unloadDistance;
    // ---- 四张核心表 ----
    // handles（句柄表）：id -> 句柄对象。所有登记进来的东西
    this.handles = new Map();
    // chunks（区块表）：格子编号 -> 区块对象。
    // 【注意是懒建的】不预先铺满整张棋盘，只有当某个句柄落进某格时
    // 才创建那一格；格子空了会立刻删掉。
    // 若预建，1200×420 米的码头就要建二十几个格子，
    // 而大部分是空白水面，白占内存也白算距离
    this.chunks = new Map();
    // activeChunks（已激活区块表）：chunks 的一个子集。
    // 【为什么要单独一张表】渲染层每帧都要"取全部已激活区块"，
    // 若只有 chunks 表就得每帧过滤一遍全部格子。
    // 单独存一份是拿一点内存换每帧的遍历开销
    this.activeChunks = new Map();
    // listeners（监听函数集合）：区块进出时通知谁。
    // 用 Set（集合）而非数组：天然去重，删除也是 O(1)
    this.listeners = new Set();
    // 本帧新激活 / 新休眠的区块列表。每次 update 开头清空重填，
    // 让调用方能只处理"变化了的部分"而非全部
    this.enteredChunks = [];
    this.exitedChunks = [];
    // currentChunkKey（相机当前所在的格子编号）
    this.currentChunkKey = null;
    // ---- 三个累计统计量，供性能面板显示 ----
    // 累计的激活/休眠切换次数。这个数字若增长过快，
    // 说明滞回带不够宽或格子太小
    this.transitionCount = 0;
    // 累计的"动态物体跨格"次数
    this.dynamicMoveCount = 0;
    // 上次 update 的时间戳，用于给事件打时间标记
    this.lastTimestamp = 0;
  }

  // register（登记一个对象，让它接受分块管理）
  // 返回值是一个"注销函数"，调用它就取消登记（详见方法末尾）
  register({
    // id（唯一标识）
    id,
    // bounds（固定包围盒）：静态物体用这个
    bounds = null,
    // getBounds（取包围盒的函数）：动态物体用这个，每帧现问现答
    getBounds = null,
    // dynamic（是否会移动）
    dynamic = false,
    // renderType（渲染类别）：本系统不解读它，只是原样存着，
    // 让渲染层能按类别分批处理
    renderType = null,
    // data（附带数据）：同样只存不解读，是调用方挂载自己对象的口子
    data = null,
  }: ChunkRegisterOptions): () => boolean {
    // id 必须是非空字符串。trim() === "" 挡住 "   " 这种全空格的 id——
    // 它能当 Map 的键，但在日志与调试面板里看起来像是空的，极难排查
    if (typeof id !== "string" || id.trim() === "") {
      throw new TypeError("ChunkSystem handle id must be a non-empty string.");
    }
    // 重名直接抛错，不静默覆盖。
    // 【为什么必须抛】覆盖会让旧句柄留在各个区块的 members 表里
    // 却再也无法被注销（handles 表里已经查不到它了），
    // 变成永远激活的幽灵成员
    if (this.handles.has(id)) throw new Error(`Spatial handle already exists: ${id}`);
    // getBounds 传了就必须是函数。允许为 null，但不允许是别的类型——
    // 传个对象进来会在 _resolveBounds 里报"不是函数"，
    // 那时的错误信息里没有 id，定位不到是谁登记错了
    if (getBounds !== null && typeof getBounds !== "function") {
      throw new TypeError(`Spatial handle "${id}" getBounds must be a function.`);
    }

    // 立刻求一次包围盒。放在建句柄之前，是为了让校验失败时
    // 不留下任何半成品状态
    const initialBounds = this._resolveBounds({ id, bounds, getBounds });
    const handle = {
      id,
      bounds: initialBounds,
      getBounds,
      // Boolean(...) 强制转成真正的布尔值。
      // 调用方可能传 1、"yes" 这类真值，存成布尔后
      // getMetrics 里的 filter 与调试输出才不会出现 "dynamic: 1"
      dynamic: Boolean(dynamic),
      renderType,
      data,
      // chunkKeys（本句柄横跨的格子集合）：
      // 一个大物体（比如一整片箱区）可能同时压在四个格子上。
      // 双向记录——区块知道有哪些成员，句柄也知道自己在哪些区块，
      // 注销时才能不遍历全部区块就精确摘除
      chunkKeys: new Set<string>(),
    };
    this.handles.set(id, handle);
    // 算出它落在哪些格子里并建立归属关系
    this._setHandleChunks(handle, this._getChunkKeys(initialBounds));
    // 返回一个闭包当"注销票"。
    // 【为什么这样设计】调用方不必自己保存 id、也不必持有本系统的引用，
    // 拿着这个函数一调就干净退出。这是 JS 里资源管理的常见惯例
    //（与 subscribe 返回退订函数同理）
    return () => this.unregister(id);
  }

  // unregister（注销一个登记）
  unregister(id: string): boolean {
    const handle = this.handles.get(id);
    // 找不到返回 false 而不抛错：重复注销是常见的（比如注销票被调了两次），
    // 不该因此崩掉整个应用
    if (!handle) return false;
    // [...handle.chunkKeys] 先展开成数组再遍历。
    // 【必须先复制】_removeHandleFromChunk 内部会 delete 这个 Set 的元素，
    // 边遍历边删同一个集合，行为不可靠、会漏掉一些格子，
    // 留下摘不掉的残留成员
    [...handle.chunkKeys].forEach((key) => this._removeHandleFromChunk(handle, key));
    this.handles.delete(id);
    return true;
  }

  // subscribe（订阅区块进出事件）
  subscribe(listener: (event: ChunkEvent) => void): () => boolean {
    if (typeof listener !== "function") throw new TypeError("Chunk listener must be a function.");
    this.listeners.add(listener);
    // 同样返回一个退订函数
    return () => this.listeners.delete(listener);
  }

  // update（每帧调用：按相机位置刷新所有区块的激活状态）
  //   cameraPosition（相机世界坐标）
  //   timestamp（时间戳）：只用来给事件打标记，本系统自己不做时间相关运算
  //   isVisible（可见性判断函数）：由调用方注入，通常是视锥剔除
  update(cameraPosition: THREE.Vector3, timestamp = 0, { isVisible = null }: ChunkUpdateOptions = {}): ChunkSnapshot {
    // 用 ?.isVector3 判断而非 instanceof（是否某类的实例）。
    // 【为什么】isVector3 是 Three.js 给自家类打的标记属性。
    // 项目里若同时存在两份 Three.js（依赖重复安装很常见），
    // instanceof 会对另一份里的 Vector3 判否，报出莫名其妙的类型错误；
    // 看标记属性则两份都认。?. 顺带挡住 null 与 undefined
    if (!cameraPosition?.isVector3) {
      throw new TypeError("ChunkSystem.update requires a THREE.Vector3 camera position.");
    }

    this.lastTimestamp = timestamp;
    // 每帧开头清空进出列表。
    // 【必须清空】不清的话列表会无限增长，调用方每帧都重复处理
    // 早就进过的区块，几分钟后内存也撑不住
    this.enteredChunks = [];
    this.exitedChunks = [];
    // 先同步移动物体的新位置，再算距离。
    // 【顺序不能反】反了的话本帧用的是上一帧的旧位置，
    // 快速移动的物体会延迟一帧才切换区块，
    // 表现为车开进新区域时那一片物体晚一帧才出现
    this._syncDynamicHandles();
    this.currentChunkKey = this.getChunkKeyAt(cameraPosition);

    // 遍历全部区块，逐个判断该激活还是休眠
    this.chunks.forEach((chunk) => {
      // 用"点到盒子的水平距离"而不是"点到盒子中心的距离"。
      // 【区别很重要】相机站在一个大区块内部时，到中心可能还有 100 米，
      // 但它其实已经在里面了，距离应当是 0。用中心距离会导致
      // 脚下的区块反而因为"太远"而不激活
      chunk.distance = distanceToBoxXZ(cameraPosition, chunk.bounds);
      // 可见性由外部注入的函数决定，没注入就一律算可见。
      // 【注意可见性与激活是两件独立的事】背后的区块不可见（不必画），
      // 但仍然激活（逻辑要跑，物体要更新位置）。
      // 把两者混为一谈会让相机一转身，背后的车全部停住不动
      chunk.visible = typeof isVisible === "function" ? Boolean(isVisible(chunk)) : true;
      // 滞回判断：两条分支用两个不同的阈值。
      // 处在 1500~1700 之间时两条都不成立，保持现状——这就是滞回带在起作用
      if (!chunk.active && chunk.distance <= this.loadDistance) {
        this._setChunkActive(chunk, true);
      } else if (chunk.active && chunk.distance > this.unloadDistance) {
        this._setChunkActive(chunk, false);
      }
    });

    // 顺手返回快照，调用方不必再单独调 getSnapshot
    return this.getSnapshot();
  }

  // getChunkKeyAt（查某个世界坐标属于哪个格子）
  getChunkKeyAt(position: THREE.Vector3): string {
    // 除以格子边长再向下取整。
    // Math.floor（向下取整）而非 Math.trunc（截断小数）是关键：
    // 坐标 -10 除以 160 得 -0.0625，floor 得 -1（正确，它在左边那格），
    // trunc 得 0（错误，会把 -160~0 与 0~160 两格混为一格）。
    // Y 轴不参与——本系统只按水平面分块
    return this._chunkKey(
      Math.floor(position.x / this.chunkSize),
      Math.floor(position.z / this.chunkSize),
    );
  }

  // getChunk（按编号取区块）
  getChunk(key: string): ChunkRecord | null {
    return this.chunks.get(key) ?? null;
  }

  // getActiveChunks（取全部已激活区块）
  getActiveChunks(): ChunkRecord[] {
    // 展开成新数组，不把内部 Map 的迭代器交出去
    return [...this.activeChunks.values()];
  }

  // getSnapshot（取本帧状态快照）
  getSnapshot(): ChunkSnapshot {
    // Object.freeze（冻结）让返回的对象不可修改。
    // 【为什么要冻结】快照会传给渲染层、界面、调试面板多个消费方。
    // 冻结能在开发阶段立刻暴露"某处偷偷改了共享状态"这类错误，
    // 否则 A 模块改了快照会诡异地影响 B 模块的行为。
    // 注意冻结是浅层的——里面的 chunk 对象本身仍可改，
    // 这是刻意的，因为 chunk.visible 之类的字段确实需要每帧更新
    return Object.freeze({
      currentChunkKey: this.currentChunkKey,
      activeChunks: this.getActiveChunks(),
      // 展开成副本，理由同上：调用方 push/splice 不该影响下一帧
      enteredChunks: [...this.enteredChunks],
      exitedChunks: [...this.exitedChunks],
    });
  }

  // getMetrics（取度量指标）：给性能面板看的一组数字
  getMetrics(): ChunkMetrics {
    return {
      chunkSize: this.chunkSize,
      currentChunk: this.currentChunkKey,
      // 已建出来的格子总数（空格子会被删掉，所以这个数会涨也会跌）
      totalChunks: this.chunks.size,
      activeChunks: this.activeChunks.size,
      // 既激活又可见的格子数。
      // 【为什么要单独统计】activeChunks 与 visibleActiveChunks 的差额
      // 就是"在加载范围内但被视锥剔除掉"的部分。
      // 这个差额越大，说明视锥剔除省下的绘制越多，是衡量剔除效果的直接指标
      visibleActiveChunks: [...this.activeChunks.values()]
        .filter((chunk) => chunk.visible).length,
      spatialHandles: this.handles.size,
      // 动态句柄数。这个数字直接决定 _syncDynamicHandles 每帧的开销
      dynamicHandles: [...this.handles.values()].filter((handle) => handle.dynamic).length,
      enteredLastUpdate: this.enteredChunks.length,
      exitedLastUpdate: this.exitedChunks.length,
      transitions: this.transitionCount,
      dynamicMoves: this.dynamicMoveCount,
    };
  }

  // clear（清空全部状态）：切换场景或重建世界时用
  clear() {
    this.handles.clear();
    this.chunks.clear();
    this.activeChunks.clear();
    // 连监听函数一起清掉。
    // 【这一点容易踩坑】清空后原有的订阅全部失效，
    // 调用方必须重新 subscribe。若这里不清，
    // 旧监听函数会继续收到新世界的区块事件，
    // 而它们持有的是已销毁的旧场景对象引用
    this.listeners.clear();
    this.enteredChunks = [];
    this.exitedChunks = [];
    this.currentChunkKey = null;
    // 【注意】transitionCount 与 dynamicMoveCount 刻意不清零——
    // 它们是整个会话的累计统计，用于观察长时间运行的趋势，
    // 清零会让性能曲线出现断点
  }

  // _resolveBounds（内部方法：求出一个句柄当前的包围盒）
  private _resolveBounds({ id, bounds, getBounds }: { id: string; bounds: THREE.Box3 | null; getBounds: (() => THREE.Box3) | null }): THREE.Box3 {
    // getBounds 优先于 bounds。
    // 【为什么这个顺序】动态物体两者可能都有：bounds 是登记时的初值，
    // getBounds 才是实时值。取函数结果才能拿到当前位置。
    // ?. 让"没有 getBounds"时安全地退回静态 bounds
    const resolved = getBounds?.() ?? bounds;
    // 必须是非空 Box3。isEmpty()（是否为空盒）挡住 min > max 的退化盒子——
    // 那种盒子算 _getChunkKeys 时循环一次都不执行，
    // 句柄会静默地不属于任何格子，永远不被激活，
    // 表现为"这个物体怎么都不出现"却毫无报错
    if (!resolved?.isBox3 || resolved.isEmpty()) {
      throw new TypeError(`Spatial handle "${id}" requires a non-empty THREE.Box3.`);
    }
    // clone（克隆）后返回。
    // 【必须克隆】调用方的 getBounds 常常返回自己内部复用的那一个 Box3
    //（为了省对象），若直接存下来，它下一帧一改我们手里的记录就跟着变了，
    // _syncDynamicHandles 里的 equals 比较永远为真，跨格永远检测不到
    return resolved.clone();
  }

  // _syncDynamicHandles（内部方法：同步所有动态句柄的位置变化）
  private _syncDynamicHandles(): void {
    this.handles.forEach((handle) => {
      // 静态的、或没提供取值函数的，都跳过。
      // 这个提前返回是本方法的性能命脉——上万个静态箱子每帧只花一次判断
      if (!handle.dynamic || !handle.getBounds) return;
      const nextBounds = this._resolveBounds(handle);
      // 位置完全没变就什么也不做（车停着的时候常见）
      if (nextBounds.equals(handle.bounds)) return;

      const nextKeys = this._getChunkKeys(nextBounds);
      // membershipChanged（归属是否变了）：
      // 【这一步是关键的分级优化】物体动了不等于换格子了。
      // 车在同一格里开了两米，包围盒变了但格子没变，
      // 此时只需更新记录的坐标，完全不必碰区块的成员表。
      // 少了这个判断，每辆动态车每帧都要走一遍
      // 摘除-重加-通知监听 的完整流程，几十辆车就能把帧率吃掉
      const membershipChanged = !setsEqual(handle.chunkKeys, nextKeys);
      // copy（就地拷贝值）而非 handle.bounds = nextBounds。
      // 【区别】copy 复用已有对象，不产生垃圾；直接赋值会让旧对象
      // 每帧变成垃圾，几十个动态物体持续跑下来会引发频繁的垃圾回收，
      // 表现为规律性的帧率抖动
      handle.bounds.copy(nextBounds);
      // 没换格子，到此为止
      if (!membershipChanged) return;

      this._setHandleChunks(handle, nextKeys);
      this.dynamicMoveCount += 1;
    });
  }

  // _getChunkKeys（内部方法：算出一个包围盒压在哪些格子上）
  private _getChunkKeys(bounds: THREE.Box3): Set<string> {
    // ---- 边界归属修正 ----
    // 【要解决什么】一个盒子从 x=0 延伸到 x=160，格子边长也是 160。
    // 直接对 max.x=160 取整得到格子 1，于是这个盒子被算成
    // 同时占了格子 0 与格子 1——但它其实只贴着 1 号格的左边界，
    // 一丝一毫都没进去。这会让每个恰好对齐格子的物体
    // 都多占一格甚至多占三格（四个角），激活范围虚增、白加载一堆东西。
    // 【怎么修】把上界往回缩一个极小量再取整。
    // 前面的三元判断挡住"零厚度的盒子"（min == max，比如一个点）：
    // 那种情况若也往回缩，会缩到上一格去，导致这个点属于错误的格子
    const maxX = bounds.max.x > bounds.min.x ? bounds.max.x - EDGE_EPSILON : bounds.max.x;
    const maxZ = bounds.max.z > bounds.min.z ? bounds.max.z - EDGE_EPSILON : bounds.max.z;
    // 算出格子下标的取值范围
    const minChunkX = Math.floor(bounds.min.x / this.chunkSize);
    const maxChunkX = Math.floor(maxX / this.chunkSize);
    const minChunkZ = Math.floor(bounds.min.z / this.chunkSize);
    const maxChunkZ = Math.floor(maxZ / this.chunkSize);
    const keys = new Set<string>();

    // 双重循环遍历这个矩形范围内的所有格子。
    // 用 <= 而非 <：max 那一格自己也要算进去
    for (let x = minChunkX; x <= maxChunkX; x += 1) {
      for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
        keys.add(this._chunkKey(x, z));
      }
    }
    return keys;
  }

  // _setHandleChunks（内部方法：把句柄的归属关系更新为新的一组格子）
  private _setHandleChunks(handle: SpatialHandle, nextKeys: Set<string>): void {
    // 【为什么算差集而不是"全摘掉再全加上"】
    // 一辆车从 4 个格子挪到相邻的 4 个格子，通常有 2 个是重叠的。
    // 全摘全加会让那 2 个格子的 revision（版本号）无谓地跳两次，
    // 渲染层看到版本变化就会重建那一格的批次——白重建。
    // 只处理真正变化的部分，重叠的格子完全不受扰动。
    // 第一步：摘掉"旧的里面有、新的里面没有"的
    [...handle.chunkKeys]
      .filter((key) => !nextKeys.has(key))
      .forEach((key) => this._removeHandleFromChunk(handle, key));
    // 第二步：加上"新的里面有、旧的里面没有"的
    [...nextKeys]
      .filter((key) => !handle.chunkKeys.has(key))
      .forEach((key) => this._addHandleToChunk(handle, key));
    // 最后整体替换。
    // 【为什么不能省这一步】上面第一步靠 _removeHandleFromChunk 顺带
    // 删了 chunkKeys 里的旧项，但第二步的 _addHandleToChunk 并不往
    // chunkKeys 里加新项。这里 new Set(nextKeys) 一次性对齐，
    // 同时复制一份而非直接引用 nextKeys——那是个临时集合，
    // 直接引用会让两处状态意外地共享
    handle.chunkKeys = new Set(nextKeys);
  }

  // _addHandleToChunk（内部方法：把句柄加进某个格子）
  private _addHandleToChunk(handle: SpatialHandle, key: string): void {
    // 格子不存在就现建一个（懒建策略，见构造函数的说明）
    const chunk = this.chunks.get(key) ?? this._createChunk(key);
    chunk.members.set(handle.id, handle);
    // revision（版本号）自增。
    // 【它的用处】渲染层缓存了"这一格该画哪些东西"的批次数据。
    // 它每帧比对版本号，变了才重建批次，没变就直接复用。
    // 这比每帧对比成员列表快得多——一个整数比较顶替一次集合遍历
    chunk.revision += 1;
  }

  // _removeHandleFromChunk（内部方法：把句柄从某个格子摘掉）
  private _removeHandleFromChunk(handle: SpatialHandle, key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    chunk.members.delete(handle.id);
    chunk.revision += 1;
    handle.chunkKeys.delete(key);
    // 格子里还有别的成员，就留着它
    if (chunk.members.size > 0) return;

    // 格子空了，回收掉。
    // 【必须先派发休眠事件再删除】否则渲染层收不到 exit 通知，
    // 它为这一格建的 GPU 资源（批次、纹理）就永远没人来释放，
    // 成为显存泄漏。顺序反了的话，删除后监听方拿到的是一个
    // 已经不在表里的孤立对象，无法正确清理
    if (chunk.active) this._setChunkActive(chunk, false);
    this.chunks.delete(key);
  }

  // _createChunk（内部方法：现建一个格子）
  private _createChunk(key: string): ChunkRecord {
    // 从编号字符串里反解出两个下标。
    // split(":") 得到 ["3", "-2"]，.map(Number) 转成 [3, -2]。
    // 【为什么要反解而不是把下标传进来】保证编号是唯一的信息来源。
    // 若同时传 key 与 x/z 两套参数，一旦调用点算错其中一个，
    // 格子的编号与它的实际坐标就会不一致，排查起来极其困难
    const [x, z] = key.split(":").map(Number);
    const minX = x * this.chunkSize;
    const minZ = z * this.chunkSize;
    const chunk = {
      key,
      x,
      z,
      // 格子的包围盒：水平方向是这一格的范围，
      // 竖直方向从 -WORLD_Y_LIMIT 到 +WORLD_Y_LIMIT（见常量处的说明）
      bounds: new THREE.Box3(
        new THREE.Vector3(minX, -WORLD_Y_LIMIT, minZ),
        new THREE.Vector3(minX + this.chunkSize, WORLD_Y_LIMIT, minZ + this.chunkSize),
      ),
      // members（本格里的成员）：句柄 id -> 句柄对象。
      // 用 Map 而非数组：按 id 删除是 O(1)，数组要先 indexOf 再 splice
      members: new Map(),
      // 新建的格子默认休眠。
      // 【为什么不根据距离立刻判断】新建发生在 _addHandleToChunk 里，
      // 那时手上没有相机位置。留给下一次 update 统一判断，
      // 逻辑只有一处、不会两套判断标准不一致
      active: false,
      // 默认可见（乐观假设）。若默认 false，
      // 在调用方没注入 isVisible 的场景里所有格子都会被判不可见
      visible: true,
      // 距离初值设为 Infinity（无穷远）。
      // 【为什么是无穷而不是 0】0 意味着"就在脚下"，
      // 若某帧因为异常没走到距离计算，这一格会被误判为该激活。
      // 初值取最悲观的值，让"未知"永远倾向于不加载
      distance: Infinity,
      revision: 0,
    };
    this.chunks.set(key, chunk);
    return chunk;
  }

  // _setChunkActive（内部方法：切换一个格子的激活状态并派发事件）
  private _setChunkActive(chunk: ChunkRecord, active: boolean): void {
    // 状态没变就直接返回。
    // 【这道守卫是必须的】它保证了"每次状态翻转恰好派发一次事件"。
    // 少了它，update 里若某帧重复调用，监听方会收到两次 enter，
    // 渲染层就建两套重复的批次——画面上物体出现重影
    if (chunk.active === active) return;
    chunk.active = active;
    this.transitionCount += 1;
    // 事件对象也冻结，理由同 getSnapshot：多个监听方共享同一个事件对象，
    // 任何一方改了都会影响后面的监听方
    const event = Object.freeze({
      type: active ? "enter" : "exit",
      // 【注意这里传的是 chunk 本身而非副本】监听方需要访问
      // chunk.members 去建立/销毁资源，副本无法承担这个职责。
      // 冻结的只是外层事件对象，chunk 仍是活的引用
      chunk,
      timestamp: this.lastTimestamp,
    });

    if (active) {
      this.activeChunks.set(chunk.key, chunk);
      this.enteredChunks.push(chunk);
    } else {
      this.activeChunks.delete(chunk.key);
      this.exitedChunks.push(chunk);
    }
    // 最后才通知监听方。
    // 【顺序很重要：必须先改完内部状态】监听函数里很可能回头调用
    // getActiveChunks 或 getSnapshot。若在更新表之前就通知，
    // 它拿到的是"事件说进来了，但列表里还没有"的矛盾状态
    this.listeners.forEach((listener) => listener(event));
  }

  // _chunkKey（内部方法：把两个下标拼成格子编号）
  private _chunkKey(x: number, z: number): string {
    // 拼成 "3:-2" 这样的字符串。
    // 【为什么用字符串做键】Map 用引用相等判断，
    // { x: 3, z: -2 } 这样的对象每次都是新的、永远查不到。
    // 字符串按值比较，天然可查。
    // 分隔符用 ":" 而非 ","——负数坐标下 "3,-2" 与 "3-2" 之类的
    // 组合容易看错，冒号在视觉上分隔更清楚
    return `${x}:${z}`;
  }
}

// distanceToBoxXZ（求点到盒子的水平距离）
//
// 【算法】把点的坐标钳制到盒子的范围内，得到盒子上离该点最近的那个点，
// 再求两点距离。这是"点到轴对齐盒"的经典解法：
//
//   点在盒外时：           点在盒内时：
//   ┌─────┐                ┌─────┐
//   │     │  ●点           │  ●  │  钳制后 = 点自己
//   │   ○─┼──┘             │     │  距离 = 0（正确！）
//   └─────┘  钳制得到 ○     └─────┘
//
// 【为什么写成模块级函数而不是类方法】它不依赖任何 this 状态，
// 是一个纯函数。放在类外能让人一眼看出这一点，
// 也方便将来单独提取去做测试
export function distanceToBoxXZ(position: THREE.Vector3, box: THREE.Box3): number {
  // clamp（钳制）：小于 min 取 min，大于 max 取 max，在中间则不变
  const x = THREE.MathUtils.clamp(position.x, box.min.x, box.max.x);
  const z = THREE.MathUtils.clamp(position.z, box.min.z, box.max.z);
  // 【刻意忽略 Y 轴】相机飞到一百米高俯视时，若把高度差算进去，
  // 脚下的格子会因为"垂直距离 100 米"而显得更远。
  // 本系统按水平面分块，距离也只该看水平面。
  // Math.hypot（求斜边）比手写 Math.sqrt(a*a + b*b) 更稳妥：
  // 它内部做了防溢出处理，且意图更明确
  return Math.hypot(position.x - x, position.z - z);
}

// setsEqual（判断两个集合内容是否相同）
function setsEqual(left: Set<string>, right: Set<string>): boolean {
  // 先比大小再逐个比对。
  // 【为什么先比 size】这是一步廉价的短路：绝大多数"变了"的情况
  // 都伴随元素个数变化，一个整数比较就能得出结论，
  // 不必进入 every 的遍历。
  // 而且这一步是正确性的必要条件——只做 every 的话，
  // left 是 right 的真子集时会误判为相等
  return left.size === right.size && [...left].every((value) => right.has(value));
}
