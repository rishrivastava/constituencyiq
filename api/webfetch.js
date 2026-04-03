const { verifyToken, callClaude, setCors } = require('./_helpers');
const axios = require('axios');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await verifyToken(req);
    const { url, label } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    var proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(url);
    var response = await axios.get(proxyUrl, { timeout: 10000 });

    if (!response.data.contents) throw new Error('Could not fetch page');

    var text = response.data.contents
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 6000);

    if (text.length < 80) throw new Error('Page too small or blocked');

    var summary = await callClaude(
      'Political intelligence analyst. Summarise this content in 120 words focusing on: election data, voter demographics, political issues, constituency intelligence, development gaps.',
      'URL: ' + url + '\nLabel: ' + (label || 'Source') + '\nContent: ' + text.substring(0, 4000),
      [], 400
    );

    res.json({
      success: true,
      label: label || url,
      url: url,
      summary: summary,
      wordCount: text.split(' ').length,
      text: text.substring(0, 3000)
    });

  } catch (err) {
    console.error('Webfetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
};