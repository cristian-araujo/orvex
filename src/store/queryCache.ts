const MAX_ENTRIES = 50;
const store = new Map<string, unknown>();

export function getCached<T>(key: string): T | null {
  return store.has(key) ? (store.get(key) as T) : null;
}

export function setCached<T>(key: string, data: T): void {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    const firstKey = store.keys().next().value!;
    store.delete(firstKey);
  }
  store.set(key, data);
}

export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearAll(): void {
  store.clear();
}

// Key format: "data:{db}.{table}.{page}.{filtersJson}.{sortJson}.{quickFilter}"
export function makeDataKey(
  db: string,
  table: string,
  page: number,
  filterModel: Record<string, unknown> | null | undefined,
  sort: unknown[] | null | undefined,
  quickFilter: string,
): string {
  return `data:${db}.${table}.${page}.${JSON.stringify(filterModel ?? null)}.${JSON.stringify(sort ?? null)}.${quickFilter}`;
}
