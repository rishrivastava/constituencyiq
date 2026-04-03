const { verifyToken, db, admin, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = await verifyToken(req);
    if (!user.candidateId) return res.status(400).json({ error: 'No candidate assigned' });

    if (req.method === 'POST') {
      const { voters } = req.body;
      if (!voters || !voters.length) return res.status(400).json({ error: 'No voter data' });

      var batch = db.batch();
      voters.forEach(function(voter) {
        var ref = db.collection('voters')
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
      var snapshot = await db.collection('voters')
        .doc(user.candidateId)
        .collection('records')
        .limit(500)
        .get();

      var voters = [];
      snapshot.forEach(function(doc) {
        var data = doc.data();
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
    res.status(err.message.includes('token') ? 401 : 500).json({ error: err.message });
  }
};