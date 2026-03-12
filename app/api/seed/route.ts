import { NextRequest, NextResponse } from 'next/server'
import { seedDatabase } from '@/lib/seed'

export async function GET(req: NextRequest) {
  // Protect in production
  if (process.env.NODE_ENV === 'production') {
    const { searchParams } = new URL(req.url)
    const key = searchParams.get('key')
    if (!key || key !== process.env.SEED_KEY) {
      return NextResponse.json({ error: 'Unauthorised — pass ?key=SEED_KEY' }, { status: 401 })
    }
  }

  try {
    const result = await seedDatabase()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
