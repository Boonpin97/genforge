const DB_NAME = "genforge-drafts";
const STORE = "blobs";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const OSS_TTL_MS = 47 * 60 * 60 * 1000;

type BlobRow = { blob: Blob; savedAt: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;
const stashed = new Set<string>();
const ossSeen = new Map<string, number>();

export function draftKey(projectId: string | null, panel: string) {
  return `genforge.draft.${projectId ?? "none"}.${panel}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise)
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => {
          resolve(req.result);
          prune(req.result);
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  return dbPromise;
}

function prune(conn: IDBDatabase) {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const req = conn.transaction(STORE, "readwrite").objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const row = cur.value as BlobRow | undefined;
      if (!row || row.savedAt < cutoff) cur.delete();
      cur.continue();
    };
  } catch {}
}

function request<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T | undefined> {
  return db().then(
    (conn) =>
      new Promise<T | undefined>((resolve) => {
        if (!conn) return resolve(undefined);
        try {
          const req = fn(conn.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

async function putBlob(id: string, blob: Blob): Promise<boolean> {
  const row: BlobRow = { blob, savedAt: Date.now() };
  const ok = await request<IDBValidKey>("readwrite", (s) => s.put(row, id));
  return ok !== undefined;
}

export async function stashMedia(id: string, url: string): Promise<boolean> {
  if (stashed.has(id)) return true;
  try {
    const blob = await (await fetch(url)).blob();
    if (!(await putBlob(id, blob))) return false;
    stashed.add(id);
    return true;
  } catch {
    return false;
  }
}

export async function loadBlob(id: string): Promise<Blob | null> {
  const row = await request<BlobRow>("readonly", (s) => s.get(id));
  if (!row?.blob) return null;
  if (await putBlob(id, row.blob)) stashed.add(id);
  return row.blob;
}

export function ossUploadedAt(id: string, at?: number): number {
  if (at) ossSeen.set(id, at);
  let t = ossSeen.get(id);
  if (!t) {
    t = Date.now();
    ossSeen.set(id, t);
  }
  return t;
}
