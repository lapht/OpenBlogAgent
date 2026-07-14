export class TtlCache<TValue> {
  private readonly store = new Map<string, { value: TValue; expiresAt: number }>();

  constructor(private readonly ttlSeconds: number) {}

  get(key: string): TValue | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: TValue): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }
}