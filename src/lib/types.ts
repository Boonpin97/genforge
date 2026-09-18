export type MediaType =
  | "reference_image"
  | "reference_video"
  | "reference_audio"
  | "first_frame"
  | "last_frame";

export type MediaPayload = {
  type: MediaType;
  url: string;
  name?: string;
  previewUrl?: string;
  durationSec?: number;
  characterId?: string;
};

export type VideoUsage = {
  video_count?: number;
  duration?: number;
  input_video_duration?: number;
  output_video_duration?: number;
  fps?: number;
  SR?: number;
  ratio?: string;
};

export type ImageUsage = {
  output_width?: number;
  output_height?: number;
  input_image_count?: number;
  input_image_type?: string;
  output_image_count?: number;
  output_image_type?: string;
};

export type ApiError = {
  code?: string;
  message: string;
  requestId?: string;
};

export type TaskStatus =
  | "submitting"
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type Character = {
  id: string;
  name: string;
  description: string;
  imageCount: number;
  hasAudio: boolean;
  createdAt: number;
  updatedAt?: number;
  projectId?: string | null;
};

export function charImgUrl(
  c: Pick<Character, "id" | "createdAt" | "updatedAt">,
  index: number
): string {
  return `/api/characters/${c.id}/image/${index}?v=${c.updatedAt ?? c.createdAt}`;
}

export function charAudioUrl(
  c: Pick<Character, "id" | "createdAt" | "updatedAt">
): string {
  return `/api/characters/${c.id}/audio?v=${c.updatedAt ?? c.createdAt}`;
}

export type VideoSettings = {
  kind: "video";
  prompt: string;
  userPrompt?: string;
  rewrotePrompt?: string;
  promptTab?: "prompt" | "rewritten";
  model: string;
  resolution: string;
  ratio: string;
  duration: number;
  audio: boolean;
  watermark: boolean;
  media: MediaPayload[];
};

export type ImageSettings = {
  kind: "image";
  prompt: string;
  userPrompt?: string;
  model: string;
  size: string;
  n: number;
  negativePrompt?: string;
  promptExtend: boolean;
  watermark: boolean;
  seed?: number;
  images: { name: string; url: string; characterId?: string }[];
};

export type AssetSettings = VideoSettings | ImageSettings;

export type CostKind = "video" | "image" | "director" | "rewrite";

export type CostRecord = {
  id: string;
  kind: CostKind;
  model: string;
  prompt: string;
  createdAt: number;
  estimate: number | null;
};

export type DirectorRun = {
  id: string;
  createdAt: number;
  model: string;
  premise: string;
  estimate: number | null;
  tokens?: number | null;
  script?: string;
  revised?: boolean;
  kind?: "director" | "rewrite";
  projectId?: string | null;
  copied?: boolean;
};

export type Project = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectCounts = {
  assets: number;
  scripts: number;
  characters: number;
  uploads: number;
};

export type UploadRecord = {
  id: string;
  kind: "image" | "audio";
  filename: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  projectId?: string | null;
};

export type AssetRefMeta = {
  name: string;
  kind: "image" | "video" | "audio";
  type?: MediaType;
  durationSec?: number;
  file?: string;
  url?: string;
  characterId?: string;
};

export type StoredAsset = {
  id: string;
  kind: "video" | "image";
  model: string;
  prompt: string;
  createdAt: number;
  status?: "pending" | "succeeded" | "failed";
  error?: string;
  taskId?: string;
  requestId?: string;
  usage?: VideoUsage | ImageUsage;
  estimate?: number | null;
  params?: Record<string, string | number | boolean>;
  settings: Record<string, string | number | boolean | undefined>;
  results: { file: string; mime: string }[];
  refs: AssetRefMeta[];
  projectId?: string | null;
  copiedFrom?: string;
};

export type TaskRecord = {
  id: string;
  kind: "video" | "image";
  model: string;
  prompt: string;
  createdAt: number;
  status: TaskStatus;
  assetId?: string;
  taskId?: string;
  requestId?: string;
  videoUrl?: string;
  imageUrls?: string[];
  usage?: VideoUsage | ImageUsage;
  error?: ApiError;
  estimate?: number | null;
  params?: Record<string, string | number | boolean>;
  settings?: AssetSettings;
};

export type TaskPollResponse = {
  status: TaskStatus;
  videoUrl?: string;
  usage?: VideoUsage;
  error?: ApiError;
  requestId?: string;
  estimate?: number | null;
};
