const { verifyToken, callClaude, db, admin, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res); // ALWAYS first

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyToken(req);
    const { voterData } = req.body;

    let score = 54;
    let breakdown = { support: 38, turnout: 65, awareness: 42, total: 0 };

    if (voterData && voterData.length) {
      const total = voterData.length;
      const forV = voterData.filter(r => {
        const s = String(r.Support || '').toLowerCase();
        return s.indexOf('for') >= 0 || s.indexOf('strong') >= 0;
      }).length;
      const voted = voterData.filter(r =>
        String(r.Voted_Last || '').toLowerCase() === 'yes'
      ).length;
      const aware = voterData.filter(r =>
        String(r.Candidate_Awareness || '').toLowerCase().indexOf('knows') >= 0
      ).length;

      score = Math.min(Math.max(
        Math.round((forV / total * 40) + (voted / total * 25) + (aware / total * 20) + 13),
        18), 94);

      breakdown = {
        support: Math.round(forV / total * 100),
        turnout: Math.round(voted / total * 100),
        awareness: Math.round(aware / total * 100),
        total: total
      };
    }

    const explanation = await callClaude(
      'You are a sharp Indian political analyst. Give a 2-paragraph plain-language analysis of this popularity score. Be specific, actionable, reference Lucknow West context.',
      'Score: ' + score + '/100. Breakdown: ' + JSON.stringify(breakdown) + '. What does this mean and what are the 2 most critical immediate actions?',
      [], 600
    );

    if (!user.isDemo && user.candidateId && db) {
      try {
        await db.collection('scores').doc(user.candidateId).set({
          score: score,
          breakdown: breakdown,
          calculatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.log('Firestore save failed:', e.message);
      }
    }

    res.json({ score: score, breakdown: breakdown, explanation: explanation });

  } catch (err) {
    console.error('Score error:', err.message);
    res.status(500).json({ error: 'Score failed: ' + err.message });
  }
};
