// ============================================================================
// YardSystem.js —— 堆场系统（Yard System：上万个集装箱的纯数据台账）
//
// 【这个文件干什么】
// 管理堆场里每个集装箱的"档案"：它在哪个箱区、第几排第几列第几层、
// 世界坐标是多少、归谁管、能不能被取走。
//
// 【最重要的一点：本文件完全不碰三维对象】
// 通篇没有 Mesh、没有 Scene、没有 add。它只产出普通 JS 对象（record，数据记录），
// 三维显示交给 ContainerRenderManager 用 instancing（实例化渲染）批量画。
// 这种 data-only（纯数据）设计是本项目能支撑上万箱子的根本原因：
//   · 建一万条数据记录只要几十毫秒，建一万个 Mesh 要几秒并吃光显存
//   · 数据层可以脱离浏览器做单元测试（对应 test:yard-scale 那个测试）
//
// 【堆场的三级结构】
//   block（箱区）—— 一片场地，比如 A 区
//     └ slot（箱位）—— 由 row（排）/ col（列）/ layer（层）三个下标定位
//         └ container（集装箱）—— 占据一个箱位
//
// 【堆叠规则：只能从上往下取】
// canReleaseContainer 检查"这个箱子头上还压着别的箱子吗"。
// 这是物理约束——吊具无法穿过上面的箱子去抓下面的。
// 少了这个检查，画面上会出现箱子从堆垛中间被抽走、上面的箱子悬空的荒谬场景。
//
// 【术语翻译】
//   Yard（堆场）           block（箱区）      slot（箱位）
//   row / col / layer（排 / 列 / 层）
//   pitch（间距，一个箱子加一道缝的总宽度）
//   capacity（容量）        occupiedBy（被哪个箱子占用）
//   record（数据记录）      owner（归属方）
//   YARD / RELEASED（在堆场 / 已出库）
//   releasableContainer（可出库的箱子，即位于堆垛顶层的）
//   requireTop（要求是顶层）
//   bounds（包围盒范围）    Box3（三维包围盒）
//   quaternion（四元数，表示旋转）
//   setFromAxisAngle（由旋转轴与角度构造四元数）
//   setFromCenterAndSize（由中心点与尺寸构造包围盒）
//   addScaledVector（加上某向量的若干倍）
//   union（求包围盒并集，扩张到能同时包住两者）
//   clamp（钳制在上下界之间）
//   padStart（在字符串左侧补齐到指定长度）
//   localeCompare（按语言习惯比较字符串大小）
// ============================================================================

// 迁移说明：本文件现在直接承载 YardSystem 的完整实现；旧 JS 入口仍转发到此处。
// 导入 Three.js：用到 Vector3、Box3、Quaternion、MathUtils
import * as THREE from "three";
import type { Entity } from "../ecs/Entity";
import type { InstanceBatch } from "../rendering/InstanceBatch";
// 导入集装箱布局配置（尺寸与间隙）
import { PORT_CONTAINER_LAYOUT_CONFIG } from "../config/PortSpatialConfig.ts";

