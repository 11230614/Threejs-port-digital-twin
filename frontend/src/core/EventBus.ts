export type EventListener<TPayload> = (payload: TPayload) => void;

export class EventBus<TEvents extends object = Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<EventListener<unknown>>>();

  on<TKey extends keyof TEvents>(
    eventName: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): () => boolean {
    if (typeof listener !== "function") {
      throw new TypeError("EventBus listeners must be functions.");
    }

    const listeners = this.listeners.get(eventName) ?? new Set<EventListener<unknown>>();
    listeners.add(listener as EventListener<unknown>);
    this.listeners.set(eventName, listeners);
    return () => this.off(eventName, listener);
  }

  once<TKey extends keyof TEvents>(
    eventName: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): () => boolean {
    let unsubscribe: () => boolean;
    const wrapped = (payload: TEvents[TKey]): void => {
      unsubscribe();
      listener(payload);
    };
    unsubscribe = this.on(eventName, wrapped);
    return unsubscribe;
  }

  off<TKey extends keyof TEvents>(
    eventName: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): boolean {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return false;

    const removed = listeners.delete(listener as EventListener<unknown>);
    if (listeners.size === 0) this.listeners.delete(eventName);
    return removed;
  }

  emit<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]): void {
    this.listeners.get(eventName)?.forEach((listener) => listener(payload));
  }

  clear(): void {
    this.listeners.clear();
  }
}
