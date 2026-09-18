import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  dashscope,
  extractError,
  friendlyError,
} from "@/lib/dashscope";
import {
  APPEARANCE_MODEL,
  APPEARANCE_SYSTEM_PROMPT,
  APPEARANCE_VISION_FALLBACK,
  buildAppearancePrompt,
  DIRECTOR_MODEL,
} from "@/lib/director";

export const maxDuration = 60;

type Body = { name?: string; hint?: string; images?: string[] };

async function callAppearance(
  model: string,
  textPrompt: string,
  images: string[]
): Promise<{ status: number; body: Record<string, unknown> }> {
  const content =
    images.length
      ? [
          ...images.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
          { type: "text" as const, text: textPrompt },
        ]
      : [{ type: "text" as const, text: textPrompt }];
  return dashscope("/compatible-mode/v1/chat/completions", {
    method: "POST",
    json: {
      model,
      messages: [
        { role: "system", content: APPEARANCE_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.9,
      max_tokens: 200,
    },
  });
}

function pickDescription(
  res: { status: number; body: Record<string, unknown> }
): string | null {
  if (res.status !== 200) return null;
  const out = res.body as {
    choices?: { message?: { content?: string } }[];
  };
  const description = (out.choices?.[0]?.message?.content || "").trim();
  return description || null;
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
    const textPrompt = buildAppearancePrompt(name, body.hint);

    if (images.length) {
      const res = await callAppearance(APPEARANCE_MODEL, textPrompt, images);
      const description = pickDescription(res);
      if (description) {
        return NextResponse.json({
          description: description.slice(0, 600),
          model: APPEARANCE_MODEL,
          fallback: false,
          requestId: (res.body.id as string) || null,
        });
      }
      if (APPEARANCE_VISION_FALLBACK !== APPEARANCE_MODEL) {
        const res2 = await callAppearance(
          APPEARANCE_VISION_FALLBACK,
          textPrompt,
          images
        );
        const description2 = pickDescription(res2);
        if (description2) {
          return NextResponse.json({
            description: description2.slice(0, 600),
            model: APPEARANCE_VISION_FALLBACK,
            fallback: false,
            requestId: (res2.body.id as string) || null,
          });
        }
      }
    }

    const res = await callAppearance(
      DIRECTOR_MODEL,
      textPrompt,
      []
    );
    const out = res.body as {
      id?: string;
      error?: { code?: string; message?: string };
      message?: string;
    };
    if (res.status !== 200 || out.error || out.message) {
      const err = friendlyError(
        out.error?.message
          ? {
              code: String(out.error.code || `HTTP_${res.status}`),
              message: out.error.message,
              requestId: out.id,
            }
          : extractError(res.body)
      );
      return NextResponse.json(err, {
        status: res.status >= 400 ? res.status : 502,
      });
    }
    const description = pickDescription(res);
    if (!description) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "Model returned no description.",
          requestId: out.id,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      description: description.slice(0, 600),
      model: DIRECTOR_MODEL,
      fallback: images.length > 0,
      requestId: out.id || null,
    });
  } catch (err) {
    if (err instanceof ApiErrorLike) {
      return NextResponse.json(err.toApiError(), { status: 500 });
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
