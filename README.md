# Blue is the Clue — Vantage Data Assistant

A general-purpose data-analyst chat assistant, connected to Claude and to your live Teradata Vantage database. It can chat freely, write and run SQL queries against Vantage on its own, analyze CSV files you attach, generate charts, and keep multiple chat sessions in a sidebar.

---

## ⚠️ Read this first — a real, untested risk

The Teradata connection uses Teradata's official Node.js driver (`teradatasql` on npm). That driver depends on **native binary bindings** (`ffi-napi`), which are known to be unreliable in serverless environments like Vercel — they can fail to install or run correctly there, for reasons outside our control.

**This was a known tradeoff accepted when building this** — there was no way to test the actual Teradata connection from the environment this was built in (no network access). It's entirely possible the `query_teradata` tool simply won't work once deployed. If that happens, don't assume your code or credentials are wrong first — check the Vercel function logs for the actual error, and see the **Fallback plan** section at the bottom of this file.

Everything else (Claude chat, sidebar, file upload, charts) does not depend on this and should work regardless.

---

## Setup, start to finish

### 1. Get your API key and Teradata credentials

- Anthropic API key: https://console.anthropic.com → API Keys (make sure you also have billing/credits set up under Plans & Billing)
- Teradata Vantage: you need the **host**, **username**, and **password** for your instance (the same kind of credentials used in your Teradata Studio / notebook connection)

### 2. Push to GitHub

```bash
cd blue-is-the-clue
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

### 3. Deploy on Vercel

1. https://vercel.com → **Add New...** → **Project** → import your repo
2. Before deploying, add **four** environment variables (Settings → Environment Variables, or during import):
   - `ANTHROPIC_API_KEY`
   - `TERADATA_HOST`
   - `TERADATA_USER`
   - `TERADATA_PASSWORD`
3. Deploy

If the build fails specifically on installing `teradatasql`, that confirms the native-binding problem described above — see the fallback plan below.

### 4. Use your permanent production URL

Always use your main `your-project.vercel.app` URL, not intermediate deployment-specific preview links.

---

## What's inside

- `src/App.jsx` — the whole UI: sidebar with chat sessions (saved to `localStorage`), the chat itself, file upload, and chart rendering (via `recharts`)
- `api/chat.js` — the backend. Holds all secrets server-side, and runs an **agent loop**: it asks Claude for a reply, and if Claude wants to run a SQL query, this function executes it against Teradata Vantage and feeds the result back to Claude, repeating until Claude has a final answer
- `package.json` — includes `teradatasql` (Teradata's Node.js driver), `papaparse` (CSV parsing), `recharts` (charts)

## How it behaves

- **Free-form chat** — not restricted to one topic
- **Live data queries** — Claude decides when it needs real data and calls a `query_teradata` tool; only `SELECT` statements are allowed (the backend blocks anything that looks like it modifies data, as a safety net — but treat this as a basic guard, not a full security boundary, since you should also make sure the Teradata user account itself only has read permissions)
- **File analysis** — attach a `.csv` via the paperclip icon; it's parsed in your browser and a sample is sent to Claude along with your question
- **Charts** — when Claude decides a chart would help, it emits a small JSON spec that gets rendered as an actual bar/line/pie chart, not just described in text
- **Sidebar sessions** — each "New chat" starts a fresh session; all sessions persist in your browser's `localStorage`, so they survive closing/reopening (but are local to that one browser)
- **Query transparency** — any SQL Claude actually runs is shown in a small console-style card under its reply, so you can verify what it did

## Fallback plan if the Teradata driver doesn't work on Vercel

If `query_teradata` consistently fails (check Vercel's function logs for the real error first):

1. **Confirm it's really the driver and not credentials/network** — a wrong password or an unreachable host will fail immediately with a clear auth/connection error; a native-binding problem tends to fail before it even attempts to connect, often with an error mentioning `ffi-napi`, a missing `.node` file, or an install-time build failure.
2. **Move just the Teradata piece to a small always-on backend** instead of Vercel's serverless functions — options like Render, Railway, or Fly.io run a persistent Node (or Python) process rather than a cold-started function, which tends to be far more forgiving of native dependencies. You'd deploy a tiny Express server there exposing one endpoint (e.g. `/query`), and point `api/chat.js` at that URL instead of importing `teradatasql` directly.
3. **Or switch the query execution to Python**, using Teradata's mature, well-tested `teradatasql` Python package, hosted as its own small service (e.g. a Python Flask app), and have the Node backend call that service.

Any of these keeps the rest of the app (frontend, Claude chat, charts, file upload) completely unchanged — only the one function that runs SQL against Teradata would move.

## Local testing

```bash
npm install
npm install -g vercel
vercel dev
```
Set the four environment variables in `.env.local` first (see `vercel dev`'s prompts, or create the file manually).

## Notes

- Every message costs a small amount of real Anthropic API credit.
- The `query_teradata` tool is restricted to `SELECT` statements at the application level, but real safety should also come from using a read-only database user for `TERADATA_USER`.
- Chat sessions are stored per-browser (`localStorage`), not shared across devices.
