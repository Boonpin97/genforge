import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  getVideoProvider,
  uploadTempFile,
} from "@/lib/dashscope";

export const maxDuration = 300;

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE = 15 * 1024 * 1024;
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/x-quicktime"]);
const VIDEO_EXT = /\.(mp4|mov)$/i;
const AUDIO_MIME_RE = /^audio\/(wav|x-wav|mpeg|mp3)$/i;
const AUDIO_EXT = /\.(wav|mp3)$/i;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const model = String(form.get("model") || "wan3.0-video");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: "BadRequest", message: "No file provided (expected form field 'file')." },
        { status: 400 }
      );
    }

    const isAudio = AUDIO_MIME_RE.test(file.type) || AUDIO_EXT.test(file.name);
    const isVideo = VIDEO_MIME.has(file.type) || VIDEO_EXT.test(file.name);

    if (!isAudio && !isVideo) {
      return NextResponse.json(
        { code: "UnsupportedFormat", message: "Only .mp4/.mov videos and .wav/.mp3 audio are supported." },
        { status: 400 }
      );
    }
    if (isAudio && file.size > MAX_AUDIO_SIZE) {
      return NextResponse.json(
        { code: "FileTooLarge", message: "Audio must be 15MB or smaller." },
        { status: 400 }
      );
    }
    if (!isAudio && file.size > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { code: "FileTooLarge", message: "Video must be 100MB or smaller." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const contentType =
      file.type ||
      (isAudio
        ? AUDIO_EXT.test(file.name) && /\.wav$/i.test(file.name)
          ? "audio/wav"
          : "audio/mpeg"
        : /\.mov$/i.test(file.name)
          ? "video/quicktime"
          : "video/mp4");
    const url = await uploadTempFile(
      { bytes, filename: safeName, contentType },
      model,
      await getVideoProvider()
    );

    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof ApiErrorLike) {
      return NextResponse.json(err.toApiError(), { status: 502 });
    }
    return NextResponse.json(
      {
        code: "InternalError",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
