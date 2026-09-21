# GENFORGE

GENFORGE is a local, project-based content studio for generating and organizing images, videos, storyboards, characters, and reference media. It uses Alibaba Cloud Model Studio (DashScope) for Qwen and Wan models, with optional OpenRouter support for additional image and video models.

It is designed as an all-in-one, story-to-video workspace in the spirit of OpenArt and Higgsfield: develop a premise, turn it into a storyboard, establish reusable characters and reference media, generate images and video, then keep every output organized in the same project. Rather than moving between separate writing, image, video, and asset-management tools, GENFORGE keeps the full creative workflow in one local app.

![GENFORGE studio — Video · Wan3.0 tab with prompt, reference media, and output settings](public/screenshot.png)

## What it does

- Create separate projects for a shoot, client, or campaign. Each project keeps its generated assets, storyboards, characters, and uploads together. Deleting a project only makes its contents unassigned; it does not delete their files.
- Generate videos with `wan3.0-video` or `wan3.0-video-prime`, including text-to-video and reference-driven requests. Duration can be a fixed 2–30s or **smart**, where the model picks the length itself (wan3.0 models only; the cost is only known once the video lands, since billing follows the produced duration). The optional QwenCloud provider also exposes first/last-frame generation. A prompt under 200 characters opens a "too short / right tool?" dialog that must be dismissed or confirmed before generating.
- Generate images with `qwen-image-3.0-pro` or `qwen-image-3.0`, including image editing with up to three reference images.
- Use OpenRouter models by selecting the built-in Nano Banana 2 (`google/gemini-3.1-flash-image`), Grok Imagine Video, or entering another supported `provider/model` ID.
- Keep a character library with reference images, an optional voice sample, and a reusable description. Mention a character by name (or as an `@` chip) in a video or image prompt and its reference media and identity-binding prompt text are attached automatically at rewrite and at submit. Saved characters carry **Edit**, **Move or copy** and **Delete**.
- Use Director to turn a premise and cast into a storyboard in your house style, then revise and save versions. Video Prompt Rewrite formats a prompt and its attached material into a structured Wan reference-to-video request; characters mentioned by name are attached automatically so their references are included in the rewrite and the generation. A rewrite runs on the server as a saved job, so reloading the page, switching projects or closing the tab does not lose it — reopen the project and the panel picks the result up (and restores the prompt it was written from). If the server is restarted mid-rewrite the job is marked interrupted and you are asked to press Rewrite again.
- Paste a screenshot straight in: Ctrl+V anywhere in the studio saves images (or audio) from the clipboard into the upload library and switches to the Uploaded pane, ready to drag into a reference zone. Pasting text into a prompt is unaffected.
- Watch a result in the detail view with a frame-accurate `ss:cs` timecode. One row of buttons under the player holds every action: **Download frame** (the frame on screen, full-resolution PNG), **Frame to Uploaded**, **Download video**, **Copy file** (Windows: puts the actual file on the clipboard for Ctrl+V into Clipchamp), **Show in Explorer** and **Reuse settings**. Dragging the picture out to Explorer still works; dragging the player's own scrubber or volume slider seeks instead.
- Open a card's **expand prompt** to read the prompt in full; when a video was generated after a rewrite, the original and the rewritten text are both shown complete, with a badge on the one that was actually sent.
- Hide clutter without losing it: 👁 on a gallery tile removes an asset from the grid while keeping every file on disk, and the eye button next to the thumbnail-size controls reveals hidden assets again (hidden ones stay out of the grid by default on every load).
- Save generated results and uploaded image/audio files locally, browse them in the asset library, download or reuse generation settings, and move/copy items between projects. On Windows, 📋 on a gallery tile copies the actual file to the clipboard under a neutral name (`genforge-<date>-<id>.mp4`, revealing nothing about the prompt), so it can be pasted straight into another app; 📂 shows it in Explorer.
- Review estimated, not authoritative, costs for assets and Director/Rewrite runs in Analytics, scoped to the current project or to all projects. Rates can be changed with environment variables. Deleting an asset does not erase its cost: the amount already spent stays in the report, marked **deleted**, so totals never shrink retroactively (only assets deleted after this was added are covered).
- Open the **⚙ settings** menu in the header for **Notifications** and **Volume**. Notifications has a master switch — a chime, a desktop notification and a tab-title badge when work finishes while the window is not focused — plus a switch per kind of work: video generations, image generations, prompt rewrites and Director storyboards. Volume sets the video playback level shared by every player and the alert chime level, with a button to hear it. Everything is remembered per browser; if you decline the browser's notification prompt, the chime and title badge still work.

Generated media, references, characters, projects, uploads, and analytics records are stored under `data/`, which is intentionally ignored by Git. Generated results are downloaded into the asset library so they remain available after a provider URL expires. Pending video jobs and in-flight prompt rewrites are persisted and resume after a page reload.

## Quick start

Prerequisites: Node.js 20 or newer and a DashScope API key for the region you plan to use.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from the provided template, then add your DashScope key:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   ```dotenv
   DASHSCOPE_API_KEY=sk-your-key
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000), create a project, and open it to begin generating.

The app can open without a key, but DashScope generation, Director, and Rewrite require `DASHSCOPE_API_KEY`. Restart the server after changing `.env.local`.

## Configuration

Use `.env.example` as the complete reference. `.env.local` is read directly by the server and takes precedence over an OS-level `DASHSCOPE_API_KEY`. Never commit a real API key; `.env.local` and `data/` are already gitignored.

| Variable | Required for | Notes |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | DashScope image/video generation, Director, Rewrite | International/Singapore keys use the default international endpoint. |
| `DASHSCOPE_BASE_URL` | Non-default DashScope region or workspace endpoint | Beijing keys require `https://dashscope.aliyuncs.com`. The default is `https://dashscope-intl.aliyuncs.com`. |
| `OPENROUTER_API_KEY` | Nano Banana 2, Grok Imagine Video, and custom OpenRouter models | Uses `https://openrouter.ai/api/v1` by default. |
| `VIDEO_PROVIDER=qwencloud` | QwenCloud video generation | Also set `QWENCLOUD_API_KEY`; `QWENCLOUD_BASE_URL` is optional. This enables first/last-frame mode. |
| `DIRECTOR_MODEL`, `REWRITE_MODEL`, `APPEARANCE_MODEL` | Optional model overrides | Defaults are documented in `.env.example`. |
| `PRICE_*` | Cost display only | These are editable USD estimates, not provider billing records. |

DashScope keys are region-locked. Set the base URL to match the key's region before generating.

## Committing safely

This repository is public and `data/` holds personal material (generated videos, character reference photos and voice samples, uploads, analytics). A pre-commit hook in `.githooks/` refuses any commit that stages a path under `data/`, an `.env` file other than `.env.example`, private-key material, or a line that looks like a live API key.

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
| Configuration | `GET /api/config` |
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
.env.example      Safe configuration template
```

The stack is Next.js 16.3.4, React 19, TypeScript, and Tailwind CSS v4.
