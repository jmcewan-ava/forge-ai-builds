import { NextRequest, NextResponse } from "next/server";
import { runOrchestratorPipeline } from "@/lib/orchestrator";

const MAX_BRIEF_LENGTH = 5000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("brief" in body) ||
      typeof (body as Record<string, unknown>).brief !== "string"
    ) {
      return NextResponse.json(
        { error: "Request body must include a \"brief\" string field." },
        { status: 400 }
      );
    }

    const { brief } = body as { brief: string };

    if (brief.trim().length === 0) {
      return NextResponse.json(
        { error: "Brief cannot be empty." },
        { status: 400 }
      );
    }

    if (brief.length > MAX_BRIEF_LENGTH) {
      return NextResponse.json(
        {
          error: `Brief exceeds the maximum allowed length of ${MAX_BRIEF_LENGTH} characters.`,
        },
        { status: 400 }
      );
    }

    const result = await runOrchestratorPipeline(brief);

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error("[POST /api/brief] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
