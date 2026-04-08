const { verifyToken, callClaude, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res); // ALWAYS first

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyToken(req);
    const { voterData, constituency } = req.body;

    const ctx = voterData && voterData.length
      ? 'Survey data (' + voterData.length + ' records): ' + JSON.stringify(voterData.slice(0, 8))
      : 'Use Lucknow West constituency intelligence.';

    const actions = await callClaude(
      'You are an expert Indian political strategist for ' + (constituency || 'Lucknow West') + '. Generate hyperlocal, specific, data-backed micro-actions ranked by vote impact. Each action must name a specific ward or mohalla in Lucknow West.',
      'Generate exactly 5 micro-actions. Format each exactly as:\nACTION 1: [short title]\nArea: [specific ward/mohalla]\nTarget: [specific community]\nWhat: [exactly what to do]\nWhy: [data-backed reason]\nVotes: [HIGH/MEDIUM + rough number]\n\n' + ctx,
      [], 1200
    );

    res.json({ actions: actions });

  } catch (err) {
    console.error('Actions error:', err.message);
    res.status(500).json({ error: 'Action plan failed: ' + err.message });
  }
};
