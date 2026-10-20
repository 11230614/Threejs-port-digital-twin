// ============================================================================
// LODSystem.js —— 细节层级系统（LOD：Level of Detail，按距离决定画多细）
//
// 【这个文件干什么】
// 回答一个问题："这一格东西，现在该用第几档精度来画？"
// 近处的箱子要有棱有角有贴图，几百米外的箱子只需一个色块。
// 本系统只做决策，输出一串"某格从 0 档变成 2 档"的通知。
//
//   相机 ●───────────────────────────────────────→ 远
//        │  LOD0   │  LOD1   │  LOD2   │  LOD3（隐藏）
//        │ 完整模型 │ 简化模型 │  色块   │  不画
//
// 【本文件同样一行三维代码都没有】
// 与 ChunkSystem 一样是纯决策层：不 new Mesh、不改材质、不碰场景。
// 真正换模型的活由渲染层收到 dirtyChunks（脏区块通知）后去做。
// 这样切分的好处是本文件可以在 Node 里跑单元测试（对应 test:lod），
// 而且换档策略改动不会牵连渲染代码。
//
// 【两道防抖机制，解决同一个病】
// 病症：相机在档位分界线附近来回一动，某格就在 LOD1/LOD2 之间反复横跳，
// 渲染层每次都要销毁旧模型建新模型，帧率被撕成锯齿。
//   第一道 · enter / exit 双阈值（滞回，hysteresis）
//     每档有两个距离：enter（进入该档的距离）比 exit（退出该档的距离）近。
//     升档看 enter、降档看 exit，中间那段区域保持现状。
//   第二道 · debounceMs 时间防抖（debounce）
//     即使距离越了线，也要连续 200 毫秒都指向新档位才真的换。
//     镜头快速划过时的瞬时穿越会被这一道全部吃掉。
// 两道机制正交：一道管空间上的抖动，一道管时间上的抖动。
//
// 【档位编号的方向约定：数字越小越精细】
// LOD0 最清楚，hiddenLevel（默认 3）最粗——直接不画。
// 全文件多处比较（比如 closerLevel < currentLevel）都依赖这个约定。
//
// 【术语翻译】
//   LOD（Level of Detail，细节层级）
//   level（档位）           hiddenLevel（隐藏档，即不绘制）
//   enter / exit（进入阈值 / 退出阈值）
//   hysteresis（滞回）       debounce（防抖，等信号稳定后才响应）
//   candidate（候选档位，正在观察但还没生效的目标档）
//   commit（提交，把变更正式记入通知列表）
//   dirty（脏的，指状态变了需要下游处理）
//   revision（版本号）       membership（成员归属）
//   state（状态记录）        peek / consume（只看 / 取走）
//   metrics（度量指标）      validate（校验）
//   Object.freeze（冻结对象）
//   Number.isFinite / isInteger（是否有限数 / 是否整数）
// ============================================================================

import type * as THREE from "three";
import type { SpatialHandle } from "../chunk/ChunkSystem";

export interface LODLevelDefinition {
  level: number;
  enter: number;
  exit: number;
}

export interface LODChunkLike {
  key: string;
  bounds: { distanceToPoint(point: THREE.Vector3): number };
  members?: Map<string, SpatialHandle>;
  distance?: number;
  visible?: boolean;
  revision?: number;
  [key: string]: unknown;
}

export interface LODDirtyChunk {
  readonly chunkId: string;
  readonly chunk: LODChunkLike;
  readonly previousLevel: number | null;
  readonly nextLevel: number;
  readonly distance: number;
  readonly reason: string;
  readonly timestamp: number;
}

interface LODState {
  chunkId: string;
  chunk: LODChunkLike;
  level: number;
  distance: number;
  visible: boolean;
  revision: number;
  candidateLevel: number | null;
  candidateSince: number | null;
  candidateReason: string | null;
}

