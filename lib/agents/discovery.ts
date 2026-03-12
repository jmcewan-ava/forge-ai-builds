/**
 * FORGE AI — Discovery Agent
 *
 * Reads the entire codebase BEFORE any build begins.
 * Produces a structured DiscoveryReport: every export, every import,
 * every function signature, every type, cross-file dependency map.
 *
 * Nobody writes code without Discovery running first.
 */

import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface FunctionSignature {
  name: string
  params: string        // e.g. "(workstream: Workstream, spec: LivingSpec): Promise<BuilderOutput>"
  exported: boolean
  async: boolean
  file: string
}

export interface FileMap {
  path: string
  exports: string[]         // exported names
  imports: Record<string, string[]>  // "from path" -> [names]
  functions: FunctionSignature[]
  size_chars: number
}

export interface DiscoveryReport {
  files: FileMap[]
  all_exports: Record<string, string>   // name -> file path
  all_imports: Record<string, string[]> // "name" -> files that import it
  cross_file_deps: Record<string, string[]> // file -> files it depends on
  potential_risks: string[]             // things the agent flags as risky
  summary: string                       // human-readable overview
  generated_at: string
}

const DISCOVERY_MODEL = process.env.DISCOVERY_MODEL || 'claude-sonnet-4-6'

/**
 * Fetch file tree from GitHub and read relevant source files
 */
async function fetchCodebase(filePaths?: string[]): Promise<Record<string, string>> {
  const token = process.env.GITHUB_TOKEN!
  const owner = process.env.GITHUB_OWNER!
  const repo = process.env.GITHUB_REPO!

  const octokit = new Octokit({ auth: token })
  const contents: Record<string, string> = {}

  // If specific files requested, just read those
  // Otherwise, read all .ts files in lib/ and app/api/
  let paths: string[] = filePaths || []

  if (paths.length === 0) {
    try {
      const { data: tree } = await octokit.git.getTree({
        owner, repo, tree_sha: 'main', recursive: '1'
      })
      paths = (tree.tree || [])
        .filter(f =>
          f.type === 'blob' &&
          f.path &&
          (f.path.startsWith('lib/') || f.path.startsWith('app/api/') || f.path.startsWith('components/')) &&
          f.path.endsWith('.ts') || (f.path?.endsWith('.tsx') && f.path?.startsWith('components/'))
        )
        .map(f => f.path!)
        .filter(Boolean)
    } catch (err) {
      console.error('[Discovery] Failed to fetch file tree:', err)
      return contents
    }
  }

  // Fetch files in parallel batches of 10
  for (let i = 0; i < paths.length; i += 10) {
    const batch = paths.slice(i, i + 10)
    await Promise.allSettled(
      batch.map(async path => {
        try {
          const { data } = await octokit.repos.getContent({ owner, repo, path })
          if ('content' in data && data.content) {
            contents[path] = Buffer.from(data.content, 'base64').toString('utf-8')
          }
        } catch { /* file may not exist */ }
      })
    )
  }

  return contents
}

/**
 * Run Discovery: read codebase, produce structured report
 */
