// api/chat.js
module.exports = async (req, res) => {
  // Bật CORS cho local development và tích hợp
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { history } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key is not configured in environment variables.' });
  }

  const SYSTEM_PROMPT =
    'Bạn là trợ lý thông minh của một trang báo điện tử Việt Nam. ' +
    'Hãy trả lời ngắn gọn, súc tích, thân thiện và bằng tiếng Việt. ' +
    'Nếu được hỏi về tin tức, hãy đưa ra phân tích khách quan. ' +
    'Giới hạn mỗi câu trả lời dưới 200 từ.';

  const requestBody = {
    contents: history,
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 512,
    },
  };

  try {
    const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errData?.error?.message || 'Gemini API Error' });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Tôi chưa có câu trả lời phù hợp cho điều này.';
    return res.status(200).json({ text: text.trim() });
  } catch (error) {
    console.error('Gemini API request failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
};
