const admin = require('firebase-admin');
const axios = require('axios');

// ====== FIREBASE SETUP ======
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY || '{}');
  if (Object.keys(serviceAccount).length > 0) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
}

const db = admin.firestore ? admin.firestore() : null;

// ====== CORS SETUP ======
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ====== TOKEN VERIFICATION WITH DEMO FALLBACK ======
async function verifyToken(req) {
  const authHeader = req.headers.authorization;

  // No token at all → demo mode
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { uid: 'demo', email: 'demo@constituencyiq.local', role: 'admin', candidateId: 'demo_lucknow_west', ward: null, isDemo: true };
  }

  const token = authHeader.split('Bearer ')[1];

  // Explicit demo token → demo mode
  if (!token || token === 'demo' || token === 'demo-mode') {
    return { uid: 'demo', email: 'demo@constituencyiq.local', role: 'admin', candidateId: 'demo_lucknow_west', ward: null, isDemo: true };
  }

  // Try Firebase verification → fallback to demo if anything fails
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    return {
      uid: decoded.uid,
      email: decoded.email,
      role: userData.role || 'viewer',
      candidateId: userData.candidate_id || null,
      ward: userData.ward || null,
      isDemo: false
    };
  } catch (err) {
    console.log('Token verify failed, using demo:', err.message);
    return { uid: 'demo', email: 'demo@constituencyiq.local', role: 'admin', candidateId: 'demo_lucknow_west', ward: null, isDemo: true };
  }
}

// ====== CALL CLAUDE ======
async function callClaude(system, message, history = [], maxTokens = 1000) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: system,
      messages: [...(history || []), { role: 'user', content: message }]
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

module.exports = { admin, db, setCors, verifyToken, callClaude };