export interface LODUpdateInput {
  cameraPosition: THREE.Vector3;
  activeChunks: LODChunkLike[];
  timestamp?: number;
}

export interface LODMetrics {
  trackedChunks: number;
  dirtyChunks: number;
  levels: Record<number, number>;
  switches: number;
  debounceResets: number;
  debounceMs: number;
}

/**
 * Chunk-level LOD decision system. It never creates or mutates Three.js objects.
 */
// 上面这段英文原注释的意思：
//   区块级别的 LOD 决策系统。它从不创建也从不修改任何 Three.js 对象。
// export（导出）class（类）：声明并公开"细节层级系统"
export class LODSystem {
  readonly levels: readonly Readonly<LODLevelDefinition>[];
  readonly hiddenLevel: number;
  readonly debounceMs: number;
  private states = new Map<string, LODState>();
  private dirtyChunks: LODDirtyChunk[] = [];
  private switchCount = 0;
  private debounceResetCount = 0;
  private lastTimestamp = 0;
  // constructor（构造函数）
  constructor({
    // levels（档位定义表）：每项形如 { level, enter, exit }。
    // 没有默认值——档位划分与具体场景的尺度强相关，
    // 给一个默认值只会掩盖"忘记配置"的错误
    levels,
    // hiddenLevel（隐藏档编号）：默认 3。
    // 距离超出所有档位、或区块不可见时，都归到这一档
    hiddenLevel = 3,
    // debounceMs（防抖时长，毫秒）：默认 200。
    // 【这个值怎么定的】人眼察觉不到 200 毫秒的换档延迟，
    // 但足以吃掉镜头快速摇摆造成的瞬时穿越。
    // 太长（比如 1 秒）会让正常的推近拉远出现明显的"迟迟不变清楚"
    debounceMs = 200,
  }: { levels?: readonly LODLevelDefinition[]; hiddenLevel?: number; debounceMs?: number } = {}) {
    // 档位表要经过一整套校验与排序，见文件末尾的 validateLevels
    this.levels = validateLevels(levels);
    this.hiddenLevel = hiddenLevel;
    // Math.max(0, ...) 挡住负数。
    // 负的防抖时长会让 timestamp - candidateSince < debounceMs
    // 这个判断永远不成立，等于关掉防抖——而且是静默关掉，很难发现
    this.debounceMs = Math.max(0, debounceMs);
    // states（状态表）：格子编号 -> 该格的档位状态记录。
    // 这是本系统唯一的持久状态，防抖所需的"上一次是什么"都存在这里
    this.states = new Map();
    // dirtyChunks（脏区块通知列表）：本帧发生了档位变更的格子
    this.dirtyChunks = [];
    // 累计换档次数。这个数字增长过快就说明防抖参数需要调
    this.switchCount = 0;
    // 累计防抖重置次数：候选档位还没熬满时长就被推翻的次数。
    // 【它是最有价值的诊断指标】这个数远大于 switchCount，
    // 说明相机正在某条分界线上反复摩擦，该把滞回带调宽
    this.debounceResetCount = 0;
    this.lastTimestamp = 0;
  }

