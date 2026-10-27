// M62: environment intelligence — agent tau kondisi sekitar.
// Written by K'

import os from 'os';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function detectEnvironment() {
  return {
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    cwd: process.cwd(),
    homedir: os.homedir(),
    freeDisk: getFreeDisk(),
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
    cpus: os.cpus().length,
    uptime: Math.round(os.uptime()),
  };
}

export function describeEnvironment(env) {
  if (!env) return '';
  return [
    `OS: ${env.os} (${env.platform}/${env.arch})`,
    `Node: ${env.nodeVersion}`,
    `CWD: ${env.cwd}`,
    `Disk free: ${env.freeDisk}MB`,
    `Memory: ${env.freeMemoryMb}/${env.totalMemoryMb}MB`,
    `CPUs: ${env.cpus}`,
  ].join('\n');
}

export function getFreeDisk() {
  try {
    const out = execSync('df -k . 2>/dev/null | tail -1', { encoding: 'utf8' });
    const parts = out.trim().split(/\s+/);
    return Math.round(parseInt(parts[3], 10) / 1024) || 0;
  } catch {
    return 0;
  }
}

export function getNodeVersion() {
  return process.version;
}
