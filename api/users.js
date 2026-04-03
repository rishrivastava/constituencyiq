const { verifyToken, db, admin, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyToken(req);
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin can create users' });
    }

    const { email, password, role, candidateId, name, ward, constituency } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password and role required' });
    }

    var userRecord = await admin.auth().createUser({ email: email, password: password });

    await db.collection('users').doc(userRecord.uid).set({
      name: name || email,
      email: email,
      role: role,
      candidate_id: candidateId || user.candidateId,
      ward: ward || null,
      constituency: constituency || 'Lucknow West',
      createdBy: user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      uid: userRecord.uid,
      message: 'User ' + email + ' created with role: ' + role
    });

  } catch (err) {
    console.error('Users error:', err.message);
    res.status(500).json({ error: err.message });
  }
};