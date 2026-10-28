import path from "path";
import { readJsonArray, withFileLock, writeJsonAtomic } from "./json-file";
import type { DeletedAssetRecord, StoredAsset } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "analytics");
const SPEND_FILE = path.join(DATA_DIR, "deleted-assets.json");
const MAX_RECORDS = 5000;

export function videoDurationSec(a: StoredAsset): number | undefined {
  const u = a.usage as { output_video_duration?: number; duration?: number } | undefined;
  const fromUsage = u?.output_video_duration ?? u?.duration;
  if (typeof fromUsage === "number" && fromUsage > 0) return fromUsage;
  const s = a.settings as { duration?: number } | undefined;
  if (typeof s?.duration === "number" && s.duration > 0) return s.duration;
  return undefined;
}

export async function listDeletedAssets(
  project?: string | null
): Promise<DeletedAssetRecord[]> {
  const list = await readJsonArray<DeletedAssetRecord>(SPEND_FILE);
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
  return withFileLock(SPEND_FILE, () => archive(worth));
}

async function archive(worth: StoredAsset[]): Promise<number> {
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
      used: a.used,
      durationSec: a.kind === "video" ? videoDurationSec(a) : undefined,
    }));
  if (!added.length) return 0;
  await writeJsonAtomic(SPEND_FILE, [...added, ...existing].slice(0, MAX_RECORDS));
  return added.length;
}
