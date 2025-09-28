function toHex(bytes) {
	return Array.from(new Uint8Array(bytes))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

function fromHex(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return bytes;
}

async function deriveKey(password, salt) {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function encryptText(plain, password) {
	const enc = new TextEncoder();
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await deriveKey(password, salt);
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
	return { cipherHex: toHex(cipher), ivHex: toHex(iv), saltHex: toHex(salt) };
}

export async function decryptText(cipherHex, password, ivHex, saltHex) {
	const iv = fromHex(ivHex);
	const salt = fromHex(saltHex);
	const key = await deriveKey(password, salt);
	const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromHex(cipherHex));
	return new TextDecoder().decode(decrypted);
}
