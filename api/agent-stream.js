/**
 * Vercel Serverless Function: POST /api/agent-stream
 * Streams real-time TinyFish Browser Agent events (`STARTED`, `STREAMING_URL`, `PROGRESS`, `COMPLETE`)
 * from `https://agent.tinyfish.ai/v1/automation/run-sse` to the client over Server-Sent Events.
 */
const DEFAULT_TINYFISH_KEY = process.env.TINYFISH_API_KEY || 'sk-tinyfish-wKZbdxm3MGiFAxMa3V5UfCPwm57b1Jnu';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const targetUrl = body.url;
  const goal = body.goal || 'Extract product name, price, stock status, and technical specifications as JSON.';

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing required url parameter.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  try {
    const upstream = await fetch('https://agent.tinyfish.ai/v1/automation/run-sse', {
      method: 'POST',
      headers: {
        'X-API-Key': DEFAULT_TINYFISH_KEY,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        url: targetUrl,
        goal,
        browser_profile: body.browser_profile || 'lite',
      }),
    });

    if (!upstream.ok || !upstream.body) {
      res.write(`data: ${JSON.stringify({ type: 'ERROR', status: upstream.status, message: 'Upstream TinyFish Agent error' })}

`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) })}

`);
    res.end();
  }
}