// Kept as a compatibility export while the owning configuration lives in config/.
// 兼容性导出：配置本身已经搬到 config/ 目录下了，但旧代码里还有
// `import { CONTAINER_LAYOUT } from ".../YardSystem.js"` 这样的写法。
// 留一个别名转发，避免为了一次搬家去改动十几处调用点。
// 这类导出应当在后续重构中逐步清理掉
export const CONTAINER_LAYOUT = PORT_CONTAINER_LAYOUT_CONFIG;
export interface ContainerLayout { scale: number; size: { x: number; y: number; z: number }; gap: { x: number; y: number; z: number } }
export interface YardSlot { key: string; blockId: string; row: number; col: number; layer: number }
export interface YardSlotRecord extends YardSlot { occupiedBy: string | null }
export interface ReleasedFrom { blockId: string; area: string; slot: YardSlot }
export type YardEntityReference = Pick<Entity, "id" | "wrapper" | "getComponent" | "getWorldPosition">;
export interface YardRenderBatchReference { remove(record: YardContainerRecord): boolean }
export interface YardRenderBinding { batch: InstanceBatch; index: number; lod?: 0 | 1 | 2; chunkId?: string; [key: string]: unknown }
export type YardContainerOwner = "YARD" | "RELEASED" | "DYNAMIC";
export type YardContainerState = "YARD" | "RELEASED" | "TRANSPORTING" | "DELIVERED" | "ON_SHIP" | "LIFTED" | "ON_AGV";
export interface YardContainerRecord { id: string; assetId: string; blockId: string; area: string; slot: YardSlot; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; owner: YardContainerOwner; location: string; state: YardContainerState; currentAGV: string | null; taskId: string | null; reservedBy: string | null; releasedFrom: ReleasedFrom | null; entity: YardEntityReference | null; renderBinding: YardRenderBinding | null; bounds?: THREE.Box3; [key: string]: unknown }
export interface YardBlockLayout { rows: number; cols: number; layers: number }
export interface YardBlockRecord { blockId: string; name: string; containers: YardContainerRecord[]; count: number; bounds: THREE.Box3; layout: YardBlockLayout; loaded: boolean }
export interface YardSystemOptions { sourceAssetIds?: string[]; containerLayout?: ContainerLayout }
export interface CreateBlockOptions { startY?: number; name?: string; rotationY?: number; count?: number; blockId?: string; area?: string }
export interface ReleaseOptions { requireTop?: boolean }

// export（导出）class（类）：声明并公开"堆场系统"
export class YardSystem {
  sourceAssetIds: string[];
  containerLayout: ContainerLayout;
  containers: Map<string, YardContainerRecord>;
  slots: Map<string, YardSlotRecord>;
  blocks: Map<string, YardBlockRecord>;
  nextContainerNumber: number;
  pitch: THREE.Vector3;
  // constructor（构造函数）
  constructor({
    // sourceAssetIds（可用的箱子模型编号列表）：给箱子随机分配外观，
    // 让堆场看起来是五颜六色的而不是一片纯色
    sourceAssetIds = [],
    // 布局配置，默认取全局配置
    containerLayout = PORT_CONTAINER_LAYOUT_CONFIG,
  }: YardSystemOptions = {}) {
    this.sourceAssetIds = sourceAssetIds;
    this.containerLayout = containerLayout;
    // containers（集装箱总表）：箱号 -> 数据记录
    this.containers = new Map();
    // slots（箱位表）：箱位键 -> { 箱位信息, occupiedBy 占用者 }。
    // 为什么要单独一张表？因为堆叠检查需要"按位置反查有没有箱子"，
    // 只有 containers 表的话每次都得全表扫描
    this.slots = new Map();
    // blocks（箱区表）：箱区编号 -> 箱区信息
    this.blocks = new Map();
    // 箱号自增序号
    this.nextContainerNumber = 1;
    // pitch（间距）：相邻两个箱子的中心距 = 箱子尺寸 + 缝隙。
    // 在构造函数里算好一次，后面摆几万个箱子都直接乘用，不必反复相加
    this.pitch = new THREE.Vector3(
      this.containerLayout.size.x + this.containerLayout.gap.x,
      this.containerLayout.size.y + this.containerLayout.gap.y,
      this.containerLayout.size.z + this.containerLayout.gap.z,
    );
  }

  // createCenteredBlock（按中心点建箱区）：给定中心坐标，摆出一整片箱区
  //   rows / cols / layers（排数 / 列数 / 层数）
  //   centerX / centerZ（这片箱区中心点的横纵坐标）
  createCenteredBlock(rows: number, cols: number, layers: number, centerX: number, centerZ: number, options: CreateBlockOptions = {}): YardBlockRecord {
    // 本方法自己不摆箱子，只做一件事：把"中心坐标"换算成"起始角坐标"，
    // 然后转交 createBlock。
    // 【为什么值得单独一个方法】布局代码里写"A 区在广场中央"比
    // 写"A 区左下角在某个算出来的坐标"直观得多。若没有这层换算，
    // 每个调用点都要自己重复这两行减法，而且很容易忘掉减半、
    // 导致整片箱区偏移半个区的距离
    return this.createBlock(
      rows,
      cols,
      layers,
      // 中心 -> 起点的换算：往回退半个箱区的宽度。
      // 用 (rows - 1) 而不是 rows 是关键：pitch 是"中心到中心"的距离，
      // 首尾两个箱子中心之间只有 rows-1 个间距。
      // 若写成 rows * pitch / 2，整片箱区会往负方向多偏半个箱位
      centerX - ((rows - 1) * this.pitch.x) / 2,
      centerZ - ((cols - 1) * this.pitch.z) / 2,
      options,
    );
  }

