import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.question_id || !body?.answer || !body?.project_id) {
    return NextResponse.json({ error: 'question_id, answer, and project_id required' }, { status: 400 })
  }

  const db = getServiceClient()

  const { data: question } = await db
    .from('open_questions').select('*').eq('id', body.question_id).single()

  if (!question) return NextResponse.json({ error: 'Question not found' }, { status: 404 })

  await db.from('open_questions').update({
    answered: true, answer: body.answer, answered_at: new Date().toISOString()
  }).eq('id', body.question_id)

  // Unblock any workstreams waiting on this question
  const unblocked: string[] = []
  if (question.workstream_id) {
    const { data: ws } = await db
      .from('workstreams').select('id, blocked_by, name, status')
      .eq('id', question.workstream_id).single()

    if (ws && ws.status === 'blocked') {
      const { data: completed } = await db
        .from('workstreams').select('id').eq('project_id', body.project_id).eq('status', 'complete')
      const completedIds = new Set(completed?.map((w: any) => w.id) || [])
      const allDepsComplete = (ws.blocked_by || []).every((id: string) => completedIds.has(id))

      if (allDepsComplete) {
        await db.from('workstreams').update({
          status: 'queued', updated_at: new Date().toISOString()
        }).eq('id', ws.id)
        unblocked.push(ws.id)
      }
    }
  }

  return NextResponse.json({ success: true, unblocked_workstreams: unblocked })
}
