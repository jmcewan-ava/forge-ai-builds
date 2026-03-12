# Forge AI — Setup Guide

## What you're setting up

Forge AI is an autonomous multi-agent software factory. Once set up, you submit a brief and the system decomposes, builds, tests, and commits code to GitHub autonomously.

---

## Prerequisites

- A Supabase account (free tier is fine for v1)
- A GitHub account and Personal Access Token
- An Anthropic API key
- A Vercel account (for deployment)
- Node.js 18+ installed locally

---

## Step 1: Supabase

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon key** (under Settings → API)
3. Note your **service_role key** (same page — keep this secret)
4. Go to **SQL Editor** → paste the entire contents of `supabase/schema.sql` → Run
5. If you get a "publication already exists" error on the last few ALTER PUBLICATION lines — that's fine, ignore it

---

## Step 2: GitHub

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token (classic)
2. Select scope: **repo** (full control of private repositories)
3. Set expiry to 90 days or No expiry for long builds
4. Copy the token (you'll only see it once)
5. Create a new repository called `forge-ai` (private)

---

## Step 3: Anthropic

1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key
2. Copy the key

---

## Step 4: Environment Variables

Create a file called `.env.local` in the project root (copy from `.env.local.example`):

```
ANTHROPIC_API_KEY=sk-ant-...your-key...

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...

GITHUB_TOKEN=ghp_...your-pat...
GITHUB_OWNER=your-github-username
GITHUB_REPO=forge-ai
GITHUB_WEBHOOK_SECRET=pick-any-random-string-here

SEED_KEY=pick-another-random-string
```

---

## Step 5: Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll see a setup screen.

---

## Step 6: Seed the Database

With the dev server running:

```
GET http://localhost:3000/api/seed
```

Or open that URL in your browser. You should see:
```json
{ "message": "Database seeded successfully. Forge AI is ready." }
```

Refresh the main page — you should see the Forge AI dashboard.

---

## Step 7: Deploy to Vercel

```bash
# Install Vercel CLI if you don't have it
npm i -g vercel

# Deploy
vercel

# Follow prompts. When asked about environment variables:
# Add all of them from your .env.local file
```

Or connect via [vercel.com](https://vercel.com):
1. Import GitHub repository
2. Add all environment variables in the Vercel dashboard
3. Deploy

---

## Step 8: GitHub Webhook (optional but recommended)

Enables Forge AI to auto-update workstream status when PRs are merged.

1. Go to your target GitHub repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-vercel-url.vercel.app/api/webhooks/github`
3. Content type: `application/json`
4. Secret: same value as `GITHUB_WEBHOOK_SECRET` env var
5. Events: Select **Pull requests** only
6. Save

---

## Your first brief

Once deployed, go to your dashboard and submit a brief like:

> "Build the lib/orchestrator.ts file. This is the dependency resolver and parallel executor for Forge AI. It needs a buildExecutionPlan function that takes an array of Workstream objects and returns an ExecutionPlan with ordered execution levels. Use Kahn's algorithm for topological sort."

The Office Manager will decompose this into workstreams and the system will build it.

---

## Testing

```bash
# Run unit tests (pure function tests — no API calls)
npm test

# Type check
npm run typecheck
```

---

## Troubleshooting

**"No active project found"** → Run `/api/seed` first

**"Missing SUPABASE env vars"** → Check `.env.local` has all 4 Supabase variables

**"GitHub API 401"** → GITHUB_TOKEN may be expired or missing `repo` scope

**"Office Manager parse error"** → Brief too short or ambiguous. Add more detail.

**Workstream stuck in `in_progress`** → Agent timed out. Click the workstream and click "Re-run".

---

## Questions for Josh (fill these in)

- [ ] Q1: What GitHub username should `GITHUB_OWNER` be?
- [ ] Q2: What GitHub repo name should code be written to? (Can be `forge-ai` for recursive builds)
- [ ] Q3: Should Forge AI first build itself or build Bunny DTC? (May deadline consideration)
- [ ] Q4: Want Slack notifications when phases complete or agents escalate?

