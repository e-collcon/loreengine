/**
 * The LoreEngine editor (spec section 8): a client of the runtime that edits
 * the project document and playtests clones of it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { EditorSession } from './ui/session.ts';
import './ui/styles.css';

const root = createRoot(document.getElementById('app')!);
root.render(<p className="loading">Opening the project…</p>);
const session = await EditorSession.open();
// Bake the art once; the canvas and every playtest borrow it (DECISIONS N9).
void session.bakeArt().catch((error) => console.warn('LoreEngine: the art bake failed; placeholder shapes stay.', error));
window.addEventListener('beforeunload', () => void session.saveNow());
root.render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