  // update（每帧调用：按相机位置刷新所有活动格子的档位）
  update({ cameraPosition, activeChunks, timestamp = 0 }: LODUpdateInput): LODDirtyChunk[] {
    // 同 ChunkSystem 的做法：看 isVector3 标记而不用 instanceof，
    // 避免项目里存在两份 Three.js 时的误判
    if (!cameraPosition?.isVector3) {
      throw new TypeError("LODSystem.update requires a THREE.Vector3 camera position.");
    }
    // activeChunks 必须是数组。
    // 【为什么单独校验】传 null 进来会在 forEach 处报
    // "Cannot read properties of null"，那条信息看不出是哪个系统的问题；
    // 这里提前抛出带系统名的错误，定位快得多
    if (!Array.isArray(activeChunks)) {
      throw new TypeError("LODSystem.update activeChunks must be an array.");
    }

    this.lastTimestamp = timestamp;
    // 每帧清空脏列表。注意这里是直接赋新数组而非 length = 0——
    // 上一帧的数组可能已经被 peekDirtyChunks 的调用方拿走了引用，
    // 就地清空会把别人手里的数据也清掉
    this.dirtyChunks = [];
    // activeKeys（本帧活动格子的编号集合）：下面第二个循环要靠它
    // 反过来找出"不在活动列表里"的格子
    const activeKeys = new Set();

    // ---- 第一轮：处理所有活动格子 ----
    activeChunks.forEach((chunk) => {
      activeKeys.add(chunk.key);
      // 距离优先复用 ChunkSystem 已经算好的值。
      // 【为什么要复用】ChunkSystem 每帧已经算过一次点到盒的距离，
      // 这里再算一遍纯属重复劳动。Number.isFinite 检查
      // 顺带挡住 Infinity（新建格子的初值）与 undefined
      //（调用方传的不是 ChunkSystem 的格子对象）。
      // 兜底路径用 Box3.distanceToPoint，它算的是三维距离而非水平距离——
      // 与 ChunkSystem 的口径略有差异，但只在兜底时用到，可接受
      const distanceValue = chunk.distance;
      const distance = Number.isFinite(distanceValue)
        ? distanceValue as number
        : chunk.bounds.distanceToPoint(cameraPosition);
      this._updateChunkState(chunk, distance, timestamp);
    });

    // ---- 第二轮：处理"曾经活动、现在不在列表里"的格子 ----
    // 【为什么必须有这一轮】ChunkSystem 把远处的格子休眠后，
    // 它就不出现在 activeChunks 里了。若本系统不管，
    // 那些格子的 states 记录会永久停留在最后一次的档位（比如 LOD0），
    // 渲染层认为它们还该用完整模型，那份 GPU 资源永远不释放。
    // 这一轮把它们统一推向 hiddenLevel，让渲染层收到通知去清理
    this.states.forEach((state, chunkId) => {
      // 还在活动列表里的，第一轮已经处理过了
      if (activeKeys.has(chunkId)) return;
      // 理由标记为 "inactive"（已休眠），便于调试时区分换档原因。
      // 注意这里也走 _considerCandidate 而非直接改档——
      // 隐藏同样要经过防抖，否则格子在加载边界上抖动时
      // 会反复"隐藏-恢复"，与不做防抖一样糟
      this._considerCandidate(state, this.hiddenLevel, timestamp, "inactive");
    });

    return this.peekDirtyChunks();
  }

  // getLevel（查某个格子当前的档位）
  getLevel(chunkId: string): number {
    // 没有记录就返回隐藏档。
    // 【为什么用最保守的默认值】未知的格子返回 LOD0 会让渲染层
    // 为一个可能在天边的格子建完整模型。返回隐藏档最多是少画一点，
    // 下一帧 update 就会纠正
    return this.states.get(chunkId)?.level ?? this.hiddenLevel;
  }

  // peekDirtyChunks（只看脏列表，不清空）
  peekDirtyChunks(): LODDirtyChunk[] {
    // 返回副本，防调用方就地修改内部列表
    return [...this.dirtyChunks];
  }

  // consumeDirtyChunks（取走脏列表并清空）
  //
  // 【为什么要 peek 与 consume 两个方法】
  // 消费方分两类：真正干活的渲染层要 consume（取走，处理完就该清掉，
  // 避免下一帧重复处理）；调试面板与性能统计要 peek（只看，
  // 不能把别人该处理的通知偷走）。
  // 若只提供一个方法，两类需求必然有一方被迫将就
  consumeDirtyChunks(): LODDirtyChunk[] {
    const dirty = this.peekDirtyChunks();
    this.dirtyChunks = [];
    return dirty;
  }

