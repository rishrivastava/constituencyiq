const { verifyToken, callClaude, db, admin, setCors } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res); // ALWAYS first

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyToken(req);
    const { message, history, constituencyData, knowledgeBase } = req.body;

    if (!message) return res.status(400).json({ error: 'Message required' });

    const kb = knowledgeBase && knowledgeBase.length
      ? '\n\nKNOWLEDGE BASE:\n' + knowledgeBase.map(k => '[' + (k.label || k.name || '') + ']: ' + (k.summary || '')).join('\n\n')
      : '';

    const data = constituencyData && constituencyData.length
      ? '\n\nSURVEY DATA: ' + constituencyData.length + ' records. Sample: ' + JSON.stringify(constituencyData.slice(0, 5))
      : '';

    const system =
      'You are ConstituencyIQ, expert AI political analyst for Indian elections.\n' +
      'User role: ' + user.role + '.\n' +
      'LUCKNOW WEST: 3.9 lakh electors. 2022: Armaan Khan (SP) won 48.19%, margin 8184 over BJP 45.03%.\n' +
      'Muslim ~35%, OBC Hindu ~30%, Brahmin/Kayastha ~20%, SC ~12%.\n' +
      'Key issues: waterlogging Rajajipuram, vendors Alambagh, unemployment Naka Hindola, healthcare Sadar.\n' +
      'History: BJP won 7 times since 1977, SP won 2012 and 2022.\n' +
      kb + data + '\n' +
      'Respond conversationally. Mix Hindi/Hinglish naturally. Be specific and data-backed. 2-4 paragraphs.';

    const reply = await callClaude(system, message, history || []);

    if (!user.isDemo && user.candidateId && db) {
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
};
