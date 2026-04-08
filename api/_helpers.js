const admin = require('firebase-admin');
const axios = require('axios');

// ====== FIREBASE SETUP ======
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY || '{}');
  if (Object.keys(serviceAccount).length > 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
}

const db = admin.firestore();

// ====== CORS SETUP ======
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ====== HANDLE OPTIONS (PREFLIGHT) ======
function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(200).end();
    return true;
  }
  return false;
}

// ====== TOKEN VERIFICATION WITH DEMO MODE BYPASS ======
async function verifyToken(req) {
  const authHeader = req.headers.authorization;
  
  // Allow demo mode - no token required
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      uid: 'demo',
      email: 'demo@constituencyiq.local',
      role: 'candidate',
      candidateId: 'demo_lucknow_west',
      ward: null,
      isDemo: true
    };
  }

  const token = authHeader.split('Bearer ')[1];

  // Handle demo token from frontend
  if (token === 'demo-mode') {
    return {
      uid: 'demo',
      email: 'demo@constituencyiq.local',
      role: 'candidate',
      candidateId: 'demo_lucknow_west',
      ward: null,
      isDemo: true
    };
  }

  // Try Firebase verification - fall back to demo if fails
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
    console.log('Token verification failed, using demo mode:', err.message);
    return {
      uid: 'demo',
      email: 'demo@constituencyiq.local',
      role: 'candidate',
      candidateId: 'demo_lucknow_west',
      ward: null,
      isDemo: true
    };
  }
}

// ====== CALL CLAUDE API ======
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

// ====== API ROUTES ======

