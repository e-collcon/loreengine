import { buildEmberfall } from '@loreengine/fixtures';
import { checkProject } from '@loreengine/schema';

const app = document.getElementById('app')!;
const project = buildEmberfall();
const issues = checkProject(project);
app.textContent = `LoreEngine player — ${project.name}: ${project.maps.length} map(s), ${issues.length} validation issue(s).`;