  // getMetrics（取度量指标）
  getMetrics(): LODMetrics {
    // levelCounts（各档位的格子数统计）：形如 { 0: 3, 1: 8, 3: 42 }。
    // 【它的用处】一眼看出画面的负载构成。若 LOD0 的数量突然涨到几十，
    // 说明相机贴太近或档位阈值配得太宽，帧率下滑就有了解释
    const levelCounts: Record<number, number> = {};
    this.states.forEach((state) => {
      // ?? 0 处理"这一档第一次出现"的情况，省掉一个 if
      levelCounts[state.level] = (levelCounts[state.level] ?? 0) + 1;
    });
    return {
      trackedChunks: this.states.size,
      dirtyChunks: this.dirtyChunks.length,
      levels: levelCounts,
      switches: this.switchCount,
      debounceResets: this.debounceResetCount,
      // 把当前的防抖时长也报出来，便于在面板上现场核对配置是否生效
      debounceMs: this.debounceMs,
    };
  }

  // clear（清空状态）
  clear() {
    this.states.clear();
    this.dirtyChunks = [];
    // 【与 ChunkSystem.clear 的差异】这里把两个计数器清零了。
    // 因为 LOD 的统计意义是"针对当前这个世界的换档表现"，
    // 换了世界后旧数据没有参考价值，反而会污染调优判断。
    // ChunkSystem 的计数保留是因为那两个指标关注的是长期运行趋势
    this.switchCount = 0;
    this.debounceResetCount = 0;
  }

  // _updateChunkState（内部方法：更新一个格子的档位状态）
  private _updateChunkState(chunk: LODChunkLike, distance: number, timestamp: number): void {
    let state = this.states.get(chunk.key);
    // ---- 分支一：第一次见到这个格子 ----
    if (!state) {
      // chunk.visible === false 才算不可见。
      // 【为什么用严格等于 false 而不是 !chunk.visible】
      // 调用方可能根本没设 visible 字段（undefined）。
      // 用 !visible 会把 undefined 当成"不可见"，
      // 于是所有没标记可见性的格子一律隐藏——整个画面空白。
      // 严格比较 false 让"未表态"默认为可见
      const level = chunk.visible === false
        ? this.hiddenLevel
        // 传 null 当 currentLevel，告诉 _selectLevel"没有历史档位"，
        // 让它跳过滞回逻辑直接按 enter 阈值定档
        : this._selectLevel(distance, null);
      state = {
        chunkId: chunk.key,
        // 存一份格子对象的引用。派发通知时要把它交给渲染层，
        // 渲染层需要 chunk.members 才知道该处理哪些东西
        chunk,
        level,
        distance,
        visible: chunk.visible !== false,
        // revision（成员版本号）：?? 0 兜底，调用方不提供也不会变成 NaN——
        // NaN !== NaN 恒为真，会让下面的 membershipChanged 每帧都判为变了
        revision: chunk.revision ?? 0,
        // 三个 candidate（候选）字段：防抖机制的全部状态。
        // 初值都是 null，表示"当前没有在观察任何待换的档位"
        candidateLevel: null,
        candidateSince: null,
        candidateReason: null,
      };
      this.states.set(chunk.key, state);
      // 首次入档也要派发通知，理由标 "initial"（首次）。
      // 【必须派发】渲染层靠这些通知才知道要为这一格建资源。
      // 不派发的话新格子永远是空的，物体不会出现。
      // previousLevel 传 null 表示"之前没有档位"，
      // 让渲染层能区分"新建"与"换档"两种不同的处理
      this._commit(state, null, level, "initial");
      return;
    }

    // ---- 分支二：已有记录，做增量更新 ----
    // 每帧都重新指向最新的格子对象。
    // 【为什么不能只在首次存】格子对象本身可能被 ChunkSystem 重建
    //（比如成员全走空后又有新成员进来），旧引用指向的是已废弃的对象
    state.chunk = chunk;
    state.distance = distance;
    // membershipChanged（成员是否变了）：靠版本号一个整数比较判断出来
    const membershipChanged = state.revision !== (chunk.revision ?? 0);
    state.revision = chunk.revision ?? 0;
    // visibilityChanged（可见性是否变了）：只用于给通知打理由标记
    const visibilityChanged = state.visible !== (chunk.visible !== false);
    state.visible = chunk.visible !== false;
    // 算出本帧应该是哪一档。传入当前档位，让 _selectLevel 施加滞回
    const targetLevel = chunk.visible === false
      ? this.hiddenLevel
      : this._selectLevel(distance, state.level);
    // 特殊情况：档位没变，但格子里的成员换了。
    // 【为什么要单独处理】渲染层为这一格建的批次里包含哪些物体
    // 是按成员列表来的。成员变了就必须重建批次，哪怕精度档位没变。
    // 这条通知的 previousLevel 与 nextLevel 相同、理由是 "members"，
    // 渲染层据此知道"不用换模型精度，只要刷新成员"。
    // 【注意它绕过了防抖】成员增删是确定性的事件而非抖动，
    // 延迟处理只会让新物体迟迟不出现
    if (membershipChanged && targetLevel === state.level) {
      this._commit(state, state.level, state.level, "members");
      return;
    }
    // 常规路径：把目标档位交给防抖逻辑去裁决
    this._considerCandidate(
      state,
      targetLevel,
      timestamp,
      // 理由标记：可见性相关的优先标 "view"，否则标 "distance"。
      // 这个字符串只影响调试可读性，不参与任何决策
      chunk.visible === false || visibilityChanged ? "view" : "distance",
    );
  }

