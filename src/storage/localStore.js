const NOTES_KEY = 'pp_notes_v1';
const PREF_KEY = 'pp_prefs_v1';

export function loadNotes() {
	try {
		const raw = localStorage.getItem(NOTES_KEY);
		if (!raw) return [];
		return JSON.parse(raw);
	} catch {
		return [];
	}
}

export function saveNotes(notes) {
	localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

export function loadPrefs() {
	try {
		const raw = localStorage.getItem(PREF_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

export function savePrefs(prefs) {
	localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}
