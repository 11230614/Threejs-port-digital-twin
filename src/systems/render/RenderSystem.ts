// ============================================================================
// systems/render/RenderSystem.js —— 空间渲染调度系统
//                                  （Spatial Render System：把 LOD 决策派发下去）
//
// 【这个文件干什么】
// LODSystem 只说"第 3 号格子该降到 2 档了"，本文件负责把这句话
// 翻译成具体动作：找出那一格里都有什么，按类别分好，
// 交给对应的 adapter（适配器）去真正换模型。
//
//   LODSystem                本文件                    各适配器
//   ─────────                ──────                    ────────
//   "chunk 3:1 → LOD2"  →  取出成员                →  container 适配器
//                          按 renderType 分组       →  vehicle 适配器
//                          逐组调 applyChunkLOD     →  building 适配器
//
// 【为什么要有适配器这一层】
// 集装箱是实例化批次、车是独立模型、建筑是静态合批，
// 三者"降档"的具体做法毫无共同之处。若把三套逻辑都塞进本文件，
// 它会随着物体种类增加而无限膨胀。
// 改成登记制后，新增一类物体只需写一个新适配器，本文件一行都不用动——
// 这是开闭原则（对扩展开放、对修改封闭）的直接体现。
//
// 【文件名撞车提醒】
// 项目里有两个 RenderSystem.js，职责完全不同：
//   · 本文件（systems/render/）—— 只做 LOD 决策的派发调度
//   · rendering/RenderSystem.js —— 真正的渲染循环与后处理（EffectComposer）
// 原注释末尾那句英文就是在提醒这件事。
//
// 【术语翻译】
//   adapter（适配器，把统一接口翻译成各类物体的具体做法）
//   renderType（渲染类别）   handle（登记句柄）
//   dirty chunk（脏区块，指档位发生了变化的格子）
//   transition（变更事件）   consume（取走）
//   metrics（度量指标）
//   Object.fromEntries（由键值对数组构造对象）
//   开闭原则（Open-Closed Principle）
//
// 原 JS 中的中文实现注释均保留在对应逻辑附近；本模块不创建渲染帧循环，
// 不注册 DOM/resize 监听，不拥有 Renderer、Controls、Composer 或 GPU 资源。
// ============================================================================

import type { LODDirtyChunk, LODSystem } from "../lod/LODSystem";
import type { SpatialHandle } from "../chunk/ChunkSystem";

export interface SpatialRenderAdapterContext<TItem = unknown> {
  chunkId: string;
  level: number;
  items: readonly TItem[];
  transition: LODDirtyChunk;
}

export interface SpatialRenderAdapter<TItem = unknown> {
  applyChunkLOD(context: SpatialRenderAdapterContext<TItem>): void;
  update?(): void;
  getMetrics?(): unknown;
}

interface RegisteredSpatialRenderAdapter {
  applyChunkLOD(context: SpatialRenderAdapterContext<unknown>): void;
  update?: () => void;
  getMetrics?: () => unknown;
}

/**
 * Applies LOD decisions through render-type adapters.
 * The render loop/EffectComposer remains in rendering/RenderSystem.js.
 */
// 上面这段英文原注释的意思：
//   通过按渲染类别划分的适配器来落实 LOD 决策。
//   渲染循环与后处理合成器仍然留在 rendering/RenderSystem.js 里。
// export（导出）class（类）：声明并公开"空间渲染调度系统"
export class RenderSystem {
  readonly lodSystem: Pick<LODSystem, "consumeDirtyChunks">;
  private readonly adapters = new Map<string, RegisteredSpatialRenderAdapter>();
  private lastDirtyCount = 0;
  private appliedTransitions = 0;
  private appliedItems = 0;
  private transitionsByType: Record<string, number> = {};

