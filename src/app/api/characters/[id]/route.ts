import { NextRequest, NextResponse } from "next/server";
import {
  deleteCharacter,
  setCharacterProject,
  updateCharacter,
  type StoredFile,
} from "@/lib/characters";

export const maxDuration = 60;

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|bmp)$/i;
const AUDIO_MIME = /^audio\/(wav|x-wav|mpeg|mp3)$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteCharacter(id);
  if (!ok) {
    return NextResponse.json(
      { code: "NotFound", message: "Character not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const form = await req.formData();
    const moveRaw = form.get("moveProject");
    if (moveRaw !== null) {
      const ok = await setCharacterProject(
        id,
        moveRaw === "" || moveRaw === "none" ? null : String(moveRaw)
      );
      if (!ok)
        return NextResponse.json(
          { code: "NotFound", message: "Character not found." },
          { status: 404 }
        );
      return NextResponse.json({ ok: true, moved: true });
    }
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (name.length > 60 || description.length > 600) {
      return NextResponse.json(
        {
          code: "BadRequest",
          message: "Name must be ≤60 chars, description ≤600 chars.",
        },
        { status: 400 }
      );
    }

    let keepImageIndices: number[] | undefined;
    const rawKeep = form.get("keepImages");
    if (typeof rawKeep === "string" && rawKeep) {
      try {
        const parsed = JSON.parse(rawKeep);
        if (Array.isArray(parsed))
          keepImageIndices = parsed.filter(
            (n): n is number => Number.isInteger(n) && n >= 0
          );
      } catch {
        return NextResponse.json(
          { code: "BadRequest", message: "keepImages must be a JSON array." },
          { status: 400 }
        );
      }
    }

    const newImages: StoredFile[] = [];
    for (const f of form.getAll("images")) {
      if (!(f instanceof File)) continue;
      if (!IMAGE_MIME.test(f.type)) {
        return NextResponse.json(
          {
            code: "UnsupportedFormat",
            message: `${f.name}: only png/jpeg/webp/bmp images.`,
          },
          { status: 400 }
        );
      }
      if (f.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { code: "FileTooLarge", message: `${f.name}: image exceeds 10MB.` },
          { status: 400 }
        );
      }
      newImages.push({
        name: f.name,
        bytes: Buffer.from(await f.arrayBuffer()),
        contentType: f.type,
      });
    }
    if (keepImageIndices && keepImageIndices.length + newImages.length > MAX_IMAGES) {
      return NextResponse.json(
        { code: "BadRequest", message: `Max ${MAX_IMAGES} images per character.` },
        { status: 400 }
      );
    }

    let audio: StoredFile | undefined;
    const audioEntry = form.get("audio");
    if (audioEntry instanceof File) {
      const ok =
        AUDIO_MIME.test(audioEntry.type) ||
        /\.(wav|mp3)$/i.test(audioEntry.name);
      if (!ok) {
        return NextResponse.json(
          { code: "UnsupportedFormat", message: "Voice sample must be wav or mp3." },
          { status: 400 }
        );
      }
      if (audioEntry.size > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { code: "FileTooLarge", message: "Voice sample exceeds 15MB." },
          { status: 400 }
        );
      }
      audio = {
        name: audioEntry.name,
        bytes: Buffer.from(await audioEntry.arrayBuffer()),
        contentType: audioEntry.type || "audio/mpeg",
      };
    }
    const removeAudio = form.get("removeAudio") === "true";

    const result = await updateCharacter(id, {
      name: name || undefined,
      description,
      keepImageIndices,
      newImages,
      audio,
      removeAudio,
    });
    if (result === "invalid") {
      return NextResponse.json(
        {
          code: "BadRequest",
          message: "Character not found, or images must be 1–6.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ character: result });
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
