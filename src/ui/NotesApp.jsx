import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadNotes, saveNotes, loadPrefs, savePrefs } from '../storage/localStore';
import { encryptText, decryptText } from '../crypto/crypto';
import { getInsightsFromGroq, translateWithGroq, grammarCheckGroq } from '../ai/groq';

const LOCKED_NOTE_MESSAGE = `
<div style="text-align: center; padding: 20px; color: var(--muted);">
    <div style="font-size: 24px; margin-bottom: 16px;">🔒</div>
    <h3 style="margin-bottom: 12px; color: var(--text);">This note is encrypted</h3>
    <p>Enter the password and click Decrypt to view the contents.</p>
</div>
`;

function uid() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function setCaretToEnd(element) {
    if (!element) return;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false); 
    selection.addRange(range);
}

function initialNote() {
	const id = uid();
	return { 
		id, 
		createdAt: Date.now(), 
		updatedAt: Date.now(), 
		title: 'Untitled', 
		html: '<p></p>', 
		pinned: false, 
		tags: [], 
		encrypted: false, 
		versions: [],
		aiSummary: '',
		aiTags: [],
		aiGlossary: [],
		translations: {}
	};
}

export function NotesApp() {
	const [notes, setNotes] = useState(() => loadNotes());
	const [activeId, setActiveId] = useState(() => loadPrefs().lastOpenedId ?? notes[0]?.id);
	const [search, setSearch] = useState('');
	const [aiSummary, setAiSummary] = useState('');
	const [aiTags, setAiTags] = useState([]);
	const [aiGlossary, setAiGlossary] = useState([]);
	const [translations, setTranslations] = useState({});
	const [selectedLanguage, setSelectedLanguage] = useState('');
	const [grammarIssues, setGrammarIssues] = useState([]);
	const [password, setPassword] = useState('');
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [sessionUnlock, setSessionUnlock] = useState({});
	const [restoreCaret, setRestoreCaret] = useState(false);
	const editorRef = useRef(null);

	useEffect(() => {
		saveNotes(notes);
	}, [notes]);

	useEffect(() => {
		savePrefs({ lastOpenedId: activeId });
	}, [activeId]);

	const activeNote = useMemo(() => {
		const note = notes.find(n => n.id === activeId);
		if (note) {
			setAiSummary(note.aiSummary || '');
			setAiTags(note.aiTags || []);
			setAiGlossary(note.aiGlossary || []);
			setTranslations(note.translations || {});
			setSelectedLanguage(''); 
		}
		return note;
	}, [notes, activeId]);

	function createNote() {
		const n = initialNote();
		setNotes(prev => [n, ...prev]);
		setActiveId(n.id);
		setAiSummary('');
		setAiTags([]);
		setAiGlossary([]);
		setTranslations({});
		setSelectedLanguage(''); 
	}

	function deleteNote(id) {
		setNotes(prev => prev.filter(n => n.id !== id));
		if (activeId === id) setActiveId(undefined);
	}

	function togglePin(id) {
		setNotes(prev => prev.map(n => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n)));
	}

	function updateTitle(id, title) {
		setNotes(prev => prev.map(n => (n.id === id ? { ...n, title, updatedAt: Date.now() } : n)));
	}

	function saveVersion(id) {
		setNotes(prev => prev.map(n => (n.id === id ? { ...n, versions: [{ versionId: uid(), createdAt: Date.now(), title: n.title, html: n.html }, ...n.versions].slice(0, 25) } : n)));
	}

	function deleteVersion(id, versionId) {
		setNotes(prev => prev.map(n => (n.id === id ? {
			...n,
			versions: n.versions.filter(v => v.versionId !== versionId)
		} : n)));
	}

	function restoreVersion(id, versionId) {
		const version = notes.find(n => n.id === id)?.versions.find(v => v.versionId === versionId);
		if (!version) return;
		
		setNotes(prev => prev.map(n => (n.id === id ? { 
			...n, 
			html: version.html, 
			title: version.title, 
			updatedAt: Date.now(),
			encrypted: false,
			iv: undefined,
			salt: undefined
		} : n)));
		
		setSessionUnlock(prev => {
			const next = { ...prev };
			delete next[id];
			return next;
		});
		
		const el = editorRef.current;
		if (el) {
			el.innerHTML = version.html;
			setRestoreCaret(true);
		}
	}

	function onExec(command, value) {
		document.execCommand(command, false, value);
	}

	function onSetAlignment(align) {
		const el = editorRef.current;
		if (!el) return;
		el.classList.remove('align-left', 'align-center', 'align-right');
		el.classList.add(`align-${align}`);
	}

	function onFontSizeChange(sizePx) {
		document.execCommand('fontSize', false, '7');
		const selection = document.getSelection();
		if (!selection) return;
		const fontElements = (selection.anchorNode?.parentElement?.getElementsByTagName('font') ?? []);
		for (const fontEl of fontElements) {
			fontEl.removeAttribute('size');
			fontEl.style.fontSize = `${sizePx}px`;
		}
	}

	function onInputHtml() {
		if (!activeNote || !editorRef.current) return;
		const html = editorRef.current.innerHTML;
		const unlock = sessionUnlock[activeNote.id];
		if (activeNote.encrypted && unlock) {
			setSessionUnlock(prev => ({ ...prev, [activeNote.id]: { ...unlock, plain: html } }));
			(async () => {
				const res = await encryptText(html, unlock.password);
				setNotes(prev => prev.map(n => (n.id === activeNote.id ? { 
					...n, 
					html, 
					cipherHex: res.cipherHex, 
					iv: res.ivHex, 
					salt: res.saltHex, 
					updatedAt: Date.now(), 
					encrypted: true 
				} : n)));
			})();
			return;
		}
		setNotes(prev => prev.map(n => (n.id === activeNote.id ? { ...n, html, updatedAt: Date.now() } : n)));
	}

	async function encryptActive() {
		if (!activeNote) return;
		if (!password) return;
		const currentHtml = editorRef.current?.innerHTML ?? activeNote.html;
		const plain = sessionUnlock[activeNote.id]?.plain ?? currentHtml;
		const res = await encryptText(plain, password);
		setNotes(prev => prev.map(n => (n.id === activeNote.id ? { 
			...n, 
			html: LOCKED_NOTE_MESSAGE, 
			cipherHex: res.cipherHex,
			iv: res.ivHex, 
			salt: res.saltHex, 
			encrypted: true, 
			updatedAt: Date.now() 
		} : n)));
		
		setSessionUnlock(prev => {
			const next = { ...prev };
			delete next[activeNote.id];
			return next;
		});
		
		const el = editorRef.current; 
		if (el) { 
			el.innerHTML = LOCKED_NOTE_MESSAGE;
			setRestoreCaret(true); 
		}
	}

	async function decryptActive() {
		if (!activeNote || !password) return;
		if (!activeNote.iv || !activeNote.salt || !activeNote.cipherHex) return;
		try {
			const plain = await decryptText(activeNote.cipherHex, password, activeNote.iv, activeNote.salt);
			setSessionUnlock(prev => ({ ...prev, [activeNote.id]: { plain, password } }));
			setNotes(prev => prev.map(n => n.id === activeNote.id ? { ...n, html: plain, encrypted: false, iv: undefined, salt: undefined, cipherHex: undefined } : n));
			const el = editorRef.current; 
			if (el) { 
				el.innerHTML = plain; 
				setRestoreCaret(true); 
			}
		} catch {
			alert('Incorrect password or data corrupted');
		}
	}

    async function runInsights() {
        if (!activeNote) return;
        const unlock = sessionUnlock[activeNote.id];
        if (activeNote.encrypted && !unlock) return;

        const currentHtml = editorRef.current?.innerHTML || activeNote.html;
        const htmlForAi = activeNote.encrypted && unlock ? unlock.plain : currentHtml;
        
        try {
            const { summary, tags, glossary } = await getInsightsFromGroq(htmlForAi);
           
            setAiSummary(summary);
            setAiTags(tags);
            setAiGlossary(glossary);
            
            setNotes(prev => prev.map(n => n.id === activeNote.id ? {
                ...n,
                aiSummary: summary,
                aiTags: tags,
                aiGlossary: glossary,
                html: currentHtml,
                encrypted: n.encrypted,
                cipherHex: n.cipherHex,
                iv: n.iv,
                salt: n.salt
            } : n));
        } catch (error) {
            console.error('Error generating insights:', error);
        }
	}

    async function runGrammar() {
        if (!activeNote) return;
        const unlock = sessionUnlock[activeNote.id];
        if (activeNote.encrypted && !unlock) return;
        const htmlForAi = activeNote.encrypted && unlock ? unlock.plain : activeNote.html;
        console.log('Checking grammar for:', htmlForAi);
        const issues = await grammarCheckGroq(htmlForAi);
        console.log('Grammar issues found:', issues);
		setGrammarIssues(issues);
	}

    async function runTranslate(lang) {
        if (!activeNote) return;
        const unlock = sessionUnlock[activeNote.id];
        if (activeNote.encrypted && !unlock) return;
        const htmlForAi = activeNote.encrypted && unlock ? unlock.plain : activeNote.html;
        const t = await translateWithGroq(htmlForAi, lang);
        const newTranslations = { [lang]: t };
        setTranslations(newTranslations);
		setNotes(prev => prev.map(n => n.id === activeNote.id ? {
			...n,
			translations: newTranslations
		} : n));
	}

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		let list = notes;
		if (q) list = list.filter(n => n.title.toLowerCase().includes(q) || n.html.toLowerCase().includes(q));
		list = [...list].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updatedAt - a.updatedAt));
		return list;
	}, [notes, search]);

	useEffect(() => {
		const el = editorRef.current;
		if (!el) return;
		if (!activeNote) { el.innerHTML = ''; return; }
		const unlock = sessionUnlock[activeNote.id];
		el.innerHTML = activeNote.encrypted && unlock ? unlock.plain : (activeNote.html ?? '');
    if (restoreCaret) { setCaretToEnd(el); setRestoreCaret(false); }
	}, [activeNote?.id]);

useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (!activeNote) return;
    let html = (activeNote.encrypted && sessionUnlock[activeNote?.id]) ? sessionUnlock[activeNote.id].plain : activeNote.html;
    if (!html) html = '';
    if (aiGlossary.length === 0 && grammarIssues.length === 0) {
        return;
    }
    for (const g of aiGlossary) {
        if (!g.term) continue;
        const safeTerm = g.term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const re = new RegExp(`(\\b${safeTerm}\\b)`, 'gi');
        const title = (g.definition || '').replace(/\"/g, '&quot;');
        html = html.replace(re, `<span class=\"glossary-highlight\" title=\"${title}\">$1</span>`);
    }
    for (const err of grammarIssues) {
        const re = new RegExp(err.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
        html = html.replace(re, '<span class=\"grammar-underline\">$&</span>');
    }
    el.innerHTML = html;
    if (restoreCaret) { setCaretToEnd(el); setRestoreCaret(false); }
}, [aiGlossary, grammarIssues, activeNote?.id, restoreCaret]);

	return (
		<div className="app-shell">
			<aside className="sidebar">
				<div className="top">
					<button className="btn primary" onClick={createNote}>New</button>
					<input className="input" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
				</div>
				<div className="notes-list">
					{filtered.map(n => (
						<div key={n.id} className={`note-item ${n.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(n.id)}>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<strong>{n.title || 'Untitled'} {n.pinned && <span className="pin">📌</span>}</strong>
								<div style={{ display: 'flex', gap: 6 }}>
									<button className="btn icon" title="Pin" onClick={(e) => { e.stopPropagation(); togglePin(n.id); }}>📌</button>
									<button className="btn icon" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNote(n.id); }}>✖️</button>
								</div>
							</div>
							<div className="disclaimer" style={{ marginTop: 6 }}>{new Date(n.updatedAt).toLocaleString()} {n.encrypted ? '· Encrypted' : ''}</div>
						</div>
					))}
				</div>
			</aside>

			<main className="editor-area">
				<div className="toolbar">
					<div className="group">
						<button className="btn icon" onClick={() => onExec('bold')}><b>B</b></button>
						<button className="btn icon" onClick={() => onExec('italic')}><i>I</i></button>
						<button className="btn icon" onClick={() => onExec('underline')}><u>U</u></button>
					</div>
					<button className="btn icon tablet-only" onClick={() => setShowAiPanel(!showAiPanel)} title="Toggle AI Panel">
						🤖
					</button>
					<div className="group">
						<button className="btn icon" onClick={() => onSetAlignment('left')}>↤</button>
						<button className="btn icon" onClick={() => onSetAlignment('center')}>↔</button>
						<button className="btn icon" onClick={() => onSetAlignment('right')}>↦</button>
					</div>
					<div className="group">
						<select className="select-dark" onChange={(e) => onFontSizeChange(Number(e.target.value))} defaultValue="16">
							<option value="14">14px</option>
							<option value="16">16px</option>
							<option value="18">18px</option>
							<option value="24">24px</option>
							<option value="32">32px</option>
						</select>
					</div>
					<div className="group" style={{ marginLeft: 'auto' }}>
						<div className="password-row">
							<input type="password" className="input" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
							<button className="btn" onClick={encryptActive}>Encrypt</button>
							<button className="btn" onClick={decryptActive}>Decrypt</button>
						</div>
					</div>
				</div>
				<input className="title-input" value={activeNote?.title ?? ''} onChange={e => activeNote && updateTitle(activeNote.id, e.target.value)} placeholder="Title" />
				<div className="editor">
                    <div
                        ref={editorRef}
                        className="rte align-left"
                        contentEditable={Boolean(activeNote && (!activeNote.encrypted || sessionUnlock[activeNote.id]))}
                        onInput={onInputHtml}
                    />
					<div className="disclaimer" style={{ marginTop: 8 }}>Changes auto-saved. Encrypted notes are read-protected.</div>
					<div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
						<button className="btn" onClick={() => activeNote && saveVersion(activeNote.id)}>Save Version</button>
						{activeNote && activeNote.versions.slice(0, 5).map(v => (
							<div key={v.versionId} style={{ display: 'inline-flex', gap: 4 }}>
								<button className="btn" onClick={() => restoreVersion(activeNote.id, v.versionId)} title={new Date(v.createdAt).toLocaleString()}>
									Restore {new Date(v.createdAt).toLocaleTimeString()}
								</button>
								<button className="btn icon" onClick={() => deleteVersion(activeNote.id, v.versionId)} title="Delete version">✖️</button>
							</div>
						))}
					</div>
				</div>
			</main>

			<aside className={`ai-panel ${showAiPanel ? 'show' : ''}`}>
				<div className="ai-section">
					<h3>AI Actions</h3>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<button className="btn" onClick={runInsights}>Summarize + Tags + Glossary</button>
						<button className="btn" onClick={runGrammar}>Grammar Check</button>
						<select 
							className="select-dark" 
							value={selectedLanguage}
							onChange={e => {
								setSelectedLanguage(e.target.value);
								runTranslate(e.target.value);
							}}
						>
							<option value="" disabled>Translate…</option>
							<option value="English">English</option>
							<option value="Spanish">Spanish</option>
							<option value="French">French</option>
							<option value="German">German</option>
							<option value="Hindi">Hindi</option>
							<option value="Chinese">Chinese</option>
						</select>
					</div>
				</div>
				<div className="ai-results-container">
					<div className="ai-section">
						<h3>Summary</h3>
						<div>{aiSummary || '—'}</div>
					</div>
					<div className="ai-section">
						<h3>Tags</h3>
						<div className="ai-chips">{aiTags.map(t => <span key={t} className="chip">{t}</span>)}</div>
					</div>
					<div className="ai-section">
						<h3>Glossary</h3>
						<div>
							{aiGlossary.length === 0 ? '—' : aiGlossary.map(g => (
								<div key={g.term}><span className="tag">{g.term}</span> {g.definition}</div>
							))}
						</div>
					</div>
					<div className="ai-section">
						<h3>Translations</h3>
						<div>
							{Object.keys(translations).length === 0 ? '—' : Object.entries(translations).map(([lang, text]) => (
								<div key={lang} style={{ marginBottom: 8 }}>
									<div className="tag">{lang}</div>
									<div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</aside>
		</div>
	);
}