import { NextResponse } from "next/server";
import {
  getBaseUrl,
  getVideoProvider,
  isConfigured,
  isQwencloudConfigured,
} from "@/lib/dashscope";
import { isOpenRouterConfigured } from "@/lib/openrouter";

export async function GET() {
  const videoProvider = await getVideoProvider();
  return NextResponse.json({
    configured: await isConfigured(),
    baseUrl: getBaseUrl(),
    openrouterConfigured: await isOpenRouterConfigured(),
    videoProvider,
    videoProviderConfigured:
      videoProvider === "qwencloud"
        ? await isQwencloudConfigured()
        : await isConfigured(),
  });
}
