import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { buildEmberfall } from '@loreengine/fixtures';
import { checkProject } from '@loreengine/schema';

function App() {
  const project = buildEmberfall();
  const issues = checkProject(project);
  return (
    <main style={{ padding: 24 }}>
      <h1>LoreEngine Editor</h1>
      <p>
        {project.name}: {project.maps.length} map(s), {project.archetypes.length} archetypes, {issues.length} validation issue(s).
      </p>
      <p>The editor shell arrives in chunk 8 (Phase 5).</p>
    </main>
  );
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
