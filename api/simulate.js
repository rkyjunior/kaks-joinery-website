// KAK'S Joinery website — AI Room Simulator proxy.
//
// Generic-furniture version: takes the customer's room photo plus a catalog item's
// category/wood/style (NOT a real product photo, since we don't have real photography
// yet), and asks the model to add furniture matching that description into the room.
// This is an interim version — once real product photos exist, this should be upgraded
// to a reference-image-capable model so it shows the ACTUAL piece, not a generic match.
//
// Required Vercel environment variable for this project:
//   REPLICATE_API_TOKEN   from your Replicate account (replicate.com/account/api-tokens)
//
// IMPORTANT — cost control: this endpoint calls a paid API on every request, on a public
// page with no login. Set a spending limit on your Replicate account (Billing settings) —
// that's the real safety net here, not anything this code can enforce on its own.

const MAX_BYTES = 8 * 1024 * 1024; // 8MB, matches the client-side resize target with headroom
const MODEL = 'black-forest-labs/flux-kontext-pro';

function buildPrompt(item) {
  const desc = [item.wood, item.style, item.name].filter(Boolean).join(' ');
  return 'Add a ' + desc + ' into this room photo, positioned naturally against a suitable wall or space, '
    + 'matched to the room\u2019s existing lighting, perspective, and scale. Keep the rest of the room unchanged. '
    + 'Photorealistic result.';
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', message: "KAK'S Joinery AI Room Simulator endpoint is live." });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server is not configured yet. Set REPLICATE_API_TOKEN in this project\u2019s Vercel environment variables.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const imageBase64 = (body.imageBase64 || '').toString();
  const imageType = (body.imageType || 'image/jpeg').toString();
  const itemName = (body.itemName || '').toString().slice(0, 200);
  const itemWood = (body.itemWood || '').toString().slice(0, 60);
  const itemStyle = (body.itemStyle || '').toString().slice(0, 60);

  if (!imageBase64) { res.status(400).json({ error: 'No room photo provided.' }); return; }
  if (!itemName) { res.status(400).json({ error: 'No catalog item selected.' }); return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageType)) {
    res.status(400).json({ error: 'Unsupported image type. Please upload a JPG, PNG, or WEBP.' });
    return;
  }

  const buffer = Buffer.from(imageBase64, 'base64');
  if (buffer.length > MAX_BYTES) {
    res.status(400).json({ error: 'Photo is too large. Please use a smaller image.' });
    return;
  }

  const prompt = buildPrompt({ name: itemName, wood: itemWood, style: itemStyle });
  const dataUri = 'data:' + imageType + ';base64,' + imageBase64;

  try {
    // Uses Replicate's HTTP API directly (rather than the `replicate` npm package) so this
    // function has zero dependencies to install. `Prefer: wait=" tells Replicate to hold the
    // request open until the prediction finishes, up to the given number of seconds, instead
    // of returning immediately with a "starting" status that would need separate polling.
    const createRes = await fetch('https://api.replicate.com/v1/models/' + MODEL + '/predictions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Prefer': 'wait=55'
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          input_image: dataUri,
          aspect_ratio: 'match_input_image',
          output_format: 'jpg',
          safety_tolerance: 2
        }
      })
    });

    let prediction = await createRes.json();
    if (!createRes.ok) {
      res.status(createRes.status).json({ error: (prediction && prediction.detail) || 'Replicate rejected the request.' });
      return;
    }

    // If it didn't finish within the wait window above, poll a few more times before giving up —
    // this only happens on unusually slow generations, and Vercel's own function time limit is
    // the real ceiling here (see maxDuration below).
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled' && attempts < 6) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(prediction.urls.get, { headers: { 'Authorization': 'Bearer ' + token } });
      prediction = await pollRes.json();
      attempts++;
    }

    if (prediction.status !== 'succeeded') {
      res.status(504).json({ error: 'The AI generation did not finish in time. Please try again.' });
      return;
    }

    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) { res.status(500).json({ error: 'No image was returned.' }); return; }

    res.status(200).json({ status: 'ok', imageUrl: outputUrl });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the image generation service right now. Please try again shortly.' });
  }
};
