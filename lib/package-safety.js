// lib/package-safety.js — cek keamanan package sebelum install

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:safety]', ...args); };

const KNOWN_BAD = {
  npm: new Set(['kv', 'cacheable']),
  pkg: new Set([])
};

const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';

/**
 * Levenshtein distance — untuk deteksi kemiripan nama package (typosquatting)
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i-1] === a[j-1]) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1] + 1,
          matrix[i][j-1] + 1,
          matrix[i-1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Daftar package populer di Termux — untuk baseline popularitas
 * Sumber: observasi umum, bisa di-update manual
 */
function getPopularPkgList() {
  return [
    'git', 'python', 'nodejs', 'curl', 'wget', 'vim', 'nano', 'openssh',
    'bash', 'zsh', 'tmux', 'htop', 'make', 'gcc', 'clang', 'rust', 'go',
    'ruby', 'perl', 'php', 'mysql', 'postgresql', 'redis', 'nginx', 'apache2',
    'ffmpeg', 'imagemagick', 'texlive', 'gh', 'jq', 'yq', 'fzf', 'ripgrep',
    'fd', 'bat', 'exa', 'neofetch', 'cmatrix', 'sl', 'cowsay', 'figlet',
    'toilet', 'lolcat', 'tree', 'unzip', 'zip', 'tar', 'gzip', 'bzip2',
    'xz-utils', 'less', 'more', 'findutils', 'grep', 'sed', 'awk', 'coreutils'
  ];
}

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

/**
 * Check pkg dengan kombinasi: apt-cache search + popularitas + similarity
 */
async function checkPkg(name) {
  const flags = [];
  let blocked = false;

  // 1. Cek via apt-cache search
  try {
    const { runCommand } = await import('./bash.js');
    const result = await runCommand(`apt-cache search "^${name}$"`);
    dbg(`apt-cache result: "${result.stdout.trim().slice(0, 80)}"`);
    if (result.stdout.trim()) {
      flags.push(`ℹ️ Package ditemukan di repo Termux.`);
      // Kalau ditemukan, kita tetap cek popularitas untuk warning tambahan
      // Tapi tidak perlu block
    } else {
      flags.push(`🟡 Package "${name}" tidak ditemukan di apt-cache search.`);
    }
  } catch (err) {
    flags.push(`⚠️ Error cek apt-cache: ${err.message}`);
  }

  // 2. Cek popularitas & similarity (typosquatting detection)
  const popular = getPopularPkgList();
  const isPopular = popular.includes(name);
  if (isPopular) {
    flags.push(`✅ "${name}" adalah package populer di Termux.`);
  } else {
    // Cek similarity dengan daftar populer
    let minDistance = Infinity;
    let closest = '';
    for (const pkg of popular) {
      const dist = levenshteinDistance(name, pkg);
      if (dist < minDistance) {
        minDistance = dist;
        closest = pkg;
      }
    }
    // Threshold: distance <= 2 dianggap mencurigakan (typosquatting)
    if (minDistance <= 2 && minDistance > 0) {
      flags.push(`🟡 Nama "${name}" mirip dengan package populer "${closest}" (distance ${minDistance}) — potensi typosquatting.`);
    } else if (minDistance > 0 && minDistance <= 3) {
      flags.push(`ℹ️ Nama "${name}" agak mirip dengan "${closest}" (distance ${minDistance}), periksa kembali.`);
    }
    // Kalau tidak ada yang mirip dan tidak ditemukan di apt-cache, kasih warning
    if (minDistance > 3 && !isPopular) {
      flags.push(`⚠️ "${name}" tidak populer dan tidak ditemukan di repo — hati-hati, mungkin package tidak resmi.`);
    }
  }

  // 3. Kalau apt-cache search tidak menemukan DAN bukan package populer, kita block?
  // Kita pilih: tidak block otomatis, tapi kasih warning kuat.
  // Biar user yang decide — konsisten dengan filosofi safety (warning, bukan block otomatis kecuali known-bad).
  // Tapi kalau apt-cache search gagal dan similarity tinggi, kita kasih flag lebih kuat.
  // Untuk sekarang, kita return blocked: false (tidak auto-block), tapi flags lengkap.

  return { blocked, flags };
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
