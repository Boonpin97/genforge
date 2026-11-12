import { NextRequest, NextResponse } from "next/server";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { APPEARANCE_SYSTEM_PROMPT, buildAppearancePrompt } from "@/lib/director";
import { chat, type ChatContent } from "@/lib/chat";
import { roleModel } from "@/lib/config";
import type { ModelEntry } from "@/lib/model-catalog";

export const maxDuration = 60;

type Body = { name?: string; hint?: string; images?: string[] };

function callAppearance(model: ModelEntry, textPrompt: string, images: string[]) {
  const content: ChatContent = images.length
    ? [
        ...images.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
        { type: "text" as const, text: textPrompt },
      ]
    : textPrompt;
  return chat(
    model,
    [
      { role: "system", content: APPEARANCE_SYSTEM_PROMPT },
      { role: "user", content },
    ],
    { temperature: images.length ? 0.3 : 0.9, maxTokens: 200, enableThinking: false }
  );
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }
  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { code: "BadRequest", message: "A character name is required." },
      { status: 400 }
    );
  }
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((u) => typeof u === "string" && u.startsWith("data:image/"))
    .slice(0, 3);

  try {
    const textPrompt = buildAppearancePrompt(name, body.hint, images.length > 0);
    const model = images.length
      ? await roleModel("appearance", { vision: true })
      : await roleModel("director");
    const res = await callAppearance(model, textPrompt, images);
    if (!res.ok) {
      const error = images.length
        ? {
            ...res.error,
            message: `${model.label} could not read the reference images: ${res.error.message}`,
          }
        : res.error;
      return NextResponse.json(error, { status: res.status });
    }
    if (!res.text) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "Model returned no description.",
          requestId: res.requestId || undefined,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      description: res.text.slice(0, 600),
      model: model.id,
      images: images.length,
      requestId: res.requestId,
    });
  } catch (err) {
    if (err instanceof ApiErrorLike) {
      return NextResponse.json(err.toApiError(), { status: errorStatus(err) });
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
