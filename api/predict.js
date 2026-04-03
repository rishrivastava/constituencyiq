const { verifyToken, callClaude, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyToken(req);
    const { candidateName, party, voterData, constituency } = req.body;
    if (!candidateName) return res.status(400).json({ error: 'Candidate name required' });

    var prediction = await callClaude(
      'Expert Indian political strategist for ' + (constituency || 'Lucknow West') + '. Give specific vote share percentages. Be bold and precise.',
      'Predict for ' + candidateName + ' (' + (party || 'Independent') + ').\n\nFormat in 5 sections:\n1. VOTE SHARE: specific % range\n2. COMMUNITY BREAKDOWN: Muslim/OBC/Brahmin/SC split\n3. WARD ANALYSIS: which wards win/lose and why\n4. SWING FACTORS: top 3 decisive factors\n5. WINNING STRATEGY: 5 concrete steps by priority\n\nData: ' + (voterData ? JSON.stringify(voterData.slice(0, 10)) : 'Use Lucknow West intelligence'),
      [], 1200
    );

    res.json({ prediction: prediction });

  } catch (err) {
    console.error('Predict error:', err.message);
    res.status(err.message.includes('token') ? 401 : 500).json({ error: err.message });
  }
};