const { verifyToken, db, admin, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res); // ALWAYS first

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const user = await verifyToken(req);

    // Demo mode — simulate success without hitting Firestore
    if (user.isDemo) {
      if (req.method === 'POST') return res.json({ success: true, saved: (req.body.voters || []).length });
      if (req.method === 'GET') return res.json({ voters: [], total: 0, message: 'Demo mode' });
    }

    if (!user.candidateId) return res.status(400).json({ error: 'No candidate assigned' });

    if (req.method === 'POST') {
      const { voters } = req.body;
      if (!voters || !voters.length) return res.status(400).json({ error: 'No voter data' });

      const batch = db.batch();
      voters.forEach(voter => {
        const ref = db.collection('voters')
          .doc(user.candidateId)
          .collection('records')
          .doc();
        batch.set(ref, Object.assign({}, voter, {
          savedBy: user.uid,
          savedByRole: user.role,
          savedAt: admin.firestore.FieldValue.serverTimestamp()
        }));
      });
      await batch.commit();
      return res.json({ success: true, saved: voters.length });
    }

    if (req.method === 'GET') {
      const snapshot = await db.collection('voters')
        .doc(user.candidateId)
        .collection('records')
        .limit(500)
        .get();

      const voters = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (user.role === 'field_worker') {
          if (data.Ward === user.ward || data.ward === user.ward) {
            voters.push({ Ward: data.Ward, Area: data.Area, Problem: data.Problem });
          }
        } else {
          voters.push(Object.assign({ id: doc.id }, data));
        }
      });
      return res.json({ voters: voters, total: voters.length });
    }

    res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Voters error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
