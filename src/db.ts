// Tiny IndexedDB wrapper: one store for JSON state, one for video/image blobs.
// Falls back to memory when IndexedDB is unavailable (private mode, some previews).

const DB_NAME = 'upped';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memKv = new Map<string, unknown>();
const memBlobs = new Map<string, Blob>();

function open(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function run<T>(
  store: 'kv' | 'blobs',
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memKv.get(key) as T | undefined;
  return run<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    memKv.set(key, value);
    return;
  }
  await run('kv', 'readwrite', (s) => s.put(value, key));
}

export async function blobPut(id: string, blob: Blob): Promise<void> {
  const db = await open();
  if (!db) {
    memBlobs.set(id, blob);
    return;
  }
  await run('blobs', 'readwrite', (s) => s.put(blob, id));
}

export async function blobGet(id: string): Promise<Blob | undefined> {
  const db = await open();
  if (!db) return memBlobs.get(id);
  return run<Blob>('blobs', 'readonly', (s) => s.get(id) as IDBRequest<Blob>);
}

export async function clearAll(): Promise<void> {
  memKv.clear();
  memBlobs.clear();
  const db = await open();
  if (!db) return;
  await run('kv', 'readwrite', (s) => s.clear());
  await run('blobs', 'readwrite', (s) => s.clear());
}

const urlCache = new Map<string, string>();
let remoteSource: ((path: string) => Promise<Blob | undefined>) | null = null;

/** Lets ids starting with "cloud:" be downloaded from the server (and cached on the phone). */
export function setRemoteBlobSource(fn: (path: string) => Promise<Blob | undefined>) {
  remoteSource = fn;
}

/** Object URL for a stored blob, cached for the page's lifetime. */
export async function blobUrl(id: string): Promise<string | undefined> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  let blob = await blobGet(id).catch(() => undefined);
  if (!blob && id.startsWith('cloud:') && remoteSource) {
    blob = await remoteSource(id.slice('cloud:'.length));
    if (blob) void blobPut(id, blob).catch(() => {});
  }
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}
