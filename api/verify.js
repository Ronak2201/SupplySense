/**
 * Vercel Serverless Function: POST /api/verify
 * Orchestrates Live TinyFish Search API (https://api.search.tinyfish.ai)
 * and Live TinyFish Fetch API (https://api.fetch.tinyfish.ai) in parallel.
 */
const DEFAULT_TINYFISH_KEY = process.env.TINYFISH_API_KEY || 'sk-tinyfish-wKZbdxm3MGiFAxMa3V5UfCPwm57b1Jnu';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const query = (body.query || body.prompt || '').trim();
  const location = body.location || 'IN';
  const purpose = (body.purpose || `Find and verify product specifications and price for ${query}`).slice(0, 500);

  if (!query) {
    return res.status(400).json({ error: 'Missing required query parameter.' });
  }

  try {
    const searchParams = new URLSearchParams({
      query,
      location,
      language: 'en',
      purpose,
    });

    const searchRes = await fetch(`https://api.search.tinyfish.ai?${searchParams.toString()}`, {
      method: 'GET',
      headers: {
        'X-API-Key': DEFAULT_TINYFISH_KEY,
        Accept: 'application/json',
      },
    });

    if (!searchRes.ok) {
      return res.status(searchRes.status).json({
        error: `TinyFish Search API returned ${searchRes.status}`,
      });
    }

    const searchData = await searchRes.json();
    const searchResults = Array.isArray(searchData.results) ? searchData.results.slice(0, 6) : [];
    const topUrls = searchResults.slice(0, 4).map((r) => r.url).filter(Boolean);

    const fetchedMap = {};
    if (topUrls.length > 0) {
      try {
        const fetchRes = await fetch('https://api.fetch.tinyfish.ai', {
          method: 'POST',
          headers: {
            'X-API-Key': DEFAULT_TINYFISH_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            urls: topUrls,
            format: 'markdown',
            links: false,
            purpose: `Extract exact selling price, GST/tax inclusion, stock availability, and technical specification table for ${query}`,
          }),
        });
        if (fetchRes.ok) {
          const fetchData = await fetchRes.json();
          for (const item of (fetchData.results || [])) {
            fetchedMap[item.url] = item;
            if (item.final_url) fetchedMap[item.final_url] = item;
          }
        }
      } catch {
        // Non-fatal if Fetch times out on a slow supplier page; search snippets still verify
      }
    }

    return res.status(200).json({
      query,
      searchResults,
      fetchedMap,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal verification error',
    });
  }
}
