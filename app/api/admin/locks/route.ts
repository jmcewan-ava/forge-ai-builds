/**
 * FORGE AI — Lock Admin Route
 * GET  /api/admin/locks             — view active file locks
 * DELETE /api/admin/locks?workstream_id=xxx  — force-release locks
 */

import { NextRequest, NextResponse } from 'next/server'
import { getActiveLocks, forceRelease } from '@/lib/file-lock'

export async function GET() {
  const locks = await getActiveLocks()
  return NextResponse.json({ locks, count: locks.length })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const workstreamId = searchParams.get('workstream_id')

  if (!workstreamId) return NextResponse.json({ error: 'workstream_id required' }, { status: 400 })

  const released = await forceRelease(workstreamId)
  return NextResponse.json({ released, workstream_id: workstreamId })
}
