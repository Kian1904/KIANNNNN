import { collectUrls, chooseOfficialUrl, buildForcedResearchPrompt } from '../src/core/web-planning.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => condition ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));
const history = [
  { action: 'web_search', summary: 'https://example.com/a and https://bmkg.go.id/cuaca' },
  { action: 'web_search', summary: 'https://example.com/b' },
];
const urls = collectUrls(history);
check('collects and deduplicates urls', urls.length === 3 && urls.includes('https://bmkg.go.id/cuaca'));
check('prefers official url', chooseOfficialUrl(urls) === 'https://bmkg.go.id/cuaca');
check('falls back to first url', chooseOfficialUrl(['https://example.com/a']) === 'https://example.com/a');
const prompt = buildForcedResearchPrompt('cuaca Jakarta', 'evidence text');
check('forced prompt contains instruction', prompt.includes('cuaca Jakarta'));
check('forced prompt requires done', /ACTION: done/.test(prompt));

console.log(`\n=== HASIL WEB-PLANNING-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
