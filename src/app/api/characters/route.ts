import { NextRequest, NextResponse } from "next/server";
import { createCharacter, listCharacters, type StoredFile } from "@/lib/characters";
import { parseProjectParam } from "@/lib/projects";

export const maxDuration = 60;

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|bmp)$/i;
const AUDIO_MIME = /^audio\/(wav|x-wav|mpeg|mp3)$/i;

export async function GET(req: NextRequest) {
  const project = parseProjectParam(req.nextUrl.searchParams.get("project"));
  return NextResponse.json({ characters: await listCharacters(project) });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();

    if (!name) {
      return NextResponse.json(
        { code: "BadRequest", message: "Character name is required." },
        { status: 400 }
      );
    }
    if (name.length > 60 || description.length > 600) {
      return NextResponse.json(
        {
          code: "BadRequest",
          message: "Name must be ≤60 chars, description ≤600 chars.",
        },
        { status: 400 }
      );
    }

    const imageFiles = form
      .getAll("images")
      .filter((f): f is File => f instanceof File);
    const audioEntry = form.get("audio");
    const audioFile = audioEntry instanceof File ? audioEntry : undefined;

    if (imageFiles.length === 0 || imageFiles.length > MAX_IMAGES) {
      return NextResponse.json(
        { code: "BadRequest", message: `1–${MAX_IMAGES} images required.` },
        { status: 400 }
      );
    }

    const images: StoredFile[] = [];
    for (const f of imageFiles) {
      if (!IMAGE_MIME.test(f.type)) {
        return NextResponse.json(
          { code: "UnsupportedFormat", message: `${f.name}: only png/jpeg/webp/bmp images.` },
          { status: 400 }
        );
      }
      if (f.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { code: "FileTooLarge", message: `${f.name}: image exceeds 10MB.` },
          { status: 400 }
        );
      }
      images.push({
        name: f.name,
        bytes: Buffer.from(await f.arrayBuffer()),
        contentType: f.type,
      });
    }

    let audio: StoredFile | undefined;
    if (audioFile) {
      const audioOk =
        AUDIO_MIME.test(audioFile.type) || /\.(wav|mp3)$/i.test(audioFile.name);
      if (!audioOk) {
        return NextResponse.json(
          { code: "UnsupportedFormat", message: "Voice sample must be wav or mp3." },
          { status: 400 }
        );
      }
      if (audioFile.size > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { code: "FileTooLarge", message: "Voice sample exceeds 15MB." },
          { status: 400 }
        );
      }
      audio = {
        name: audioFile.name,
        bytes: Buffer.from(await audioFile.arrayBuffer()),
        contentType: audioFile.type || "audio/mpeg",
      };
    }

    const character = await createCharacter({
      name,
      description,
      images,
      audio,
      projectId: form.get("projectId")
        ? String(form.get("projectId"))
        : null,
    });
    return NextResponse.json({ character }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        code: "InternalError",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
