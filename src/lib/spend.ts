import { promises as fs } from "fs";
import path from "path";
import type { DeletedAssetRecord, StoredAsset } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "analytics");
const SPEND_FILE = path.join(DATA_DIR, "deleted-assets.json");
const MAX_RECORDS = 5000;

export async function listDeletedAssets(
  project?: string | null
): Promise<DeletedAssetRecord[]> {
  let list: DeletedAssetRecord[];
  try {
    const raw = await fs.readFile(SPEND_FILE, "utf8");
    const parsed = JSON.parse(raw);
    list = Array.isArray(parsed) ? (parsed as DeletedAssetRecord[]) : [];
  } catch {
    return [];
  }
  return project === undefined
    ? list
    : project === null
      ? list.filter((r) => !r.projectId)
      : list.filter((r) => r.projectId === project);
}

export async function archiveDeletedAssets(
  assets: StoredAsset[]
): Promise<number> {
  const worth = assets.filter(
    (a) => (a.status ?? "succeeded") !== "pending" && !a.copiedFrom
  );
  if (!worth.length) return 0;
  const existing = await listDeletedAssets();
  const known = new Set(existing.map((r) => r.id));
  const deletedAt = Date.now();
  const added: DeletedAssetRecord[] = worth
    .filter((a) => !known.has(a.id))
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      model: a.model,
      prompt: (a.prompt || "").slice(0, 100),
      createdAt: a.createdAt,
      deletedAt,
      estimate: a.estimate ?? null,
      projectId: a.projectId ?? null,
    }));
  if (!added.length) return 0;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    SPEND_FILE,
    JSON.stringify([...added, ...existing].slice(0, MAX_RECORDS), null, 2),
    "utf8"
  );
  return added.length;
}
