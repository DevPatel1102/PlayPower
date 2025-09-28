## PlayPower Notes (React + Vite)

AI-powered, encrypted notes with a custom rich text editor. Hosted on Netlify/Vercel/GitHub Pages.

### Features
- Custom rich text editor: bold, italic, underline, alignment, font size
- Notes CRUD, search, pin to top, versions
- Local persistence via localStorage
- AES-GCM encryption with password-based key derivation (PBKDF2)
- Groq AI: summary, tags, glossary highlighting, grammar check, translation
- Responsive layout and touch-friendly toolbar

### Getting Started
```bash
npm install
npm run dev
```

### Build
```bash
npm run build
npm run preview
```

### Deploy
- Netlify: uses `netlify.toml`
- Vercel / GitHub Pages: static build in `dist/`

### Environment
- `VITE_GROQ_API_KEY`: your Groq API key
- `VITE_GROQ_MODEL`: optional, default `llama3-8b-8192`