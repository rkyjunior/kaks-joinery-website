// KAK'S Joinery website — contact form proxy.
//
// The public website's browser code calls THIS endpoint, same-origin, with no secret
// attached. This function holds the CMS webhook's token server-side (as a Vercel
// environment variable) and forwards the request on — so the token is never visible
// to anyone viewing the website's source, unlike a direct browser -> CMS webhook call
// would be.
//
// Required Vercel environment variables for this project:
//   CMS_WEBHOOK_URL    e.g. https://kaks-joinery-cms-eight.vercel.app/api/webhook-lead
//   CMS_WEBHOOK_TOKEN  the same secret already configured on the CMS's webhook-lead.js

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', message: "KAK'S Joinery website contact endpoint is live." });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const webhookUrl = process.env.CMS_WEBHOOK_URL;
  const token = process.env.CMS_WEBHOOK_TOKEN;
  if (!webhookUrl || !token) {
    res.status(500).json({ error: 'Server is not configured yet. Set CMS_WEBHOOK_URL and CMS_WEBHOOK_TOKEN in this project\u2019s Vercel environment variables.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const name = (body.name || '').toString().trim().slice(0, 200);
  const phone = (body.phone || '').toString().trim().slice(0, 60);
  const whatsapp = (body.whatsapp || '').toString().trim().slice(0, 60);
  const email = (body.email || '').toString().trim().slice(0, 200);
  const message = (body.message || '').toString().trim().slice(0, 2000);

  if (!name) { res.status(400).json({ error: 'Name is required.' }); return; }
  if (!phone) { res.status(400).json({ error: 'Phone is required.' }); return; }

  try {
    const url = webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, whatsapp, email, channel: 'website', message })
    });
    const rawText = await upstream.text();
    let data = {};
    try { data = JSON.parse(rawText); } catch (e) {}
    if (!upstream.ok) {
      // TEMPORARY DIAGNOSTICS — remove the "debug" block once this is working.
      // Shows exactly what was sent and what came back, without exposing the full secret.
      res.status(upstream.status).json({
        error: (data && data.error) || 'The CMS did not accept this lead.',
        debug: {
          urlCalled: webhookUrl,
          tokenLength: token.length,
          tokenPreview: token.length > 6 ? (token.slice(0,3) + '...' + token.slice(-3)) : '(very short — check this)',
          cmsStatus: upstream.status,
          cmsRawResponse: rawText.slice(0, 500)
        }
      });
      return;
    }
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the CMS right now. Please try again shortly.', debug: { exceptionMessage: e && e.message } });
  }
};
