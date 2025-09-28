const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function requestGroq(prompt, apiKey) {
	const key = apiKey ?? import.meta.env.VITE_GROQ_API_KEY;
	if (!key) {
		return '';
	}
	const res = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({
			model: import.meta.env.VITE_GROQ_MODEL || 'llama-3.1-8b-instant',
			messages: [
				{ role: 'system', content: 'You are a highly efficient assistant for a notes app, capable of processing and summarizing content of any length. Always provide concise but meaningful responses.' },
				{ role: 'user', content: prompt },
			],
			temperature: 0.3,
			max_tokens: 1024,
		}),
	});
	if (!res.ok) return '';
	const data = await res.json();
	return data?.choices?.[0]?.message?.content ?? '';
}

export async function getInsightsFromGroq(html) {
	// Clean HTML tags and normalize whitespace, preserve meaningful text
	let clean = html
		.replace(/<br\s*\/?>/gi, '\n') // Convert <br> to newlines
		.replace(/<p[^>]*>/gi, '\n') // Convert <p> to newlines
		.replace(/<[^>]+>/g, '') // Remove other HTML tags
		.replace(/\s+/g, ' ') // Normalize whitespace
		.trim();

	// Truncate if extremely long while preserving meaning
	if (clean.length > 8000) {
		clean = clean.slice(0, 8000) + '...';
	}
	
	const prompt = `Analyze this text and provide insights in JSON format. Important rules:
1. Never modify or rewrite any words or terms from the original text
2. Keep ambiguous terms exactly as they appear (e.g., if "Dev" appears, don't expand it to "Developer")
3. For the glossary, if a term has multiple meanings, list them all without changing the original term
4. Provide a factual summary without rephrasing technical terms or abbreviations

Respond strictly in this JSON format:
{
  "summary": "Direct summary using original terms",
  "tags": ["tag1", "tag2", "tag3"],
  "glossary": [{"term": "exact term as written", "definition": "meaning(s) while preserving ambiguity"}]
}

Text to analyze: ${clean}`;
	
	const raw = await requestGroq(prompt);
	try {
		const parsed = JSON.parse(raw);
		return {
			summary: parsed.summary ?? '',
			tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
			glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
		};
	} catch {
		return { summary: '', tags: [], glossary: [] };
	}
}

export async function translateWithGroq(html, targetLang) {
	const clean = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	const prompt = `Translate the note into ${targetLang}. Output only the translated text.`;
	const text = await requestGroq(`${prompt}\n\n${clean}`);
	return text.trim();
}

export async function grammarCheckGroq(html) {
	const clean = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	const prompt = `Check this text for grammar errors and respond with a JSON array of exact error phrases. Example: For "I is happy and they is sad", respond with ["I is", "they is"]. Include enough context in each phrase to understand the error.

Input text: ${clean}

Response format must be a valid JSON array of strings, like: ["error phrase 1", "error phrase 2"]`;
	
	console.log('Sending to Groq:', clean);
	const raw = await requestGroq(prompt);
	console.log('Groq response:', raw);
	
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) {
			console.error('Groq response is not an array:', arr);
			return [];
		}
		console.log('Parsed grammar issues:', arr);
		return arr.slice(0, 20);
	} catch (error) {
		console.error('Failed to parse Groq response:', error);
		return [];
	}
}
