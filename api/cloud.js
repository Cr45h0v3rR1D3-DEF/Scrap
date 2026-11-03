// Scrapline cloud saves for the website (a Vercel serverless function).
// Saved vehicles are kept under a save code in a Redis database: add one in your Vercel project
// (Storage > Create Database > Upstash for Redis, then connect it to this project). That gives this function
// KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN); nothing else to set up.
//   GET  /api/cloud?ping=1          -> { ok: true } when a database is connected
//   GET  /api/cloud?code=<code>     -> { state } (404 when nothing is saved under that code yet)
//   POST /api/cloud { code, state } -> { ok: true }
const zlib = require('zlib');
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX = 4 * 1024 * 1024;   // the most a save can hold, before packing (about 200 big vehicles)

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('database ' + r.status);
  return (await r.json()).result;
}
// codes are words and digits; the key is a hash of it, so the database never holds the code itself
const codeOk = c => typeof c === 'string' && /^[a-z0-9]+(-[a-z0-9]+){2,7}$/.test(c) && c.length <= 60;
const keyOf = c => 'scrapline:' + crypto.createHash('sha256').update(c).digest('hex');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && req.query.ping) return res.status(200).json({ ok: !!(URL_ && TOKEN) });
    if (!URL_ || !TOKEN) return res.status(503).json({ error: 'cloud saves are not set up on this site' });
    if (req.method === 'GET') {
      const code = String(req.query.code || '');
      if (!codeOk(code)) return res.status(400).json({ error: 'bad code' });
      const v = await redis(['GET', keyOf(code)]);
      if (!v) return res.status(404).json({ error: 'nothing saved under that code yet' });
      const state = JSON.parse(zlib.inflateSync(Buffer.from(v, 'base64')).toString('utf8'));
      return res.status(200).json({ state });
    }
    if (req.method === 'POST') {
      let body = req.body; if (typeof body === 'string') body = JSON.parse(body);
      const code = body && body.code, state = body && body.state;
      if (!codeOk(code)) return res.status(400).json({ error: 'bad code' });
      if (!state || !Array.isArray(state.saves)) return res.status(400).json({ error: 'bad save' });
      const json = JSON.stringify(state);
      if (json.length > MAX) return res.status(413).json({ error: 'too many vehicles to keep in one save' });
      // kept for a year after the last change
      await redis(['SET', keyOf(code), zlib.deflateSync(Buffer.from(json, 'utf8')).toString('base64'), 'EX', String(365 * 24 * 3600)]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET or POST' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