  // _considerCandidate（内部方法：防抖裁决——目标档位要连续稳定够久才生效）
  //
  // 三条互斥的出路：
  //   1) 目标 == 当前 → 取消观察（抖回来了）
  //   2) 目标 != 正在观察的候选 → 换个候选重新计时
  //   3) 目标 == 候选且已熬满时长 → 真的换档
  private _considerCandidate(state: LODState, targetLevel: number, timestamp: number, reason: string): void {
    // ---- 出路一：目标就是当前档位，无需变更 ----
    if (targetLevel === state.level) {
      // 若之前有候选，说明"刚才想换、现在又不想换了"——这正是一次被
      // 防抖成功拦下的抖动，计入统计
      if (state.candidateLevel !== null) this.debounceResetCount += 1;
      // 三个字段一起清空。
      // 【必须一起清】只清 candidateLevel 会留下过期的 candidateSince，
      // 下次观察新候选时若忘了重设时间，会拿一个很久以前的时间戳去比，
      // 差值早就超过 debounceMs，防抖形同虚设
      state.candidateLevel = null;
      state.candidateSince = null;
      state.candidateReason = null;
      return;
    }

    // ---- 出路二：目标与正在观察的候选不同，重新开始计时 ----
    if (state.candidateLevel !== targetLevel) {
      // 从一个候选切到另一个候选，也算一次防抖重置
      if (state.candidateLevel !== null) this.debounceResetCount += 1;
      state.candidateLevel = targetLevel;
      // 记下开始观察的时刻，这是计时的起点
      state.candidateSince = timestamp;
      // 记下当初的理由。
      // 【为什么要存起来】换档真正生效可能是 200 毫秒后的事，
      // 那一帧传进来的 reason 可能已经变成 "distance" 了，
      // 但触发这次换档的真实原因是当初那个（比如 "view"）。
      // 存下来才能给出准确的诊断信息
      state.candidateReason = reason;
      return;
    }

    // ---- 出路三：同一个候选持续观察中，检查是否熬满时长 ----
    // 没熬满就继续等，什么都不做
    const candidateSince = state.candidateSince;
    if (candidateSince === null || timestamp - candidateSince < this.debounceMs) return;
    const previousLevel = state.level;
    // ?? reason 兜底：candidateReason 理论上必然有值
    //（出路二里一定设过），但防御性地留一条退路
    const commitReason = state.candidateReason ?? reason;
    // 正式换档
    state.level = targetLevel;
    // 清空候选状态，为下一轮观察做准备
    state.candidateLevel = null;
    state.candidateSince = null;
    state.candidateReason = null;
    this._commit(state, previousLevel, targetLevel, commitReason);
  }

