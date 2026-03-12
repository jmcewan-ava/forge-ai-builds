import { NextResponse } from 'next/server';
import { getCostSummary } from '@/lib/costTracker';

export async function GET(): Promise<NextResponse> {
  try {
    const summary = getCostSummary();
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to retrieve cost summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
