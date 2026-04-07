const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function verifyToken(req) {
  const authHeader = req.headers.authorization;
  // Allow demo/guest mode — no token required
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { uid: 'demo', email: 'demo@ciq', role: 'candidate', candidateId: 'demo', ward: null };
  }
  const token = authHeader.split('Bearer ')[1];
  // Handle demo token from frontend
  if (token === 'demo-mode') {
    return { uid: 'demo', email: 'demo@ciq', role: 'candidate', candidateId: 'demo', ward: null };
  }
  const decoded = await admin.auth().verifyIdToken(token);
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await admin.auth().verifyIdToken(token);
  const userDoc = await db.collection('users').doc(decoded.uid).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  return {
    uid: decoded.uid,
    email: decoded.email,
    role: userData.role || 'viewer',
    candidateId: userData.candidate_id || null,
    ward: userData.ward || null
  };
}

async function callClaude(system, message, history, maxTokens) {
  history = history || [];
  maxTokens = maxTokens || 1000;
  const axios = require('axios');
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: system,
      messages: history.concat([{ role: 'user', content: message }])
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      }
    }
  );
  return response.data.content[0].text;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

module.exports = { admin, db, verifyToken, callClaude, setCors };
