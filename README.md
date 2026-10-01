# GENFORGE

GENFORGE is a local, project-based content studio for generating and organizing images, videos, storyboards, characters, and reference media. It uses Alibaba Cloud Model Studio (DashScope) for Qwen and Wan models, and OpenRouter for every other model — Veo, Kling, Seedance, Hailuo, Runway, Grok, Nano Banana, GPT Image, FLUX, Claude, GPT, Gemini and more. You pick which models appear on the **Models and API keys** page.

It is designed as an all-in-one, story-to-video workspace in the spirit of OpenArt and Higgsfield: develop a premise, turn it into a storyboard, establish reusable characters and reference media, generate images and video, then keep every output organized in the same project. Rather than moving between separate writing, image, video, and asset-management tools, GENFORGE keeps the full creative workflow in one local app.

![GENFORGE studio — Video · Wan3.0 tab with prompt, reference media, and output settings](public/screenshot.png)

## What it does

- Create separate projects for a shoot, client, or campaign. Each project keeps its generated assets, storyboards, characters, and uploads together. Deleting a project only makes its contents unassigned; it does not delete their files.
- Manage models on the **Models and API keys** page (`/models`, also in the ⚙ menu and on the projects screen): paste a key per provider, test it, turn models on or off, edit each model's limits and prices, add any other OpenRouter model from its live catalog, and choose which writing model does Director, prompt rewrite and character auto-write. The Video, Images and Director tabs only offer models that are on **and** have a key.
- Every model carries its own policy, and the panels follow it: allowed durations (a range, or fixed lengths such as Veo's 4/6/8s), resolutions, aspect ratios, whether it generates audio, first/last-frame support, how many reference images, videos and audio clips it takes and their size limits, and whether reference video eats into the output length (Wan: reference plus output must fit in 30s). The server enforces the same policy, so a bad request is rejected with a clear message before it costs anything.
- Generate videos with Wan 3.0 / Prime on DashScope (text, reference images/video/audio, **smart** duration where the model picks the length, first/last frame on the QwenCloud endpoint) or, through OpenRouter, Veo 3.1 (Fast, Lite), Kling 3.0, Seedance 2.x, HappyHorse, Hailuo 3, Runway Gen-4.5 and Grok Imagine. OpenRouter's video API accepts images only, so reference video and audio are Wan-only. A prompt under 200 characters opens a "too short / right tool?" dialog that must be dismissed or confirmed before generating.
- Generate images with Qwen Image 3.0 (Pro and Fast) or, through OpenRouter, Nano Banana 2 / Pro, GPT Image 2, Seedream 5, FLUX.2 Pro, Grok Imagine Image and Recraft.
- Keep a character library with reference images, an optional voice sample, and a reusable description. Mention a character by name (or as an `@` chip) in a video or image prompt and its reference media and identity-binding prompt text are attached automatically at rewrite and at submit. Saved characters carry **Edit**, **Move or copy** and **Delete**.
- Use Director to turn a premise and cast into a storyboard in your house style, then revise and save versions. Video Prompt Rewrite formats a prompt and its attached material into a structured Wan reference-to-video request; characters mentioned by name are attached automatically so their references are included in the rewrite and the generation. A rewrite runs on the server as a saved job, so reloading the page, switching projects or closing the tab does not lose it — reopen the project and the panel picks the result up (and restores the prompt it was written from). A **Think** toggle beside ✦ Rewrite turns the model's reasoning mode on for harder prompts; it is off by default because a normal rewrite takes a few seconds while a thinking one can take 40–160s. If the server is restarted mid-rewrite the job is marked interrupted and you are asked to press Rewrite again.
- Paste a screenshot straight in: Ctrl+V anywhere in the studio saves images (or audio) from the clipboard into the upload library and switches to the Uploaded pane, ready to drag into a reference zone. Pasting text into a prompt is unaffected.
- Watch a result in the detail view with a frame-accurate `ss:cs` timecode. One row of buttons under the player holds every action: **Download frame** (the frame on screen, full-resolution PNG), **Frame to Uploaded**, **Download video**, **Copy file** (Windows: puts the actual file on the clipboard for Ctrl+V into Clipchamp), **Show in Explorer** and **Reuse settings**. Dragging the picture out to Explorer still works; dragging the player's own scrubber or volume slider seeks instead.
- Open a card's **expand prompt** to read the prompt in full; when a video was generated after a rewrite, the original and the rewritten text are both shown complete, with a badge on the one that was actually sent.
- Hide clutter without losing it: 👁 on a gallery tile removes an asset from the grid while keeping every file on disk, and the eye button next to the thumbnail-size controls reveals hidden assets again (hidden ones stay out of the grid by default on every load).
- Keep favourites in reach: 📌 on a gallery tile pins it to the top of the Generated grid (marked with an accent border). Pinned assets come first, then anything still generating, then the rest by date. Pins persist across reloads.
- Save generated results and uploaded image/audio files locally, browse them in the asset library, download or reuse generation settings, and move/copy items between projects. On Windows, 📋 on a gallery tile copies the actual file to the clipboard under a neutral name (`genforge-<date>-<id>.mp4`, revealing nothing about the prompt), so it can be pasted straight into another app; 📂 shows it in Explorer.
- See what your kept footage really costs: copying a video file out (📋) marks it **used**, and Analytics reports the **video cost per used minute** — every generated video's cost in the period divided by the total minutes of videos you actually used (10 videos at $2 with only 5 copied out, 30s each = $20 ÷ 2.5 min = $8/min).
- Review estimated, not authoritative, costs for assets and Director/Rewrite runs in Analytics, scoped to the current project or to all projects. Rates are set per model on the Models page; where OpenRouter reports the actual charge, that is used instead. Deleting an asset does not erase its cost: the amount already spent stays in the report, marked **deleted**, so totals never shrink retroactively (only assets deleted after this was added are covered).
- Open the **⚙ settings** menu in the header for **Notifications** and **Volume**. Notifications has a master switch — a chime, a desktop notification and a tab-title badge when work finishes while the window is not focused — plus a switch per kind of work: video generations, image generations, prompt rewrites and Director storyboards. Volume sets the video playback level shared by every player and the alert chime level, with a button to hear it. Everything is remembered per browser; if you decline the browser's notification prompt, the chime and title badge still work.

Generated media, references, characters, projects, uploads, and analytics records are stored under `data/`, which is intentionally ignored by Git. Generated results are downloaded into the asset library so they remain available after a provider URL expires. Pending video jobs and in-flight prompt rewrites are persisted and resume after a page reload.

## Quick start

Prerequisites: Node.js 20 or newer, and a DashScope key (for Qwen/Wan) and/or an OpenRouter key (for everything else).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000/models](http://localhost:3000/models), paste your keys and turn on the models you want. Then go back, create a project, and open it to begin generating.

## Configuration

All settings live in **`genforge.config.json`** in the project folder. It is created with defaults on first run, is gitignored, and is re-read whenever it changes, so edits (from the Models page or by hand) apply without a restart. `genforge.config.example.json` is the committed template with the full researched catalog and empty keys — copy it to `genforge.config.json` if you prefer to edit by hand. `.env.local` is no longer read.

| Section | What it holds |
| --- | --- |
| `providers.dashscope` | DashScope key and base URL. Keys are region-locked: Singapore uses `https://dashscope-intl.aliyuncs.com` (default), Beijing `https://dashscope.aliyuncs.com`. |
| `providers.qwencloud` | Optional QwenCloud key and base URL, used for Wan video when `videoProvider` is `qwencloud` (enables first/last-frame mode). |
| `providers.openrouter` | OpenRouter key and base URL; serves every model whose id looks like `vendor/model`. |
| `roles` | Writing model for `director` (default), `rewrite` and `appearance` (must read images). |
| `models[]` | One entry per model: `id`, `label`, `kind` (`video`, `image`, `text`), `provider`, `enabled`, `policy` (limits), `pricing` (USD estimates) and `notes`. |

Video `policy` fields: `durations` (`{min,max}` or `{values:[…]}`), `smartDuration`, `resolutions`, `ratios`, `audio`, `frames`, `framesRequireQwencloud`, `seed`, `watermark`, and `refs` — `maxImages`, `maxVideos`, `maxVideoTotalSec`, `maxAudio`, `maxAudioSec`, the `max*MB` size limits, `videoCountsTowardDuration` with `totalBudgetSec`, and `framesExclusiveWithRefs`. Image `policy`: `maxRefs`, `maxRefMB`, `maxN`, `sizes`, `negativePrompt`, `promptExtend`, `watermark`, `seed`. Text `policy`: `vision`, `maxTokens`. Prices are `perSecond` / `perSecondNoAudio` (keyed by resolution or `default`), `perImage` / `perInputImage`, or `per1KInput` / `per1KOutput`.

Keys never leave the server: the page only ever sees whether a key is set and its last four characters.

## Committing safely

This repository is public and `data/` holds personal material (generated videos, character reference photos and voice samples, uploads, analytics). A pre-commit hook in `.githooks/` refuses any commit that stages a path under `data/`, `genforge.config.json`, any `.env` file, private-key material, or a line that looks like a live API key.

Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

If you ever need to get past it deliberately, `git commit --no-verify`.

## Development and local servers

```bash
npm run dev       # development server on http://localhost:3000
npm run dev2      # second development server on http://localhost:3001
npm run lint      # ESLint
npx tsc --noEmit  # TypeScript check
```

`npm run build` writes the production build to `.next-prod`; `npm run start` serves that build on port 3000. Use the development server for normal local work. If port 3000 is already running the production app, use `npm run dev2` and test at [http://localhost:3001](http://localhost:3001) instead.

If generated Next.js route helper types are missing, run:

```bash
npx next typegen
```

## Server API overview

The browser never calls model providers directly: all requests go through Next.js route handlers so API keys stay on the server.

| Area | Routes |
| --- | --- |
| Configuration | `GET /api/config` (available models, no keys), `GET`/`PUT /api/models` (the Models page), `POST /api/models/test` (check a key), `GET /api/models/openrouter-catalog` (drafts from OpenRouter's live catalog) |
| DashScope generation | `POST /api/generate/image`, `POST /api/generate/video`, `GET /api/task/[id]` |
| OpenRouter generation | `POST /api/generate/openrouter`, `POST /api/generate/openrouter-video`, `GET /api/task/[id]?provider=openrouter` |
| Reference-media transfer | `POST /api/upload` for temporary provider uploads; `GET`/`POST`/`DELETE /api/uploads` for the local upload library |
| Assets | `GET`/`POST`/`DELETE /api/assets`, item/result routes under `/api/assets/[id]`, plus bulk move/copy and completion/failure routes |
| Projects | `GET`/`POST /api/projects`, `PATCH`/`DELETE /api/projects/[id]` |
| Characters | `GET`/`POST /api/characters`, `PATCH`/`DELETE /api/characters/[id]`, and stored image/audio routes |
| Writing and reporting | `GET`/`POST /api/director`, `POST /api/director/bulk`, `GET`/`POST /api/rewrite-prompt` plus `GET /api/rewrite-prompt/[id]` and `POST /api/rewrite-prompt/[id]/ack`, `POST /api/appearance`, `GET /api/analytics` |

Long-running video jobs use an asynchronous create-and-poll flow. The app creates a pending local asset before submission, polls the provider through `/api/task/[id]`, and finalizes or marks the local asset failed when a result arrives.

## Project structure

```text
src/app/          App Router pages and server API routes
src/components/   Studio panels, galleries, prompt editor, and UI primitives
src/lib/          Provider clients, persistence, pricing, project, and type helpers
data/             Local runtime storage (gitignored)
genforge.config.example.json   Configuration template (no keys)
```

The stack is Next.js 16.3.4, React 19, TypeScript, and Tailwind CSS v4.