  // _commit（内部方法：把一次档位变更记入脏列表）
  private _commit(state: LODState, previousLevel: number | null, nextLevel: number, reason: string): void {
    this.switchCount += 1;
    // 冻结通知对象：它会被派发给多个消费方（渲染层、调试面板），
    // 任何一方就地修改都会污染其他方看到的数据
    this.dirtyChunks.push(Object.freeze({
      chunkId: state.chunkId,
      chunk: state.chunk,
      // 同时给出前后两个档位。
      // 【为什么下游需要"之前是几档"】渲染层要据此决定怎么过渡：
      // 从 LOD2 升到 LOD0 要建高精模型，从 LOD0 降到隐藏档要释放资源，
      // 只知道目标档位无法判断该建还是该拆
      previousLevel,
      nextLevel,
      distance: state.distance,
      reason,
      timestamp: this.lastTimestamp,
    }));
  }

  // _selectLevel（内部方法：施加滞回，选出目标档位）
  //
  // 【滞回的实现思路】"变清楚"要求严格，"变模糊"要求宽松：
  //   升档（变清楚）看 enter 阈值 —— 必须真的靠得足够近
  //   降档（变模糊）看 exit 阈值 —— 要离得更远才肯放弃当前精度
  // 由于 exit > enter，两者之间那段距离是"保持现状区"。
  //
  //   ├── LOD0 ──┼─保持区─┼── LOD1 ──┤
  //          enter1    exit0
  //   相机在保持区内来回移动，档位一动不动。
  private _selectLevel(distance: number, currentLevel: number | null): number {
    // 先按 enter 阈值算出"这个距离最精细可以到哪一档"
    const closerLevel = this._classify(distance, "enter");
    // 两种情况直接采纳这个更精细的结果：
    //   currentLevel === null —— 首次定档，没有历史，无从滞回
    //   closerLevel < currentLevel —— 升档（数字更小 = 更精细）。
    // 【升档为什么不需要滞回】用户主动把镜头推近，期待的就是立刻变清楚。
    // 让升档也走滞回会造成"明明贴到跟前了还是糊的"，体验很差。
    // 抖动带来的重复升降由时间防抖那一层拦住，这里不必重复设防
    if (currentLevel === null || closerLevel < currentLevel) return closerLevel;

    // 走到这里说明是"想降档"。先取出当前档位的定义
    const current = this.levels.find((definition) => definition.level === currentLevel);
    // 距离还在当前档的 exit 阈值之内，就赖着不走。
    // 【这一行就是滞回的本体】少了它，enter 与 exit 两个阈值形同一个，
    // 相机在分界线上一动就来回换档
    if (current && distance <= current.exit) return currentLevel;
    // 确实超出了 exit，按 exit 阈值重新分档。
    // 【为什么降档也用 exit 而不用 enter】用 enter 会一次性掉太多档：
    // 距离刚超过 exit0 时，按 enter 分类可能已经落到 LOD2 了，
    // 跳过了 LOD1。用 exit 分类得到的是相邻的下一档，过渡更平滑
    return this._classify(distance, "exit");
  }

  // _classify（内部方法：按指定阈值找出距离所属的档位）
  //   thresholdName（用哪个阈值）："enter" 或 "exit"
  private _classify(distance: number, thresholdName: "enter" | "exit"): number {
    // find（找第一个满足条件的）：档位表已按 level 升序排好
    //（validateLevels 保证），且阈值随档位递增，
    // 所以第一个"阈值 >= 距离"的档位就是答案。
    // level[thresholdName] 是动态属性访问，让同一段逻辑
    // 能服务 enter 与 exit 两套阈值，省掉一个几乎重复的方法
    const definition = this.levels.find((level) => distance <= level[thresholdName]);
    // 找不到（比距离最远那档的阈值还远）就归到隐藏档
    return definition?.level ?? this.hiddenLevel;
  }
}

