import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { runReadQuery, listTables, getDatabaseSummary, getTableSchema } from '@/lib/supabase-inspector'

function isAuthenticated(): boolean {
  const cookieStore = cookies()
  const session = cookieStore.get('forge_session')
  return session?.value === process.env.DASHBOARD_PASSWORD
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { sql, action, table_name } = body

    if (action === 'list_tables') {
      const tables = await listTables()
      return NextResponse.json({ tables })
    }

    if (action === 'summary') {
      const summary = await getDatabaseSummary()
      return NextResponse.json({ summary })
    }

    if (action === 'table_schema' && table_name) {
      const schema = await getTableSchema(table_name)
      return NextResponse.json({ schema })
    }

    if (!sql || typeof sql !== 'string') {
      return NextResponse.json({ error: 'sql or action required' }, { status: 400 })
    }

    const result = await runReadQuery(sql)
    return NextResponse.json(result)

  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    if (action === 'list_tables') {
      const tables = await listTables()
      return NextResponse.json({ tables })
    }

    if (action === 'summary') {
      const summary = await getDatabaseSummary()
      return NextResponse.json({ summary })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
