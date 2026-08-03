# Blue is the Clue

A conversational medical case-file assistant. It chats naturally, answers medical questions from an embedded dataset, and falls back to a live web search when the dataset doesn't have the answer — with a thumbs up/down flow to add good web answers back into the case file for that session.

---

## Full setup, start to finish

### 1. Get an Anthropic API key

1. Go to https://console.anthropic.com and sign in (or create an account — separate from claude.ai)
2. Left sidebar → **API Keys** → **Create Key** → copy it somewhere safe (shown only once)
3. Left sidebar → **Plans & Billing** → **Add funds** (even $5-10 is plenty to test with; usage is billed per token)

### 2. Push this project to GitHub

```bash
cd blue-is-the-clue
git init
git add .
git commit -m "initial commit"
git branch -M main
```

Create a new empty repo at https://github.com/new, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

If prompted for a password and your regular GitHub password doesn't work, GitHub requires a **Personal Access Token** instead:
- https://github.com/settings/tokens → **Generate new token (classic)** → check the **repo** scope → generate → copy it
- Use your GitHub username as the username, and paste the token as the password when `git push` asks

### 3. Deploy on Vercel

1. Go to https://vercel.com → sign in with GitHub
2. **Add New...** → **Project** → import the repo you just pushed
3. Before clicking Deploy, expand **Environment Variables** and add:
   - **Name:** `ANTHROPIC_API_KEY` (type this manually — don't paste the word "Name:" along with it)
   - **Value:** your real API key from step 1
   - Make sure **Production** is checked
4. Click **Deploy**

You'll get a live URL like `your-project.vercel.app` — **always use this exact URL** going forward, not any preview/deployment-specific URL Vercel shows during intermediate builds (those are frozen snapshots and won't reflect future updates).

### 4. Making future changes

Whenever you update code locally:

```bash
git add .
git commit -m "describe what changed"
git push
```

Vercel auto-redeploys on every push to `main`. Check the **Deployments** tab in Vercel — the newest one should show your commit message and a green **Ready** badge within 30-90 seconds. If it shows red/**Error**, click in to see the build log.

---

## What's inside

- `src/BlueIsTheClue.jsx` — the app UI (React). The medical dataset (451 sample Q&A rows) is embedded directly in this file.
- `api/chat.js` — a Vercel serverless function that holds your API key server-side and talks to Claude via [LangChain's `ChatAnthropic`](https://js.langchain.com/) wrapper (`@langchain/anthropic` + `@langchain/core`). The browser never sees your key.
- `package.json` — dependencies, including the LangChain packages.

## How it behaves

- Casual messages (greetings, thanks, small talk) get a plain, warm conversational reply — no case-file formatting.
- Medical questions get checked against the embedded case-file dataset. A match shows a "MATCHED IN FILE" stamp with the source record(s). No match shows "UNSOLVED" with a 👍/👎 prompt.
- 👎 triggers a real web search (via Claude) for an answer.
- Liking the web answer ("File it in the case") adds it to the in-memory dataset for the rest of that browser session (resets on page reload — this is intentional, not a bug).

## Local testing (optional)

```bash
npm install
cp .env.example .env.local
# paste your real key into .env.local
npm install -g vercel   # once, globally
vercel dev
```

Plain `npm run dev` (just Vite) will **not** work fully on its own since it skips the `/api/chat` function — always use `vercel dev` for local testing.

## Notes

- The dataset is a 451-row sample (out of ~16,400 originally) to keep the app lightweight. Some real questions may come back "unsolved" even if the full dataset would have the answer.
- This app is for informational purposes only and is not medical advice.
- Once live, anyone with the URL can use it and each message costs a small amount of API credit — consider adding a password gate or rate limit if you plan to share the link widely.