  // createBlock（建箱区）：本文件的主力方法，一次生成整片箱区的全部数据记录
  //   startX / startZ（起始角的坐标，即 row=0、col=0 那个箱子的中心）
  createBlock(rows: number, cols: number, layers: number, startX: number, startZ: number, options: CreateBlockOptions = {}): YardBlockRecord {
    // 解构并给出全部默认值，让调用方只需传自己关心的那几项
    const {
      // startY（底层高度）：0.08 米，让箱子底面略高于地面。
      // 完全贴地（0）会与地面共面，产生 z-fighting（深度冲突）——
      // 画面上箱底与地面互相穿插闪烁
      startY = 0.08,
      // 箱区名字，默认按已有箱区数量自动编号
      name = `yard-block-${this.blocks.size + 1}`,
      // rotationY（绕竖直轴的旋转角）：让整片箱区可以斜着摆，
      // 贴合码头道路的走向
      rotationY = 0,
      // count（实际要摆的箱子数）：默认摆满。
      // 允许少于容量，是为了做出"这个区只堆了七成"的真实感
      count = rows * cols * layers,
      // 箱区编号，默认与名字相同
      blockId = name,
      // 所属区域名（界面上显示"箱子在哪儿"用的）
      area = name,
    } = options;
    // capacity（容量）：三维乘起来就是这片场地最多能放多少箱
    const capacity = rows * cols * layers;
    // targetCount（实际目标数量）：两重保护同时生效。
    // Math.floor（向下取整）挡住传进来 12.7 这种小数；
    // clamp（钳制）挡住负数与超出容量的值。
    // 少了 clamp，传个 99999 进来会让下面的三重循环把整片场地摆满，
    // 与调用方的预期不符却毫无报错
    const targetCount = THREE.MathUtils.clamp(Math.floor(count), 0, capacity);
    // containers（本区生成的记录列表）：作为返回值的一部分给调用方
    const containers = [];
    // bounds（本区的整体包围盒）：先建一个空盒子，
    // 下面每摆一个箱子就 union（求并集）扩张一次。
    // 空 Box3 的初始状态是 min=+∞、max=-∞，第一次 union 会直接
    // 变成那个箱子的盒子，所以不需要特殊处理"第一个"
    const bounds = new THREE.Box3();
    // rotation（本区统一的朝向四元数）：在循环外算一次。
    // setFromAxisAngle（由旋转轴与角度构造）——绕 Y 轴（0,1,0）转 rotationY。
    // 用 quaternion（四元数）而非欧拉角，是为了下游做姿态插值时不出角度突跳
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      rotationY,
    );

    // 三重循环：层 -> 排 -> 列。
    // 【为什么层在最外层】这个顺序决定了 count 少于容量时箱子怎么分布：
    // 层在外面，就会先把第 0 层铺满、再铺第 1 层，堆出来的是"矮而广"的形状。
    // 若把层放在最内层，会先把第一根柱子堆到顶，
    // 出现一根孤零零的高柱子旁边一片空地——既不真实，
    // 也让堆叠取箱规则失去意义
    for (let layer = 0; layer < layers; layer += 1) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          // 数量已经够了就跳过剩下的箱位。
          // 用 continue（跳过本轮）而非 break（跳出）：break 只能跳出最内层的
          // col 循环，外面两层还会继续跑；虽然每轮都会立刻再次撞上这个判断、
          // 结果一样，但 continue 表达的意思更直白——"这个箱位不摆箱子"
          if (containers.length >= targetCount) continue;