  // constructor（构造函数）
  constructor({ lodSystem }: { lodSystem: Pick<LODSystem, "consumeDirtyChunks"> }) {
    // 检查传进来的是不是一个真正的 LODSystem。
    // 【为什么查方法而不查类型】用 instanceof 需要 import 那个类，
    // 会在两个系统之间建立不必要的编译期依赖。
    // 检查"有没有我要用的那个方法"（鸭子类型）既够用，
    // 又让测试可以传一个只有这一个方法的假对象进来
    if (!lodSystem?.consumeDirtyChunks) {
      throw new Error("Spatial RenderSystem requires a LODSystem.");
    }
    this.lodSystem = lodSystem;
  }

  // registerAdapter（登记一个渲染类别的适配器）
  registerAdapter<TItem>(renderType: string, adapter: SpatialRenderAdapter<TItem>): () => boolean {
    // 类别名必须是非空字符串（trim 挡住全空格）
    if (typeof renderType !== "string" || renderType.trim() === "") {
      throw new TypeError("Render adapter type must be a non-empty string.");
    }
    // 适配器必须提供 applyChunkLOD 方法——这是唯一的必需接口。
    // 【为什么在登记时就查】若等到 update 里真正调用时才发现方法不存在，
    // 报错发生在渲染循环深处，堆栈里全是本系统的内部调用，
    // 看不出是哪个适配器写错了。这里的错误信息带类别名，一目了然
    if (!adapter || typeof adapter.applyChunkLOD !== "function") {
      throw new TypeError(`Render adapter "${renderType}" requires applyChunkLOD().`);
    }
    // 重名直接抛错，不静默覆盖。
    // 【为什么】覆盖后旧适配器持有的 GPU 资源再也没人来释放，
    // 而且症状是"某类物体的 LOD 突然不起作用了"，极难联想到重复登记
    if (this.adapters.has(renderType)) {
      throw new Error(`Render adapter already registered: ${renderType}`);
    }
    // renderType 是运行时字符串，成员 data 的具体类型由各登记方约定；
    // 此闭包保留登记时的 TItem，类型擦除仅发生在按 renderType 路由处。
    this.adapters.set(renderType, {
      applyChunkLOD: (context) => adapter.applyChunkLOD({
        ...context,
        items: context.items as readonly TItem[],
      }),
      update: adapter.update ? () => adapter.update?.() : undefined,
      getMetrics: adapter.getMetrics ? () => adapter.getMetrics?.() : undefined,
    });
    // 同 ChunkSystem.register 的惯例：返回一张"注销票"
    return () => this.adapters.delete(renderType);
  }

  // update（每帧调用：把本帧的档位变更派发给各适配器）
  update(): LODDirtyChunk[] {
    // consume（取走）而非 peek（只看）：取走后 LODSystem 的脏列表清空，
    // 保证同一个变更不会被处理两次。
    // 【这是本系统的核心职责边界】本系统是脏列表的唯一消费者，
    // 别处只能 peek
    const dirtyChunks = this.lodSystem.consumeDirtyChunks();
    this.lastDirtyCount = dirtyChunks.length;

    dirtyChunks.forEach((transition) => {
      // 把这一格的成员按渲染类别分组
      const handlesByType = this._groupHandles(transition.chunk.members?.values());
      handlesByType.forEach((handles, renderType) => {
        const adapter = this.adapters.get(renderType);
        // 没有对应适配器就跳过，不报错。
        // 【为什么容忍这种情况】某类物体可能刻意不参与 LOD
        //（比如全场唯一的岸桥，永远用高精模型）。
        // 抛错会让这类合理配置无法存在
        if (!adapter) return;
        // 从句柄里取出真正的业务对象。
        // filter(Boolean) 滤掉 null 与 undefined——登记时 data 是可选的，
        // 有些句柄只用于占位与空间计算，没有实际渲染对象。
        // 不滤的话适配器会拿到一串空值，得自己再判一遍
        const items = handles.map((handle) => handle.data).filter(Boolean);
        adapter.applyChunkLOD({
          chunkId: transition.chunkId,
          // 只传目标档位。适配器多数情况只关心"现在该画成什么样"
          level: transition.nextLevel,
          items,
          // 同时把完整的变更事件也传过去。
          // 【为什么两者都给】level 是便利参数，覆盖九成需求；
          // transition 里还有 previousLevel、reason、distance，
          // 少数适配器需要它们做更精细的判断
          //（比如"从隐藏档回来"与"从 LOD1 降下来"的处理不同）
          transition,
        });
        this.appliedTransitions += 1;
        this.appliedItems += items.length;
        this.transitionsByType[renderType] = (this.transitionsByType[renderType] ?? 0) + 1;
      });
    });

    // 派发完成后，给每个适配器一次"每帧自更新"的机会。
    // ?.() 表示这个方法是可选的——只有需要做持续动画或延迟释放的
    // 适配器才实现它。
    // 【为什么放在派发之后】适配器的 update 常常要处理
    // 本帧刚接到的变更（比如渐隐过渡），先派发再让它跑，
    // 顺序反了就要延迟一帧
    this.adapters.forEach((adapter) => adapter.update?.());

    // 把脏列表返回给调用方，便于上层做日志或调试
    return dirtyChunks;
  }

