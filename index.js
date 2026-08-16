import 'dotenv/config';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY belum di-set. Isi di file .env (lihat .env.example).');
  process.exit(1);
}

async function callGroq(message) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: message }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error();
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

const testMessage = 'Balas dengan satu kalimat: kamu jalan dari mana?';

console.log();
try {
  const reply = await callGroq(testMessage);
  console.log();
} catch (err) {
  console.error('Gagal manggil Groq:', err.message);
  process.exit(1);
}
