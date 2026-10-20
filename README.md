# SupplySense — AI Procurement & TinyFish Real-Time Browser Verification Platform

> **Find anything. Verify everything. Buy with confidence.**

SupplySense finds products across trusted web suppliers, dispatches **TinyFish Parallel Browser Agents** (`run-sse`, `Search API`, `Fetch API`) in real time, verifies mandatory specifications and budget constraints deterministically, and classifies all options with transparent 0–100 trust scores and reasoning.

## 1. Deploy to Vercel in 1 Step (Production Ready)

This repository is pre-configured for **Vercel** with Serverless Functions (`/api/verify`, `/api/agent-stream`, `/api/health`) and `vercel.json`:

### Option A: Deploy via Vercel CLI
```bash
npm i -g vercel
vercel --prod
```

### Option B: Deploy via GitHub + Vercel Dashboard
1. Push this folder to a GitHub repository.
2. Import the repository at [vercel.com/new](https://vercel.com/new).
3. Add environment variable (already pre-configured in `.env` and serverless fallbacks):
   - `TINYFISH_API_KEY` = `sk-tinyfish-wKZbdxm3MGiFAxMa3V5UfCPwm57b1Jnu`
4. Click **Deploy**.

## 2. Local Development & Automated Tests

```bash
npm install
npm test
npm run dev
```

## 3. TinyFish API Endpoints Integrated
- **Web Agent SSE Streaming**: `POST https://agent.tinyfish.ai/v1/automation/run-sse` (via `/api/agent-stream` + live `streaming_url` browser embed)
- **Live Search API**: `GET https://api.search.tinyfish.ai` (via `/api/verify`)
- **Live Fetch API**: `POST https://api.fetch.tinyfish.ai` (via `/api/verify`)