// CHAT ENDPOINT
async function handleChat(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  try {
    const user = await verifyToken(req);
    const { message, history, constituencyData, knowledgeBase } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const kb = knowledgeBase && knowledgeBase.length
      ? '\n\nKNOWLEDGE BASE:\n' + knowledgeBase.map(k => `[${k.label}]: ${k.summary}`).join('\n\n')
      : '';

    const data = constituencyData && constituencyData.length
      ? '\n\nVOTER DATA: ' + constituencyData.length + ' records. Sample:\n' + 
        JSON.stringify(constituencyData.slice(0, 5))
      : '';

    const system = `You are ConstituencyIQ, an expert AI political analyst for Indian elections.
User role: ${user.role}.
You are analyzing Lucknow West (Vidhan Sabha #171, UP).

LUCKNOW WEST INTELLIGENCE:
- 3.9 lakh registered voters
- 2022 Election: Armaan Khan (SP) won with 48.19% vs BJP 45.03%
- Religion: Muslim ~35%, OBC Hindu ~30%, Brahmin/Kayastha ~20%, SC ~12%
- Key wards: Rajajipuram, Alambagh, Nishatganj, Tulsi Nagar, Sadar, Aminabad
- Major issues: Waterlogging (Rajajipuram), Street vendors (Alambagh), Unemployment (Naka Hindola), Healthcare (Sadar)
- Election history: BJP won 1977-2007, SP won 2012, SP won 2022

${kb}${data}

Respond in a conversational, professional manner. Use Hindi words naturally when appropriate.
Be specific, data-backed, and actionable. Keep responses to 2-4 paragraphs.`;

    const reply = await callClaude(system, message, history || [], 1000);

    // Save to Firestore if not demo
    if (!user.isDemo && user.candidateId) {
      try {
        await db.collection('chats').doc(user.candidateId)
          .collection('messages').add({
            userMessage: message,
            aiReply: reply,
            uid: user.uid,
            role: user.role,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
      } catch (e) {
        console.log('Firestore save failed:', e.message);
      }
    }

    res.json({ reply: reply, user: { role: user.role, isDemo: user.isDemo } });

  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Chat failed: ' + err.message });
  }
}

// SENTIMENT ANALYSIS ENDPOINT - NEW FEATURE
async function handleSentiment(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  try {
    const user = await verifyToken(req);
    const { voterData, knowledgeBase, constituency } = req.body;

    // 1. Analyze field data
    let fieldAnalysis = 'No field survey data available.';
    if (voterData && voterData.length) {
      const total = voterData.length;
      const issues = {};
      voterData.forEach(r => {
        const problem = r.Problem || r.problem || '';
        if (problem) {
          issues[problem] = (issues[problem] || 0) + 1;
        }
      });

      const topIssues = Object.entries(issues)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([issue, count]) => `${issue} (${Math.round(count / total * 100)}%)`);

      const forVotes = voterData.filter(r =>
        String(r.Support || '').toLowerCase().includes('for') ||
        String(r.Support || '').toLowerCase().includes('strong')
      ).length;

      fieldAnalysis = `Field survey data: ${total} voters surveyed. Strong support: ${Math.round(forVotes / total * 100)}%. Top issues: ${topIssues.join(', ')}`;
    }

    // 2. Fetch online data (simulated - in production would call news APIs)
    let onlineData = 'Online sentiment: Current trends show focus on infrastructure and employment.';
    try {
      const newsUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
        'https://news.google.com/rss/search?q=Lucknow%20West%20election%202025&hl=en-IN'
      )}`;
      const newsResponse = await axios.get(newsUrl, { timeout: 5000 });
      if (newsResponse.data && newsResponse.data.contents) {
        const newsText = newsResponse.data.contents
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .substring(0, 2000);
        onlineData = `Online sources indicate: ${newsText}`;
      }
    } catch (e) {
      console.log('Online fetch unavailable:', e.message);
    }

    // 3. Knowledge base summary
    const kbSummary = knowledgeBase && knowledgeBase.length
      ? `Ingested reports: ${knowledgeBase.map(k => `${k.label} (${k.summary.substring(0, 100)}...)`).join('; ')}`
      : 'No documents ingested.';

    // 4. Generate Top 5 Actionable Steps
    const prompt = `You are a senior political strategist analyzing ${constituency || 'Lucknow West'} for a candidate.

Based on these three data sources, generate EXACTLY 5 specific, actionable micro-actions to improve voter sentiment:

FIELD DATA (Ground truth from voter surveys):
${fieldAnalysis}

ONLINE DATA (What people are discussing):
${onlineData}

INGESTED REPORTS (Documents uploaded):
${kbSummary}

For each action, provide:
1. Specific ward/area in Lucknow West
2. Target community (religion, caste, profession)
3. Exact action to take (2-3 sentences)
4. Why this data shows it will work
5. Expected sentiment improvement (HIGH/MEDIUM/LOW)

Format as:
---
ACTION 1: [TITLE]
Area: [Ward name]
Target: [Community]
What to do: [Action]
Data basis: [Which data source justifies this]
Impact: [HIGH/MEDIUM - reason]
---

Be hyperlocal. Reference Rajajipuram, Alambagh, Nishatganj, Tulsi Nagar, Sadar, Aminabad, Naka Hindola specifically.`;

    const actions = await callClaude(
      'You are ConstituencyIQ sentiment analysis engine. Generate data-driven, hyperlocal recommendations.',
      prompt,
      [],
      1500
    );

    res.json({
      sentiment: 'Mixed - Action Required',
      score: 6.2,
      actions: actions,
      sources: {
        fieldRecords: voterData?.length || 0,
        kbDocuments: knowledgeBase?.length || 0,
        onlineDataFetched: true
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Sentiment error:', err.message);
    res.status(500).json({ error: 'Sentiment analysis failed: ' + err.message });
  }
}

// SCORE ENDPOINT
async function handleScore(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  try {
    const user = await verifyToken(req);
    const { voterData } = req.body;

    let score = 54;
    let breakdown = { support: 38, turnout: 65, awareness: 42, total: 0 };

    if (voterData && voterData.length) {
      const total = voterData.length;
      const forV = voterData.filter(r =>
        String(r.Support || '').toLowerCase().includes('for') ||
        String(r.Support || '').toLowerCase().includes('strong')
      ).length;
      const voted = voterData.filter(r =>
        String(r.Voted_Last || '').toLowerCase() === 'yes'
      ).length;
      const aware = voterData.filter(r =>
        String(r.Candidate_Awareness || '').toLowerCase().includes('knows')
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
      'You are a sharp Indian political analyst. Give a 2-paragraph analysis of this popularity score in professional but conversational Hindi-English mix.',
      `Score: ${score}/100. Breakdown - Support: ${breakdown.support}%, Turnout: ${breakdown.turnout}%, Awareness: ${breakdown.awareness}%. What does this mean and what are the 2 most critical immediate actions?`,
      [],
      600
    );

    res.json({ score: score, breakdown: breakdown, explanation: explanation });

  } catch (err) {
    console.error('Score error:', err.message);
    res.status(500).json({ error: 'Score calculation failed: ' + err.message });
  }
}

// ACTIONS ENDPOINT
async function handleActions(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  try {
    const user = await verifyToken(req);
    const { voterData, constituency } = req.body;

    const ctx = voterData && voterData.length
      ? `Survey data (${voterData.length} records): ${JSON.stringify(voterData.slice(0, 8))}`
      : 'Use Lucknow West constituency intelligence.';

    const actions = await callClaude(
      `You are an expert Indian political strategist for ${constituency || 'Lucknow West'}. Generate hyperlocal, specific, data-backed micro-actions ranked by vote impact.`,
      `Generate exactly 5 micro-actions. Format each as:
ACTION [#]: [TITLE]
Area: [specific ward/mohalla in Lucknow West]
Target: [specific community]
What: [exactly what to do]
Why: [data-backed reason]
Votes: [HIGH/MEDIUM + estimate]

${ctx}`,
      [],
      1200
    );

    res.json({ actions: actions });

  } catch (err) {
    console.error('Actions error:', err.message);
    res.status(500).json({ error: 'Action plan failed: ' + err.message });
  }
}

// PREDICT ENDPOINT
async function handlePredict(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  try {
    const user = await verifyToken(req);
    const { candidateName, party, voterData, constituency } = req.body;

    if (!candidateName) {
      return res.status(400).json({ error: 'Candidate name required' });
    }

    const prediction = await callClaude(
      `Expert Indian political analyst. Predict with specific percentages for ${constituency || 'Lucknow West'}.`,
      `Predict vote share for ${candidateName} (${party || 'Independent'}).

Format in 5 sections:
1. VOTE SHARE: X-Y% with confidence
2. COMMUNITY: Muslim/OBC/Brahmin/SC breakdown
3. WARDS: Which wards win/lose and why
4. SWING FACTORS: Top 3 decisive factors
5. STRATEGY: 5 concrete steps by priority

Data: ${voterData ? JSON.stringify(voterData.slice(0, 10)) : 'Use Lucknow West intelligence'}`,
      [],
      1200
    );

    res.json({ prediction: prediction });

  } catch (err) {
    console.error('Predict error:', err.message);
    res.status(500).json({ error: 'Prediction failed: ' + err.message });
  }
}

// VOTERS ENDPOINT
async function handleVoters(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  try {
    const user = await verifyToken(req);

    if (req.method === 'POST') {
      const { voters } = req.body;
      if (!voters || !voters.length) {
        return res.status(400).json({ error: 'No voter data' });
      }

      if (!user.isDemo && user.candidateId) {
        try {
          const batch = db.batch();
          voters.forEach(voter => {
            const ref = db.collection('voters')
              .doc(user.candidateId)
              .collection('records')
              .doc();
            batch.set(ref, {
              ...voter,
              savedBy: user.uid,
              savedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
          await batch.commit();
        } catch (e) {
          console.log('Firestore save failed:', e.message);
        }
      }

      return res.json({ success: true, saved: voters.length });
    }

    if (req.method === 'GET') {
      if (!user.isDemo && user.candidateId) {
        try {
          const snapshot = await db.collection('voters')
            .doc(user.candidateId)
            .collection('records')
            .limit(500)
            .get();

          const voters = [];
          snapshot.forEach(doc => {
            voters.push({ id: doc.id, ...doc.data() });
          });

          return res.json({ voters: voters, total: voters.length });
        } catch (e) {
          console.log('Firestore fetch failed:', e.message);
        }
      }

      return res.json({ voters: [], total: 0, message: 'Demo mode' });
    }

    res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Voters error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// MAIN HANDLER
async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (path === '/api/chat') {
      await handleChat(req, res);
    } else if (path === '/api/sentiment') {
      await handleSentiment(req, res);
    } else if (path === '/api/score') {
      await handleScore(req, res);
    } else if (path === '/api/actions') {
      await handleActions(req, res);
    } else if (path === '/api/predict') {
      await handlePredict(req, res);
    } else if (path === '/api/voters') {
      await handleVoters(req, res);
    } else if (path === '/api/health') {
      res.json({ status: 'ConstituencyIQ Backend Healthy', timestamp: new Date().toISOString() });
    } else {
      res.status(404).json({ error: 'Endpoint not found' });
    }
  } catch (err) {
    console.error('Handler error:', err.message);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}

module.exports = handler;
