// ============================================================================
// FrameObserver.js —— 帧调度器（Frame Observer：统一管理“每帧要跑哪些逻辑”）
//
// 【这个文件干什么】
// 一个三维项目里有几十套逻辑要每帧执行（车辆移动、吊具动画、报警轮询、
// 性能采样……）。这个类把普通帧任务与渲染时机监听器集中调度，避免各系统
// 各自创建 requestAnimationFrame，并通过优先级保证依赖顺序。
//
// 任务支持 interval（毫秒间隔）、priority（优先级）和 paused（暂停）；
// 帧监听器支持 beginFrame、beforeRender、afterRender 三个钩子。
// 任一任务或监听器出错都会被隔离并交给 onError，不中断后续系统。
//
// 【术语翻译】
//   Frame（帧） Observer（观察者） task（任务） interval（执行间隔，毫秒）
//   priority（优先级，数值越小越先执行） hook（钩子） listener（监听器）
//   deltaTime（帧间隔秒数） elapsedTime（累计运行秒数）
// ============================================================================

export type FrameHookName = "beginFrame" | "beforeRender" | "afterRender";

export interface FrameContext {
  deltaTime: number;
  elapsedTime: number;
}

export interface FrameTaskStats {
  calls: number;
  totalMs: number;
  lastMs: number;
}

export interface FrameTask {
  name: string;
  update: (deltaTime: number, elapsedTime: number) => void;
  interval: number;
  priority: number;
  paused: boolean;
  lastUpdate: number | null;
  accumulatedTime: number;
  sequence: number;
  stats: FrameTaskStats;
}

export interface FrameTaskOptions {
  name: string;
  update: (deltaTime: number, elapsedTime: number) => void;
  interval?: number;
  priority?: number;
  paused?: boolean;
}

export interface FrameObserverLike {
  beginFrame?: (context: FrameContext) => void;
  beforeRender?: (context: FrameContext) => void;
  afterRender?: (context: FrameContext) => void;
}

export interface FrameListenerOptions {
  name: string;
  observer: FrameObserverLike;
  priority?: number;
}

export interface FrameObserverError {
  type: "task" | "frame-listener";
  name: string;
  hook?: FrameHookName;
  error: unknown;
}

export interface FrameObserverOptions {
  onError?: (details: FrameObserverError) => void;
}

const FRAME_HOOKS = Object.freeze(["beginFrame", "beforeRender", "afterRender"] as const);

export class FrameObserver {
  readonly tasks: FrameTask[] = [];
  readonly taskMap = new Map<string, FrameTask>();
  readonly frameListeners: Array<{ name: string; observer: FrameObserverLike; priority: number; sequence: number }> = [];
  readonly frameListenerMap = new Map<string, FrameObserver["frameListeners"][number]>();
  readonly onError: (details: FrameObserverError) => void;
  readonly frameContext: FrameContext = { deltaTime: 0, elapsedTime: 0 };
  elapsedTime = 0;
  sequence = 0;
  paused = false;

  constructor({ onError = defaultErrorHandler }: FrameObserverOptions = {}) {
    this.onError = onError;
  }

  addTask({ name, update, interval = 0, priority = 0, paused = false }: FrameTaskOptions): () => boolean {
    this._validateName(name);
    if (typeof update !== "function") throw new TypeError(`Frame task "${name}" requires an update function.`);
    if (!Number.isFinite(interval) || interval < 0) throw new RangeError(`Frame task "${name}" interval must be a non-negative number.`);
    if (!Number.isFinite(priority)) throw new TypeError(`Frame task "${name}" priority must be a finite number.`);
    if (this.taskMap.has(name)) throw new Error(`Frame task already exists: ${name}`);
    const task: FrameTask = { name, update, interval, priority, paused, lastUpdate: null, accumulatedTime: 0, sequence: this.sequence++, stats: { calls: 0, totalMs: 0, lastMs: 0 } };
    this.taskMap.set(name, task); this.tasks.push(task); this._sortByPriority(this.tasks);
    return () => this.removeTask(name);
  }

  removeTask(name: string): boolean {
    const task = this.taskMap.get(name); if (!task) return false;
    this.taskMap.delete(name); this.tasks.splice(this.tasks.indexOf(task), 1); return true;
  }

