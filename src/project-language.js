// M31: project language detection, deterministic and evidence-based.
import fs from 'fs';
import path from 'path';

const RULES = [
  { language: 'typescript', files: ['*.ts', '*.tsx'], markers: ['tsconfig.json'], score: 4 },
  { language: 'javascript', files: ['*.js', '*.mjs', '*.cjs'], markers: ['package.json'], score: 3 },
  { language: 'python', files: ['*.py'], markers: ['pyproject.toml', 'requirements.txt', 'setup.py'], score: 3 },
  { language: 'go', files: ['*.go'], markers: ['go.mod', 'go.sum'], score: 4 },
];
function match(name, pattern) { return pattern.startsWith('*.') ? name.endsWith(pattern.slice(1)) : name === pattern; }
export function detectProjectLanguages(root = process.cwd()) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return RULES.map(rule => {
    const files = entries.filter(e => e.isFile() && rule.files.some(p => match(e.name, p))).map(e => e.name);
    const markers = rule.markers.filter(m => fs.existsSync(path.join(root, m)));
    return { language: rule.language, score: files.length + markers.length * rule.score, files, markers };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.language.localeCompare(b.language));
}
