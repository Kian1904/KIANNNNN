// M51: oracle Levenshtein JS vs Go — hasil harus IDENTIK.
import { levenshteinDistanceAsync, findNearestAsync, goBridgeStatus } from '../src/package-safety.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const status = goBridgeStatus();
console.log(`  (bridge Go: ${status.available ? 'tersedia' : 'TIDAK ADA — fallback JS'})`);

// Referensi JS (salinan lokal, biar oracle independen dari modul)
function levJS(a, b) {
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
    }
  }
  return m[b.length][a.length];
}

const pairs = [
  ['', ''], ['a', ''], ['', 'a'], ['abc', 'abc'],
  ['kitten', 'sitting'], ['flaw', 'lawn'], ['git', 'gti'],
  ['nodejs', 'node'], ['python', 'pyton'], ['curl', 'crul'],
  ['café', 'cafe'], ['日本語', '日本'], ['a'.repeat(50), 'b'.repeat(50)],
  ['@scope/pkg', '@scope/pk'], ['react', 'react-dom'],
];
for (const [a, b] of pairs) {
  const js = levJS(a, b);
  const go = await levenshteinDistanceAsync(a, b);
  check(`lev(${JSON.stringify(a.slice(0,12))},${JSON.stringify(b.slice(0,12))}): ${js}`, js === go);
}

const popular = ['git','python','nodejs','curl','wget','vim','nano','openssh','bash','zsh','tmux','htop','make','gcc','clang','rust','go','ruby','perl','php'];
for (const name of ['gti', 'node', 'pyton', 'crul', 'zzzzzzzz', 'git', 'react']) {
  let minDist = -1, closest = '';
  for (const c of popular) { const d = levJS(name, c); if (minDist === -1 || d < minDist) { minDist = d; closest = c; } }
  const go = await findNearestAsync(name, popular);
  check(`nearest(${name}): ${closest}/${minDist}`, go.closest === closest && go.distance === minDist);
}

const empty = await findNearestAsync('x', []);
check('nearest kosong: distance -1', empty.distance === -1 && empty.closest === '');

console.log(`\n=== HASIL GO-SAFETY: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