  pauseTask(name: string): boolean { return this._setTaskPaused(name, true); }
  resumeTask(name: string): boolean { return this._setTaskPaused(name, false); }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  addFrameListener({ name, observer, priority = 0 }: FrameListenerOptions): () => boolean {
    this._validateName(name);
    if (!observer || !FRAME_HOOKS.some((hook) => typeof observer[hook] === "function")) throw new TypeError(`Frame listener "${name}" requires at least one frame hook.`);
    if (!Number.isFinite(priority)) throw new TypeError(`Frame listener "${name}" priority must be a finite number.`);
    if (this.frameListenerMap.has(name)) throw new Error(`Frame listener already exists: ${name}`);
    const listener = { name, observer, priority, sequence: this.sequence++ };
    this.frameListenerMap.set(name, listener); this.frameListeners.push(listener); this._sortByPriority(this.frameListeners);
    return () => this.removeFrameListener(name);
  }

  removeFrameListener(name: string): boolean {
    const listener = this.frameListenerMap.get(name); if (!listener) return false;
    this.frameListenerMap.delete(name); this.frameListeners.splice(this.frameListeners.indexOf(listener), 1); return true;
  }

  update(deltaTime: number, elapsedTime: number | null = null): void {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError("FrameObserver deltaTime must be a non-negative number.");
    this.elapsedTime = elapsedTime !== null && Number.isFinite(elapsedTime) ? elapsedTime : this.elapsedTime + deltaTime;
    this.frameContext.deltaTime = deltaTime; this.frameContext.elapsedTime = this.elapsedTime;
    this._notifyFrameListeners("beginFrame");
    if (this.paused) return;
    [...this.tasks].forEach((task) => {
      if (task.paused || this.taskMap.get(task.name) !== task) return;
      task.accumulatedTime += deltaTime;
      const intervalSeconds = task.interval / 1000;
      if (intervalSeconds > 0 && task.accumulatedTime + Number.EPSILON < intervalSeconds) return;
      const taskDeltaTime = intervalSeconds === 0 ? deltaTime : task.accumulatedTime;
      task.accumulatedTime = intervalSeconds === 0 ? 0 : task.accumulatedTime % intervalSeconds;
      task.lastUpdate = this.elapsedTime;
      try {
        const startedAt = globalThis.performance?.now?.() ?? Date.now();
        task.update(taskDeltaTime, this.elapsedTime);
        const spent = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
        task.stats.calls += 1; task.stats.totalMs += spent; task.stats.lastMs = spent;
      } catch (error) { this.onError({ type: "task", name: task.name, error }); }
    });
  }

  getSystemStats(): Record<string, { updateMs: number; calls: number; lastMs: number; frequency: number | null }> {
    return Object.fromEntries(this.tasks.map((task) => [task.name, { updateMs: task.stats.calls ? task.stats.totalMs / task.stats.calls : 0, calls: task.stats.calls, lastMs: task.stats.lastMs, frequency: task.interval ? 1000 / task.interval : null }]));
  }

  beforeRender(): void { this._notifyFrameListeners("beforeRender"); }
  afterRender(): void { this._notifyFrameListeners("afterRender"); }
  clear(): void { this.tasks.length = 0; this.taskMap.clear(); this.frameListeners.length = 0; this.frameListenerMap.clear(); }

  private _setTaskPaused(name: string, paused: boolean): boolean { const task = this.taskMap.get(name); if (!task) return false; task.paused = paused; return true; }
  private _notifyFrameListeners(hook: FrameHookName): void {
    [...this.frameListeners].forEach((listener) => {
      if (this.frameListenerMap.get(listener.name) !== listener) return;
      const callback = listener.observer[hook]; if (typeof callback !== "function") return;
      try { callback.call(listener.observer, this.frameContext); } catch (error) { this.onError({ type: "frame-listener", name: listener.name, hook, error }); }
    });
  }
  private _validateName(name: string): void { if (typeof name !== "string" || name.trim() === "") throw new TypeError("Frame task names must be non-empty strings."); }
  private _sortByPriority<T extends { priority: number; sequence: number }>(items: T[]): void { items.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence); }
}

function defaultErrorHandler({ type, name, hook, error }: FrameObserverError): void {
  const phase = hook ? ` (${hook})` : "";
  console.error(`FrameObserver ${type} "${name}"${phase} failed.`, error);
}