// validateLevels（校验并规范化档位定义表）
//
// 【为什么值得这么多校验】档位表配错的后果是"画面莫名其妙"而不是报错：
// 阈值写反会让物体越远越清楚，档位重复会让 find 永远命中前一个，
// 这类问题在运行时极难定位。启动时一次性全部查明，代价可以忽略。
//
// 【为什么写成模块级函数】它是纯函数（不依赖 this），
// 而且在构造函数体第一行就要用到——那时实例还没初始化完
export function validateLevels(levels?: readonly LODLevelDefinition[]): readonly Readonly<LODLevelDefinition>[] {
  // 至少要有一档
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError("LODSystem requires at least one LOD level definition.");
  }

  const sorted = levels
    // 先逐项浅拷贝。
    // 【必须拷贝】下面要 Object.freeze（冻结）它们。
    // 若直接冻结调用方传进来的对象，调用方那边的配置对象
    // 也会跟着变成不可改的，可能破坏它自己的逻辑——
    // 这是一种不该有的副作用
    .map((definition) => ({ ...definition }))
    // 按档位编号升序排序。
    // 【为什么要排序】_classify 依赖 find 从近到远扫描。
    // 若调用方写成 [LOD2, LOD0, LOD1] 这样的顺序，
    // find 会先撞上 LOD2 的阈值并返回，近处的物体也用最粗的模型。
    // 主动排序让调用方不必操心书写顺序
    .sort((left, right) => left.level - right.level);
  sorted.forEach((definition, index) => {
    // 档位编号必须是非负整数。
    // isInteger 挡住 1.5 这类值——它能参与比较，但会让
    // levelCounts 的键变成 "1.5"，与渲染层按整数写死的分支对不上
    if (!Number.isInteger(definition.level) || definition.level < 0) {
      throw new TypeError("LOD level must be a non-negative integer.");
    }
    // 两个阈值都必须是有限数。NaN 会让所有 distance <= NaN 比较为假，
    // 该档位永远命中不了；Infinity 会让它吞掉所有距离
    if (!Number.isFinite(definition.enter) || !Number.isFinite(definition.exit)) {
      throw new TypeError(`LOD${definition.level} requires finite enter/exit distances.`);
    }
    // enter 必须 <= exit。
    // 【写反的后果】滞回方向颠倒：升档比降档更容易，
    // 相机在分界线附近会被推入"每帧都换档"的死循环，
    // 恰好是滞回本该防止的问题被放大了一倍
    if (definition.enter > definition.exit) {
      throw new RangeError(`LOD${definition.level} enter distance must be <= exit distance.`);
    }
    // 相邻档位的 enter 必须严格递增。
    // 【为什么必须严格（用 <= 判错而非 <）】相等也不行：
    // 两档的 enter 一样时 find 永远只能命中前一档，
    // 后一档成了死配置，永远选不到
    if (index > 0 && definition.enter <= sorted[index - 1].enter) {
      throw new RangeError("LOD enter distances must increase by level.");
    }
    // exit 同理也要严格递增
    if (index > 0 && definition.exit <= sorted[index - 1].exit) {
      throw new RangeError("LOD exit distances must increase by level.");
    }
  });
  // 双层冻结：外层数组不可增删，内层每个定义对象不可改字段。
  // 【为什么要冻结】档位表是本系统所有决策的基准。
  // 若运行中被某处偷偷改了一个阈值，之前所有格子的档位判断
  // 都建立在旧基准上，会出现一片格子档位互相矛盾的诡异画面。
  // 冻结把这类错误变成立刻抛出的异常
  return Object.freeze(sorted.map((definition) => Object.freeze(definition)));
}
