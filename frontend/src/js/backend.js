import { BACKEND_URL } from './constants.js';

export async function matchOnServer(embedding, topK = 1, threshold = 0.75) {
  const res = await fetch(`${BACKEND_URL}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embedding, top_k: topK, threshold })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Match failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.matches || [];
}
