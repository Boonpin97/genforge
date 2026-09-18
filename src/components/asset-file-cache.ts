const cache = new Map<string, File>();
const inflight = new Map<string, Promise<File | null>>();
const MAX_ENTRIES = 12;

function extFor(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime") || mime.includes("mov")) return "mov";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "bin";
}

export async function revealInExplorer(
  assetId: string,
  index = 0
): Promise<boolean> {
  try {
    const res = await fetch(`/api/assets/${assetId}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function getCachedFile(url: string): File | undefined {
  return cache.get(url);
}

export function prefetchFile(url: string, nameBase: string): Promise<File | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const flying = inflight.get(url);
  if (flying) return flying;
  const p = fetch(url)
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (!blob) return null;
      const file = new File([blob], `${nameBase}.${extFor(blob.type)}`, {
        type: blob.type,
      });
      cache.set(url, file);
      if (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest) cache.delete(oldest);
      }
      return file;
    })
    .catch(() => null)
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
