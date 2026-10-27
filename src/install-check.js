// M67: install/upgrade hardening — validasi instalasi, cek dependencies.
// Written by K'

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function validateInstall({ requiredFiles = [], cwd = process.cwd() } = {}) {
  const missing = requiredFiles.filter(f => !fs.existsSync(path.join(cwd, f)));
  return { valid: missing.length === 0, missing };
}

export function checkDependencies(deps = []) {
  return deps.map(name => {
    try {
      execSync(`command -v ${name} 2>/dev/null`, { stdio: 'ignore' });
      return { name, found: true };
    } catch {
      return { name, found: false };
    }
  });
}

export function getInstallReport({ files = [], deps = [] } = {}) {
  const lines = ['Install check:'];
  lines.push(`  Files: ${files.length} checked`);
  for (const d of deps) {
    lines.push(`  ${d.found ? '✓' : '✗'} ${d.name}`);
  }
  return lines.join('\n');
}
