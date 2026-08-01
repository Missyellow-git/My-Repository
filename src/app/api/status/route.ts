import { NextResponse } from "next/server";
import { blobToken, isEphemeral, storageMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the deployment can actually do. The UI reads this so a misconfigured
 * environment says so plainly instead of accepting edits it will lose.
 */
export async function GET() {
  return NextResponse.json({
    storage: storageMode(),
    ephemeral: isEphemeral(),
    blobConfigured: Boolean(blobToken()),
    generationConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