          // 分配箱号
          const id = this._createContainerId();
          // slot（箱位）：这个箱子的"地址"
          const slot = {
            // key（箱位键）：把四个标识拼成一个字符串做 Map 的键。
            // 为什么要拼字符串？因为 JS 的 Map 用的是引用相等，
            // 拿 { row, col, layer } 对象当键永远查不到（每次都是新对象）。
            // 拼成 "A区:2:3:1" 这种字符串就能按值查找
            key: `${blockId}:${row}:${col}:${layer}`,
            blockId,
            row,
            col,
            layer,
          };
          // position（世界坐标）：起点 + 下标 × 间距。
          // 三个轴各自独立：row 沿 X 方向排开、col 沿 Z 方向排开、
          // layer 沿 Y 方向往上堆
          const position = new THREE.Vector3(
            startX + row * this.pitch.x,
            startY + layer * this.pitch.y,
            startZ + col * this.pitch.z,
          );
          // record（数据记录）：一个箱子的完整档案，15 个字段
          const record: YardContainerRecord = {
            // 箱号
            id,
            // assetId（外观模型编号）：随机挑一个，让堆场颜色斑驳
            assetId: this._pickAssetId(),
            // 所属箱区与区域
            blockId,
            area,
            // 箱位地址
            slot,
            // 位姿三件套：位置、旋转、缩放。
            // 存在数据记录里而不是 Mesh 上，是本文件 data-only 设计的体现
            position,
            // clone（克隆）：每个箱子都要一份独立的四元数。
            // 共用同一个对象的话，将来任何一个箱子转向会让整区一起转
            quaternion: rotation.clone(),
            scale: new THREE.Vector3(1, 1, 1),
            // 下面三个字段看起来重复，其实各有分工，不能合并：
            // owner（归属方）：给渲染层看的——"YARD" 表示走实例化批量渲染，
            // "DYNAMIC" 表示已经是独立三维对象了
            owner: "YARD",
            // location（所在位置的文字描述）：给界面看的，会变成 "AGV"、区域名等
            location: "YARD",
            // state（业务状态）：给任务系统看的，走 YARD -> RELEASED ->
            // TRANSPORTING -> DELIVERED 这条状态机
            state: "YARD",
            // currentAGV（当前在哪辆车上）：还在堆场里所以是 null（空）
            currentAGV: null,
            // taskId（归属任务）
            taskId: null,
            // reservedBy（被哪个任务预留）：相当于一把锁，防两个任务抢同一个箱
            reservedBy: null,
            // releasedFrom（出库前的原箱位快照）：出库时才填。
            // 有了它才能回答"这箱子原来在哪"，也支持将来的回库归位
            releasedFrom: null,
            // entity（对应的 ECS 实体）：静态箱没有实体，提升为动态箱后才填
            entity: null,
            // renderBinding（渲染绑定信息）：实例化渲染管理器用来记
            // "这个箱子是第几批第几号实例"
            renderBinding: null,
          };
          // 包围盒要用到 record.position，所以在对象建好后再补这个字段
          record.bounds = this._containerBounds(record);
          // 登记到总表
          this.containers.set(id, record);
          // 登记箱位占用。展开 slot 再加 occupiedBy（占用者），
          // 而不是直接存 slot 对象——箱位表与箱子记录各持一份副本，
          // 避免出库时改箱位表连带改了箱子记录里的 slot
          this.slots.set(slot.key, { ...slot, occupiedBy: id });
          // 加进本次返回列表
          containers.push(record);
          // 扩张箱区包围盒，让它包住这个新箱子
          bounds.union(record.bounds);
        }
      }
    }

    // 汇总成箱区对象
    const result = {
      blockId,
      name,
      containers,
      // 实际生成数量。用 containers.length 而非 targetCount：
      // 两者理论上相等，但以实际结果为准更可靠
      count: containers.length,
      // 整区包围盒。分块加载与视锥剔除都靠它做"整区是否可见"的粗判，
      // 一次判断顶替上万个箱子的逐个判断
      bounds,
      // 把布局尺寸也存下来。canReleaseContainer 要靠 layout.layers
      // 才知道该往上检查到第几层
      layout: { rows, cols, layers },
      // loaded（是否已加载渲染资源）：由分块流式加载系统维护，初始为 false
      loaded: false,
    };
    this.blocks.set(blockId, result);
    return result;
  }

  // getContainer（按箱号取记录）
  getContainer(id: string): YardContainerRecord | null {
    // ?? null（空值合并）：把 Map 找不到时的 undefined 统一成 null，
    // 让调用方只需判断一种空值
    return this.containers.get(id) ?? null;
  }

  // getBlocks（取全部箱区）
  getBlocks(): YardBlockRecord[] {
    // 展开成新数组返回，而不是把内部 Map 的迭代器交出去。
    // 这样调用方增删返回的数组不会破坏堆场的内部状态
    return [...this.blocks.values()];
  }

  // getContainerWorldPosition（取箱子的世界坐标）
  getContainerWorldPosition(id: string): THREE.Vector3 | null {
    const record = this.getContainer(id);
    if (!record) return null;
    // 两条取值路径，顺序很重要：
    //   已提升为动态箱的（正被吊起或挂在车上）——它的真实位置在三维实体上，
    //     记录里的 position 是出库那一刻的旧值，早就过期了
    //   还在堆场里的——没有实体，用记录里的坐标
    // 双层 ?. （可选链）逐级判空：记录可能没有 entity，
    // entity 也可能没实现 getWorldPosition。
    // clone（克隆）是必须的：直接返回 record.position 的话，
    // 调用方拿去做 lerp、add 之类的就地运算会把堆场数据改坏——
    // 箱子会在画面上凭空漂走
    return record.entity?.getWorldPosition?.() ?? record.position.clone();
  }

  // getAllContainers（取全部箱子记录）
  getAllContainers(): YardContainerRecord[] {
    return [...this.containers.values()];
  }

  // getYardContainers（取还在堆场里的箱子）：过滤掉已出库、在车上的
  getYardContainers(): YardContainerRecord[] {
    return this.getAllContainers().filter((record) => record.owner === "YARD");
  }

  // canReleaseContainer（判断这个箱子能不能被取走）
  // 这是本文件的核心业务规则：堆垛只能从顶上往下拆
  canReleaseContainer(id: string): boolean {
    const record = this.getContainer(id);
    // 箱子不存在、或已经不在堆场里（已出库 / 在车上），都谈不上"能否取走"
    if (!record || record.owner !== "YARD") return false;
    const block = this.blocks.get(record.blockId);
    // 找不到所属箱区就无法知道总层数，保守返回 false（不能取）。
    // 【为什么保守】返回 true 会让上层去取一个规则未知的箱子，
    // 可能抽走被压住的箱子造成上方悬空；返回 false 最多是少取一个箱子，
    // 后果轻得多
    if (!block) return false;

    // 从本箱子的上一层开始往上扫，一直扫到箱区的最高层。
    // 【为什么只扫上面】压在下面的箱子不影响取上面的；
    // 挡路的只有头顶那些。起始下标是 layer + 1，正是"上面第一层"
    for (let layer = record.slot.layer + 1; layer < block.layout.layers; layer += 1) {
      // 同一排同一列、逐层往上拼出箱位键
      const key = `${record.blockId}:${record.slot.row}:${record.slot.col}:${layer}`;
      // 任何一层还有箱子占着，本箱子就被压住了，不能取。
      // ?. （可选链）挡住"这个箱位从未登记过"的情况——
      // 那说明那里本来就是空的，不构成阻挡
      if (this.slots.get(key)?.occupiedBy) return false;
    }
    // 头顶全空，可以取
    return true;
  }

  // getReleasableContainers（取全部可出库的箱子，即各堆垛的顶层箱）
  getReleasableContainers(): YardContainerRecord[] {
    return this.getYardContainers()
      // 逐个套用堆叠规则
      .filter((record) => this.canReleaseContainer(record.id))
      // 按箱号字典序排序。
      // 【为什么要排序】Map 的遍历顺序虽然是插入顺序，但经过多轮出库入库后
      // 这个顺序会变得难以预测。排序让"第 N 个可用箱子是哪个"变成确定的，
      // 任务分配才可复现、测试才能断言具体箱号。
      // localeCompare（按语言习惯比较字符串）比 < 号更稳妥，
      // 不受不同环境下字符编码差异的影响
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  // releaseContainer（出库：把箱子从堆场台账里放行）
  //   requireTop（要求是顶层）：true 时强制检查堆叠规则
  releaseContainer(id: string, { requireTop = false }: ReleaseOptions = {}): YardContainerRecord | null {
    const record = this.getContainer(id);
    // 不存在或已经不在堆场里（防重复出库）
    if (!record || record.owner !== "YARD") return null;
    // 【为什么这个检查是可选的】正常的车辆取箱必须遵守堆叠规则（传 true）；
    // 但场景初始化、调试指令、数据修复这类场合需要能直接指定任意箱子，
    // 默认 false 把选择权交给调用方
    if (requireTop && !this.canReleaseContainer(id)) return null;

    // 腾空箱位。这一步让上面那层（如果将来堆了箱子）能被取走，
    // 也让这个位置可以重新入箱。
    // 这里没用 ?. ——能走到这一行说明箱子的 owner 是 "YARD"，
    // 它的箱位必然登记过；真要是没有，宁可当场报错暴露数据不一致，
    // 也不要静默跳过留下一个永远占用的幽灵箱位
    const slotRecord = this.slots.get(record.slot.key);
    if (slotRecord) slotRecord.occupiedBy = null;
    // 出库前先把原箱位信息拍个快照。
    // 【必须在改字段之前做】下面三行马上把状态改成 RELEASED，
    // 之后就再也查不到"它原来在哪"了。
    // slot 用 { ...record.slot } 展开成副本，而非直接引用——
    // 记录里的 slot 后续可能被复用或修改，快照要保证不变
    record.releasedFrom = {
      blockId: record.blockId,
      area: record.area,
      slot: { ...record.slot },
    };
    // 三个状态字段同步翻转。它们服务于不同的消费方（渲染层 / 界面 / 任务系统），
    // 所以要一起改：只改其中一个会让某一层继续按旧状态工作，
    // 典型症状是箱子已经被吊走了、实例化批次里那个残影还留在原地
    record.owner = "RELEASED";
    record.location = "RELEASED";
    record.state = "RELEASED";
    // 把记录返回给调用方（ContainerSystem 接着拿它去建三维实体）
    return record;
  }

  // _containerBounds（内部方法：算一个箱子的包围盒）
  _containerBounds(record: YardContainerRecord): THREE.Box3 {
    // position 记的是箱子"底面中心"，而 Box3 需要的是"体心"，
    // 所以要往上抬半个箱高。
    // addScaledVector（加上某向量的若干倍）：沿 (0,1,0) 方向加 size.y/2。
    // 【为什么不直接 center.y += h/2】效果相同，但用向量运算的写法
    // 在将来箱子需要斜放时只改方向向量即可，不必重写坐标分量。
    // clone（克隆）保证不动 record.position 本身
    const center = record.position.clone().addScaledVector(
      new THREE.Vector3(0, 1, 0),
      this.containerLayout.size.y / 2,
    );
    // setFromCenterAndSize（由中心点与尺寸构造包围盒）：
    // 内部自动算出 min 与 max，比手写两个角点少一半出错机会
    return new THREE.Box3().setFromCenterAndSize(
      center,
      new THREE.Vector3(
        this.containerLayout.size.x,
        this.containerLayout.size.y,
        this.containerLayout.size.z,
      ),
    );
  }

  // _createContainerId（内部方法：生成下一个箱号）
  _createContainerId(): string {
    // padStart（左侧补零到 5 位）：得到 C00001、C00012、C01234 这样的箱号。
    // 【为什么要补零】等宽的箱号在界面列表里能整齐对齐，
    // 而且字典序与数值序一致——C00002 排在 C00010 前面。
    // 不补零的话 "C10" 会排在 "C2" 前面，getReleasableContainers 的
    // 排序结果就不符合直觉了
    const id = `C${String(this.nextContainerNumber).padStart(5, "0")}`;
    // 自增，保证下一个箱号不重复
    this.nextContainerNumber += 1;
    return id;
  }

  // _pickAssetId（内部方法：随机挑一个外观模型编号）
  _pickAssetId(): string {
    // 没有可用模型时给一个兜底编号，而不是返回 null。
    // 【为什么必须兜底】返回 null 会让下游加载模型时崩掉，
    // 整片堆场都建不起来；给个占位编号至少能画出灰色的方块，
    // 场景照样能跑，问题也一眼看得见
    if (!this.sourceAssetIds.length) return "container-fallback";
    // Math.random() * length 再 Math.floor（向下取整），
    // 得到 0 ~ length-1 的随机下标。这是 JS 里从数组随机取一项的标准写法
    return this.sourceAssetIds[
      Math.floor(Math.random() * this.sourceAssetIds.length)
    ] ?? "container-fallback";
  }
}

export default YardSystem;
