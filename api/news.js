// api/news.js
module.exports = async (req, res) => {
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

  const { category = 'general', q = '' } = req.query;
  const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

  if (!GNEWS_API_KEY) {
    return res.status(500).json({ error: 'GNews API key is not configured in environment variables.' });
  }

  const PAGE_SIZE = 10;
  const baseUrl = 'https://gnews.io/api/v4';
  let url;

  if (q) {
    url = `${baseUrl}/search?q=${encodeURIComponent(q)}&lang=vi&country=vn&max=${PAGE_SIZE}&apikey=${GNEWS_API_KEY}`;
  } else if (category === 'general') {
    url = `${baseUrl}/top-headlines?lang=vi&country=vn&max=${PAGE_SIZE}&apikey=${GNEWS_API_KEY}`;
  } else {
    url = `${baseUrl}/top-headlines?category=${category}&lang=en&max=${PAGE_SIZE}&apikey=${GNEWS_API_KEY}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: `GNews API error: ${response.status}` });
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('GNews Proxy request failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
};
