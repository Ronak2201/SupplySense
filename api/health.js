export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'SupplySense AI Procurement & TinyFish Verification API',
    tinyfishConfigured: Boolean(process.env.TINYFISH_API_KEY || 'sk-tinyfish-wKZbdxm3MGiFAxMa3V5UfCPwm57b1Jnu'),
    timestamp: new Date().toISOString(),
  });
}
