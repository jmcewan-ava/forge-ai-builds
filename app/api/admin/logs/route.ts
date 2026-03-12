import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getServiceClient } from '@/lib/supabase'

function isAuthenticated(): boolean {
  const cookieStore = cookies()
  const session = cookieStore.get('forge_session')
  return session?.value === process.env.DASHBOARD_PASSWORD
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const workstreamId = searchParams.get('workstream_id')
  const projectId = searchParams.get('project_id')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    const db = getServiceClient()

    let query = db
      .from('agent_logs')
      .select('id, agent_role, model, input_tokens, output_tokens, cost_usd, response_text, created_at, iteration, workstream_id')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (workstreamId) query = query.eq('workstream_id', workstreamId)
    if (projectId) query = query.eq('project_id', projectId)

    const { data: logs, error } = await query

    if (error) throw error

    return NextResponse.json({ logs: logs || [] })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
