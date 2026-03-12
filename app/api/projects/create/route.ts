import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getServiceClient } from '@/lib/supabase'

function isAuthenticated(): boolean {
  const cookieStore = cookies()
  const session = cookieStore.get('forge_session')
  return session?.value === process.env.DASHBOARD_PASSWORD
}

async function createGitHubRepo(name: string, description: string): Promise<{ full_name: string; html_url: string; clone_url: string }> {
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_OWNER

  if (!token || !owner) throw new Error('Missing GITHUB_TOKEN or GITHUB_OWNER')

  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      name,
      description,
      private: true,
      auto_init: true,  // Creates main branch with README
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`GitHub API error: ${err.message || res.statusText}`)
  }

  return res.json()
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, vision, tech_stack, repo_name } = body

    if (!name || !vision || !repo_name) {
      return NextResponse.json(
        { error: 'name, vision, and repo_name are required' },
        { status: 400 }
      )
    }

    // Validate repo name format
    if (!/^[a-z0-9-]+$/.test(repo_name)) {
      return NextResponse.json(
        { error: 'repo_name must be lowercase letters, numbers and hyphens only' },
        { status: 400 }
      )
    }

    const db = getServiceClient()

    // Check name doesn't already exist
    const { data: existing } = await db
      .from('projects')
      .select('id')
      .eq('name', name)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'A project with this name already exists' }, { status: 409 })
    }

    // Create GitHub repo
    let githubRepo: { full_name: string; html_url: string; clone_url: string } | null = null
    try {
      githubRepo = await createGitHubRepo(repo_name, vision)
    } catch (githubErr) {
      // Non-fatal for project creation — user can manually set up repo
      console.warn('[projects/create] GitHub repo creation failed:', githubErr)
    }

    // Create project in Supabase
    const { data: project, error: projectErr } = await db
      .from('projects')
      .insert({
        name,
        vision,
        github_repo: repo_name,
        github_url: githubRepo?.html_url || null,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (projectErr) throw new Error(`Failed to create project: ${projectErr.message}`)

    // Seed a blank living spec for this project
    const defaultTechStack = tech_stack || [
      { layer: 'Frontend', choice: 'Next.js 14 + TypeScript + Tailwind' },
      { layer: 'Backend', choice: 'Next.js API routes' },
      { layer: 'Database', choice: 'Supabase (PostgreSQL)' },
      { layer: 'Deployment', choice: 'Vercel' },
    ]

    const { error: specErr } = await db.from('living_specs').insert({
      project_id: project.id,
      version: 1,
      content: {
        vision,
        goals: [],
        constraints: [],
        out_of_scope: [],
        tech_stack: defaultTechStack,
        architecture: [],
        file_conventions: {
          components_dir: 'components',
          lib_dir: 'lib',
          api_dir: 'app/api',
          naming_pattern: 'PascalCase.tsx',
          test_dir: '__tests__',
        },
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    if (specErr) throw new Error(`Failed to seed living spec: ${specErr.message}`)

    return NextResponse.json({
      project,
      github_repo: githubRepo,
      message: githubRepo
        ? `Project created and GitHub repo ${githubRepo.full_name} initialised`
        : 'Project created. GitHub repo creation failed — set up manually.',
    })

  } catch (err) {
    console.error('[projects/create] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = getServiceClient()
    const { data: projects, error } = await db
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ projects: projects || [] })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
