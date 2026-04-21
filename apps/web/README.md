# @relay/web — Relay Core dashboard

Next.js 16 app that renders the public-facing Relay dashboard. Deployed to `relay-dashboard-three.vercel.app` and cross-project-rewritten under `https://relaymemory.com/dashboard/` by the `relay-landing` Vercel project.

## Local development

```bash
pnpm install
pnpm --filter @relay/web dev
```

### Two quirks to know about

**1. `basePath: '/dashboard'`** is set in `next.config.ts` so the app runs under a `/dashboard` prefix both in prod and local. That means:

| URL | Result |
|-----|--------|
| `http://localhost:3000/` | 404 |
| `http://localhost:3000/dashboard` | main dashboard |
| `http://localhost:3000/dashboard/hero` | chromeless BrainCore embed (used as an iframe source) |

Always open the dashboard at `/dashboard` locally. This matches the production layout where `relaymemory.com/dashboard/*` is rewritten to `relay-dashboard.vercel.app/dashboard/*`, so all internal asset URLs (`/dashboard/_next/...`) resolve through a single rewrite rule.

**2. `NEXT_PUBLIC_MOCK_DATA` flag** swaps every hook in `src/lib/hooks.ts` to read from in-memory fixtures in `src/lib/mockData.ts` (spaceship-fleet themed projects + packages + sessions with callsigns). Useful when you want to iterate on UI without a Supabase connection.

```bash
# Run against real Supabase (uses NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY from .env.local)
pnpm --filter @relay/web dev

# Run fully mocked — no backend needed, live-feed simulation included
NEXT_PUBLIC_MOCK_DATA=true pnpm --filter @relay/web dev
```

Production dashboard (`relaymemory.com/dashboard`) ships with `NEXT_PUBLIC_MOCK_DATA=true` so it's a pure demo. The real dashboard against your own Supabase is the unflagged default.

## Deploying

```bash
cd apps/web
vercel --prod --yes
```

Vercel project is `relay-dashboard` (team: `tensors-projects-81bb560c`). Stable alias: `relay-dashboard-three.vercel.app`. The landing (`relay-landing` Vercel project) has a rewrite in its `vercel.json` pointing at this alias.

SSO protection must stay disabled on `relay-dashboard` so the cross-project rewrite from `relaymemory.com` can proxy without auth. Disable via the Vercel API:

```bash
curl -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"ssoProtection":null}' \
  "https://api.vercel.com/v9/projects/prj_2fAlTI03imMuUfCEFieo3WJWXMap?teamId=team_ISc5ZI5tsREMxW2Hfu7qTwA1"
```

## Upstream notes

Next.js 16 has breaking changes from older versions. `AGENTS.md` in this directory flags this — check `node_modules/next/dist/docs/` before writing anything Next-specific.
