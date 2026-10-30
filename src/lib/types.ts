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

export type CharacterLook = {
  id: string;
  name: string;
  description: string;
  imageCount: number;
  updatedAt?: number;
};

export type Character = {
  id: string;
  name: string;
  description: string;
  imageCount: number;
  hasAudio: boolean;
  createdAt: number;
  updatedAt?: number;
  projectId?: string | null;
  hidden?: boolean;
  looks?: CharacterLook[];
  activeLookId?: string;
};

export function characterLooks(c: Character): CharacterLook[] {
  return c.looks?.length
    ? c.looks
    : [
        {
          id: "main",
          name: "Default",
          description: c.description,
          imageCount: c.imageCount,
        },
      ];
}

export function activeLook(c: Character): CharacterLook {
  const looks = characterLooks(c);
  return looks.find((l) => l.id === c.activeLookId) ?? looks[0];
}

export function charLookImgUrl(
  c: Pick<Character, "id" | "createdAt" | "updatedAt">,
  lookId: string,
  index: number
): string {
  return `/api/characters/${c.id}/image/${index}?look=${encodeURIComponent(lookId)}&v=${c.updatedAt ?? c.createdAt}`;
}

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
  seed?: number;
  retry?: boolean;
  retryMax?: number;
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
  deleted?: boolean;
  used?: boolean;
  durationSec?: number;
};

export type DeletedAssetRecord = {
  id: string;
  kind: "video" | "image";
  model: string;
  prompt: string;
  createdAt: number;
  deletedAt: number;
  estimate: number | null;
  projectId: string | null;
  used?: boolean;
  durationSec?: number;
};

export type DirectorRun = {
  id: string;
  createdAt: number;
  model: string;
  premise: string;
  fullPremise?: string;
  instruction?: string;
  parentId?: string;
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
  prompts: number;
};

export type PromptKind = "video" | "image" | "any";

export type SavedPrompt = {
  id: string;
  text: string;
  title: string;
  kind: PromptKind;
  projectId?: string | null;
  createdAt: number;
  updatedAt?: number;
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
  frameTime?: number;
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

export type PollProvider = "dashscope" | "qwencloud" | "tokenplan" | "openrouter";

export type RetryAttempt = {
  seed: number;
  taskId?: string;
  status: "running" | "failed" | "succeeded" | "cancelled";
  error?: string;
  at: number;
};

export type RetryInfo = {
  max: number | null;
  stopped: boolean;
  done: boolean;
  attempts: RetryAttempt[];
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
  pollProvider?: PollProvider;
  usage?: VideoUsage | ImageUsage;
  estimate?: number | null;
  params?: Record<string, string | number | boolean>;
  settings: Record<string, string | number | boolean | undefined>;
  results: { file: string; mime: string }[];
  refs: AssetRefMeta[];
  projectId?: string | null;
  copiedFrom?: string;
  hidden?: boolean;
  pinned?: boolean;
  used?: boolean;
  retry?: RetryInfo;
};

export type TaskRecord = {
  id: string;
  hidden?: boolean;
  pinned?: boolean;
  kind: "video" | "image";
  model: string;
  prompt: string;
  createdAt: number;
  status: TaskStatus;
  assetId?: string;
  taskId?: string;
  requestId?: string;
  pollProvider?: PollProvider;
  videoUrl?: string;
  imageUrls?: string[];
  usage?: VideoUsage | ImageUsage;
  error?: ApiError;
  estimate?: number | null;
  params?: Record<string, string | number | boolean>;
  settings?: AssetSettings;
  retry?: RetryInfo;
};

export type TaskPollResponse = {
  status: TaskStatus;
  videoUrl?: string;
  usage?: VideoUsage;
  error?: ApiError;
  requestId?: string;
  estimate?: number | null;
};

export type RewriteJobStatus = "running" | "succeeded" | "failed";

export type RewriteJob = {
  id: string;
  projectId: string | null;
  status: RewriteJobStatus;
  prompt: string;
  inventory: string[];
  sig: string;
  model: string;
  thinking?: boolean;
  rewrote?: string;
  error?: string;
  estimate?: number | null;
  createdAt: number;
  updatedAt: number;
  consumed: boolean;
};
