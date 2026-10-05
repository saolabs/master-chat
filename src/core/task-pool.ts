// Share nested leases for one task, with a bounded number of resources per scope.
export class TaskPool<T> {
  private entries = new Map<string, { value: Promise<T>; users: number }>();
  private scopes = new Map<
    string,
    { active: number; waiting: (() => void)[] }
  >();
  private stopped = false;
  constructor(private limit: number) {}
  has(key: string) {
    return this.entries.has(key);
  }

  private async acquire(scope: string) {
    const state = this.scopes.get(scope) ?? { active: 0, waiting: [] };
    this.scopes.set(scope, state);
    if (state.active < this.limit) state.active++;
    else await new Promise<void>((resolve) => state.waiting.push(resolve));
    if (this.stopped) {
      throw new Error("Ứng dụng đã dừng xử lý.");
    }
  }
  private release(scope: string) {
    const state = this.scopes.get(scope)!;
    const next = state.waiting.shift();
    if (next) next();
    else if (--state.active === 0) this.scopes.delete(scope);
  }
  stop() {
    this.stopped = true;
  }

  async use<R>(
    key: string,
    scope: string,
    create: () => Promise<T>,
    dispose: (value: T) => void,
    operation: (value: T) => Promise<R>,
  ): Promise<R> {
    if (this.stopped) throw new Error("Ứng dụng đã dừng xử lý.");
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { users: 0, value: this.acquire(scope).then(create) };
      this.entries.set(key, entry);
    }
    entry.users++;
    let value: T | undefined;
    try {
      value = await entry.value;
      return await operation(value);
    } finally {
      if (--entry.users === 0) {
        this.entries.delete(key);
        try {
          if (value !== undefined) dispose(value);
        } finally {
          this.release(scope);
        }
      }
    }
  }
}
