// IndexedDB wrapper for the four vanilla-style object stores:
//   worlds  (metadata + level.dat bytes + icon), chunks (serialised chunk NBT bytes),
//   players (player NBT bytes), regions (cached .mca files).
//
// The data layer is abstracted behind IKeyValueStore so Node tests inject a Map-backed fake and
// NEVER touch window.indexedDB at import time (top level of this module only defines types).
// SaveDatabase.openIDB() is the only place that reaches for the global indexedDB factory.

/** Injectable key/value store. Values are structured-cloneable (Uint8Array / plain objects). */
export interface IKeyValueStore {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** All entries whose key starts with `prefix` (or all when omitted). */
  entries(prefix?: string): Promise<[string, unknown][]>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  /** ONE transaction for all items. Callers cap chunk batches at <= 16. */
  putBatch(items: [string, unknown][]): Promise<void>;
}

/** Map-backed IKeyValueStore used by Node/tsx tests and as an in-memory fallback. */
export class MemoryKeyValueStore implements IKeyValueStore {
  private readonly map = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> { return this.map.get(key); }
  async put(key: string, value: unknown): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async keys(): Promise<string[]> { return [...this.map.keys()]; }
  async clear(): Promise<void> { this.map.clear(); }
  async putBatch(items: [string, unknown][]): Promise<void> {
    for (const [k, v] of items) this.map.set(k, v);
  }
  async entries(prefix?: string): Promise<[string, unknown][]> {
    const out: [string, unknown][] = [];
    for (const [k, v] of this.map) if (!prefix || k.startsWith(prefix)) out.push([k, v]);
    return out;
  }
}

/** IndexedDB-backed IKeyValueStore. One object store per instance. */
export class IndexedDbKeyValueStore implements IKeyValueStore {
  constructor(private readonly db: IDBDatabase, private readonly name: string) {}

  private request<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(this.name, mode);
      const req = make(tx.objectStore(this.name));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error(`IDB request failed on ${this.name}`));
      tx.onabort = () => reject(tx.error ?? new Error(`IDB transaction aborted on ${this.name}`));
    });
  }

  get(key: string): Promise<unknown | undefined> {
    return this.request('readonly', (s) => s.get(key) as IDBRequest<unknown | undefined>);
  }
  put(key: string, value: unknown): Promise<void> {
    return this.request('readwrite', (s) => s.put(value, key) as unknown as IDBRequest<void>);
  }
  delete(key: string): Promise<void> {
    return this.request('readwrite', (s) => s.delete(key) as unknown as IDBRequest<void>);
  }
  clear(): Promise<void> {
    return this.request('readwrite', (s) => s.clear() as unknown as IDBRequest<void>);
  }
  keys(): Promise<string[]> {
    return this.request('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>).then((ks) => ks.map(String));
  }
  entries(prefix?: string): Promise<[string, unknown][]> {
    return new Promise<[string, unknown][]>((resolve, reject) => {
      const tx = this.db.transaction(this.name, 'readonly');
      const store = tx.objectStore(this.name);
      const range = prefix ? IDBKeyRange.bound(prefix, prefix + '\uffff') : undefined;
      const keysReq = store.getAllKeys(range);
      const valsReq = store.getAll(range);
      tx.oncomplete = () => {
        const keys = keysReq.result as IDBValidKey[];
        const vals = valsReq.result as unknown[];
        const out: [string, unknown][] = [];
        for (let i = 0; i < keys.length; i++) out.push([String(keys[i]), vals[i]]);
        resolve(out);
      };
      tx.onerror = () => reject(tx.error ?? new Error(`IDB entries failed on ${this.name}`));
      tx.onabort = () => reject(tx.error ?? new Error(`IDB entries aborted on ${this.name}`));
    });
  }
  putBatch(items: [string, unknown][]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(this.name, 'readwrite');
      const store = tx.objectStore(this.name);
      for (const [k, v] of items) store.put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`IDB putBatch failed on ${this.name}`));
      tx.onabort = () => reject(tx.error ?? new Error(`IDB putBatch aborted on ${this.name}`));
    });
  }
}

export const STORE_NAMES = ['worlds', 'chunks', 'players', 'regions'] as const;

export class SaveDatabase {
  constructor(
    readonly worlds: IKeyValueStore,
    readonly chunks: IKeyValueStore,
    readonly players: IKeyValueStore,
    readonly regions: IKeyValueStore,
  ) {}

  /** In-memory database (Node tests / fallback). */
  static memory(): SaveDatabase {
    return new SaveDatabase(
      new MemoryKeyValueStore(), new MemoryKeyValueStore(),
      new MemoryKeyValueStore(), new MemoryKeyValueStore(),
    );
  }

  /** Build a SaveDatabase from four injected stores (used by the fake-store tests). */
  static fromStores(worlds: IKeyValueStore, chunks: IKeyValueStore, players: IKeyValueStore, regions: IKeyValueStore): SaveDatabase {
    return new SaveDatabase(worlds, chunks, players, regions);
  }

  /** Opens the real IndexedDB. The global is read here (never at module top level). */
  static async openIDB(name = 'webcraft26', version = 1): Promise<SaveDatabase> {
    const factory = globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is not available in this environment');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(name, version);
      req.onupgradeneeded = () => {
        const database = req.result;
        for (const store of STORE_NAMES) if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    });
    return new SaveDatabase(
      new IndexedDbKeyValueStore(db, 'worlds'),
      new IndexedDbKeyValueStore(db, 'chunks'),
      new IndexedDbKeyValueStore(db, 'players'),
      new IndexedDbKeyValueStore(db, 'regions'),
    );
  }
}