export async function runDiscoveryAgent(
  workstreamName: string,
  brief: string,
  targetFiles?: string[]
): Promise<DiscoveryReport> {
  const codebase = await fetchCodebase(targetFiles)
  const fileList = Object.keys(codebase)

  if (fileList.length === 0) {
    return {
      files: [], all_exports: {}, all_imports: {}, cross_file_deps: {},
      potential_risks: ['Could not read codebase from GitHub'],
      summary: 'Discovery failed — no files could be read',
      generated_at: new Date().toISOString()
    }
  }

  // Build file contents string, truncating large files
  const codebaseStr = fileList.map(path => {
    const content = codebase[path]
    const truncated = content.length > 6000 ? content.slice(0, 6000) + '\n// ... truncated' : content
    return `\n\n=== FILE: ${path} (${content.length} chars) ===\n${truncated}`
  }).join('')

  const systemPrompt = `You are the Discovery Agent in the Forge AI system.

Your ONLY job: read the codebase and produce a precise structural map.
This map will be used by other agents before they write any code.
Accuracy is critical — mistakes here cascade into broken code.

Analyse every file for:
1. Every exported function: name, exact parameter types, return type
2. Every import statement: what is imported from where
3. Cross-file dependencies: which files call which functions
4. Potential risks: things that could break if changed carelessly

Output ONLY valid JSON matching this exact shape:
{
  "files": [
    {
      "path": "lib/orchestrator.ts",
      "exports": ["runWorkstream", "runPhase", "RunWorkstreamResult"],
      "imports": {
        "./claude": ["runBuilderAgent", "runQAManager"],
        "./file-lock": ["acquireLocks", "releaseLocks"]
      },
      "functions": [
        {
          "name": "runWorkstream",
          "params": "(workstream: Workstream, livingSpec: LivingSpec, failurePatterns: FailurePattern[], projectId: string): Promise<RunWorkstreamResult>",
          "exported": true,
          "async": true,
          "file": "lib/orchestrator.ts"
        }
      ],
      "size_chars": 15420
    }
  ],
  "all_exports": {
    "runWorkstream": "lib/orchestrator.ts",
    "runBuilderAgent": "lib/claude.ts"
  },
  "all_imports": {
    "runWorkstream": ["app/api/agent/run/route.ts"]
  },
  "cross_file_deps": {
    "lib/orchestrator.ts": ["lib/claude.ts", "lib/file-lock.ts", "lib/file-writer.ts"]
  },
  "potential_risks": [
    "releaseLocks only takes 1 argument (workstreamId) — callers must not pass 2",
    "commitFiles expects (workstreamId, workstreamName, files, config) — 4 args"
  ],
  "summary": "Codebase has X files. Key dependency: orchestrator.ts depends on claude.ts for all LLM calls."
}`

  try {
    const response = await anthropic.messages.create({
      model: DISCOVERY_MODEL,
      max_tokens: 8000,
      temperature: 0,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Workstream to build: "${workstreamName}"\n\nBrief:\n${brief}\n\nCodebase to analyse:\n${codebaseStr}`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    return {
      ...parsed,
      generated_at: new Date().toISOString()
    } as DiscoveryReport

  } catch (err) {
    console.error('[Discovery] Failed to parse discovery report:', err)
    // Return a minimal report so the pipeline can continue
    return {
      files: fileList.map(path => ({
        path,
        exports: [],
        imports: {},
        functions: [],
        size_chars: codebase[path]?.length || 0
      })),
      all_exports: {},
      all_imports: {},
      cross_file_deps: {},
      potential_risks: ['Discovery agent failed to produce structured report — proceed with caution'],
      summary: `Read ${fileList.length} files but could not parse structure`,
      generated_at: new Date().toISOString()
    }
  }
}

/**
 * Format discovery report for injection into other agent prompts
 */
export function formatDiscoveryForPrompt(report: DiscoveryReport): string {
  const risks = report.potential_risks.length > 0
    ? `\nKNOWN RISKS — READ THESE BEFORE WRITING ANY CODE:\n${report.potential_risks.map(r => `  ⚠ ${r}`).join('\n')}`
    : ''

  const exportMap = Object.entries(report.all_exports)
    .map(([name, file]) => `  ${name} → ${file}`)
    .join('\n')

  const importMap = Object.entries(report.all_imports)
    .filter(([, files]) => files.length > 0)
    .map(([name, files]) => `  ${name} is used by: ${files.join(', ')}`)
    .join('\n')

  const functionSigs = report.files
    .flatMap(f => f.functions.filter(fn => fn.exported))
    .map(fn => `  ${fn.file}: ${fn.name}${fn.params}`)
    .join('\n')

  return `=== DISCOVERY REPORT ===
${report.summary}
${risks}

EXPORTED FUNCTIONS (exact signatures — match these precisely when calling):
${functionSigs || '  (none found)'}

ALL EXPORTS BY FILE:
${exportMap || '  (none found)'}

WHO IMPORTS WHAT (changing these breaks these callers):
${importMap || '  (none found)'}
=== END DISCOVERY ===`
}
