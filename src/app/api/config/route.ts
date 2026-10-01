import { NextResponse } from "next/server";
import { readConfig, toPublic } from "@/lib/config";
import { ApiErrorLike } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pub = toPublic(await readConfig());
    const models = pub.models.filter((m) => m.available);
    return NextResponse.json({
      configured: models.length > 0,
      openrouterConfigured: pub.providers.openrouter.hasKey,
      videoProvider: pub.videoProvider,
      roles: pub.roles,
      models,
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: false,
        models: [],
        error: err instanceof ApiErrorLike ? err.toApiError() : { message: String(err) },
      },
      { status: 500 }
    );
  }
}
