// lib/package-safety.js — cek keamanan package sebelum install

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:safety]', ...args); };

const KNOWN_BAD = {
  npm: new Set(['kv', 'cacheable']),
  pkg: new Set([])
};

const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';

function extractPackageName(command) {
  const npmMatch = command.match(/npm\s+(?:install|i)\s+(?:-[A-Za-z]+\s+)*([a-zA-Z0-9@/_.-]+)/);
  if (npmMatch) {
    const raw = npmMatch[1];
    const name = raw.startsWith('@') ? raw : raw.split('@')[0];
    return { manager: 'npm', name };
  }
  const pkgMatch = command.match(/pkg\s+install\s+(?:-[A-Za-z]+\s+)*([a-zA-Z0-9._-]+)/);
  if (pkgMatch) {
    return { manager: 'pkg', name: pkgMatch[1] };
  }
  return null;
}

async function checkNpm(name) {
  const flags = [];
  let blocked = false;
  let ageDays = null; // declare di luar try biar bisa dipakai di try kedua

  try {
    const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    dbg(`registry fetch: ${res.status}`);
    if (res.status === 404) {
      return { blocked: true, flags: [`🔴 Package "${name}" TIDAK DITEMUKAN di npm registry. Kemungkinan typo atau package belum pernah ada.`] };
    }
    if (!res.ok) {
      return { blocked: false, flags: [`⚠️ Tidak bisa cek registry (HTTP ${res.status}), lanjut dengan hati-hati.`] };
    }
    const data = await res.json();
    const firstPublish = data.time?.created;
    if (firstPublish) {
      ageDays = (Date.now() - new Date(firstPublish).getTime()) / 86400000;
      if (ageDays < 30) {
        flags.push(`🟡 Package baru dipublish ${Math.floor(ageDays)} hari lalu (< 30 hari).`);
      }
    }
  } catch (err) {
    return { blocked: false, flags: [`⚠️ Error cek registry: ${err.message}`] };
  }

  try {
    const dlRes = await fetch(`${NPM_DOWNLOADS}/${encodeURIComponent(name)}`);
    if (dlRes.ok) {
      const dlData = await dlRes.json();
      const downloads = dlData.downloads || 0;
      dbg(`downloads/week: ${downloads.toLocaleString()}, age: ${ageDays !== null ? Math.floor(ageDays) + ' days' : 'unknown'}`);
      flags.push(`ℹ️ Downloads minggu lalu: ${downloads.toLocaleString()}`);
      if (downloads < 1000) {
        flags.push(`🟡 Downloads di bawah 1.000/minggu — package kurang populer.`);
      }
    }
  } catch { /* non-critical, skip */ }

  return { blocked, flags };
}

async function checkPkg(name) {
  try {
    const { runCommand } = await import('./bash.js');
    const result = await runCommand(`apt-cache search "^${name}$"`);
    dbg(`apt-cache result: "${result.stdout.trim().slice(0, 80)}"`);
    if (!result.stdout.trim()) {
      return { blocked: false, flags: [`🟡 Package "${name}" tidak ditemukan di apt-cache search. Kemungkinan typo.`] };
    }
    return { blocked: false, flags: [`ℹ️ Package ditemukan di repo Termux.`] };
  } catch (err) {
    return { blocked: false, flags: [`⚠️ Error cek pkg: ${err.message}`] };
  }
}

export async function checkPackageSafety(command) {
  const extracted = extractPackageName(command);
  if (!extracted) return null;

  const { manager, name } = extracted;
  dbg(`extracted: manager=${manager}, name=${name}`);
  dbg(`known-bad check: ${KNOWN_BAD[manager]?.has(name) ? '🔴 HIT' : 'clean'}`);

  if (KNOWN_BAD[manager]?.has(name)) {
    return {
      blocked: true,
      flags: [`🔴 "${name}" ada di known-bad list — dikonfirmasi terkena supply chain attack / malware.`]
    };
  }

  if (manager === 'npm') return await checkNpm(name);
  if (manager === 'pkg') return await checkPkg(name);
  return null;
}