  // getMetrics（取度量指标）
  getMetrics(): {
    adapters: number;
    dirtyChunksApplied: number;
    appliedTransitions: number;
    appliedItems: number;
    transitionsByType: Record<string, number>;
    adapterMetrics: Record<string, unknown>;
  } {
    return {
      adapters: this.adapters.size,
      dirtyChunksApplied: this.lastDirtyCount,
      appliedTransitions: this.appliedTransitions,
      appliedItems: this.appliedItems,
      // 展开成副本，防调用方改坏内部统计
      transitionsByType: { ...this.transitionsByType },
      // adapterMetrics（各适配器自身的指标）：向下汇集一层。
      // Object.fromEntries（由键值对数组构造对象）把
      // [[类别, 指标], ...] 变成 { 类别: 指标, ... }。
      // ?.() ?? {} 双重兜底：适配器没实现 getMetrics 就给个空对象，
      // 让性能面板可以无条件地遍历这份数据而不必逐个判空
      adapterMetrics: Object.fromEntries(
        [...this.adapters.entries()].map(([type, adapter]) => [type, adapter.getMetrics?.() ?? {}]),
      ),
    };
  }

  // clear（清空）
  clear(): void {
    this.adapters.clear();
    this.lastDirtyCount = 0;
    // 【注意三个累计量刻意不清零】appliedTransitions、appliedItems、
    // transitionsByType 记录的是整个会话的派发总量，
    // 用于观察长期趋势。清零会让性能曲线断掉
  }

  // _groupHandles（内部方法：把一格的成员按渲染类别分组）
  private _groupHandles(handles: Iterable<SpatialHandle> | undefined): Map<string, SpatialHandle[]> {
    const grouped = new Map<string, SpatialHandle[]>();
    // 双层 ?. 逐级判空：transition.chunk 理论上必然存在，
    // 但格子可能已经被 ChunkSystem 回收（成员走空后删掉），
    // 那时 members 就没了。
    // 【为什么不抛错】档位变更与格子回收是两个异步发生的事，
    // 中间隔一帧属于正常时序，不是错误
    if (!handles) return grouped;
    for (const handle of handles) {
      // 没标类别的句柄不参与渲染调度。
      // 这类句柄通常只用于空间查询（比如一个纯逻辑的触发区域）
      if (!handle.renderType) continue;
      // ?? [] 处理"这个类别第一次出现"，省掉一个 if
      const values = grouped.get(handle.renderType) ?? [];
      values.push(handle);
      // 必须重新 set 一次。
      // 【为什么】第一次拿到的是 ?? 产生的新数组，它还没进 Map。
      // 若只在新建时 set，代码要多一个分支；无条件 set 更简洁，
      // 重复 set 同一个数组引用的开销可以忽略
      grouped.set(handle.renderType, values);
    }
    return grouped;
  }
}

export default RenderSystem;
