export interface ClockOptions {
  maxDelta?: number;
  now?: () => number;
}

export interface ClockTick {
  deltaTime: number;
  elapsedTime: number;
}

export type NowProvider = () => number;

export class Clock {
  readonly maxDelta: number;
  readonly now: NowProvider;
  elapsedTime = 0;
  private lastTime: number | null = null;

  constructor({ maxDelta = 0.1, now = defaultNow }: ClockOptions = {}) {
    this.maxDelta = maxDelta;
    this.now = now;
  }

  tick(): ClockTick {
    const currentTime = this.now();
    const deltaTime = this.lastTime === null
      ? 0
      : Math.min(Math.max((currentTime - this.lastTime) / 1000, 0), this.maxDelta);

    this.lastTime = currentTime;
    this.elapsedTime += deltaTime;
    return { deltaTime, elapsedTime: this.elapsedTime };
  }

  reset(): void {
    this.elapsedTime = 0;
    this.lastTime = null;
  }
}

function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
