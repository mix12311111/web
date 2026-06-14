const GEMINI_API_KEY = 'YOUR_API_KEY_HERE'; 
const LIST_MODELS_URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

fetch(LIST_MODELS_URL)
.then(async response => {
  if (!response.ok) {
    const err = await response.json();
    console.error('API Error:', JSON.stringify(err, null, 2));
  } else {
    const data = await response.json();
    console.log('Success:', JSON.stringify(data.models.map(m => m.name), null, 2));
  }
})
.catch(err => console.error('Fetch error:', err));
