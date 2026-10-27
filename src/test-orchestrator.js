// M51: test orchestrator — auto-detect runner, build command, parse output.
//
// Kenapa ini dipisah dari verifier.js: verifier itu per-action (edit cocok gak,
// bash exit 0 gak). Test orchestrator ini level project — detect runner apa yang
// dipakai, jalanin test suite, parse output jadi structured result yang bisa
// langsung dipakai contract gate (M47) dan journal (M48).
//
// Written by K'

import fs from 'fs';
import path from 'path';

/**
 * Runner registry: urutan = prioritas. Yang pertama match menang.
 * Setiap entry punya:
 *  - runner: identifier string
 *  - markers: file yang harus ada di root project
 *  - command: default test command
 *  - parse: function(stdout, stderr, exitCode) -> structured result
 */
const RUNNERS = [
  {
    runner: 'npm',
    markers: ['package.json'],
    command: 'npm test --silent 2>&1',
    parse: parseNodeOutput,
  },
  {
    runner: 'go',
    markers: ['go.mod'],
    command: 'go test ./... 2>&1',
    parse: parseGoOutput,
  },
  {
    runner: 'python',
    markers: ['pyproject.toml', 'requirements.txt', 'setup.py'],
    command: 'python3 -m pytest -q 2>&1 || python3 -m unittest discover -q 2>&1',
    parse: parsePythonOutput,
  },
];

/**
 * Detect test runner dari file yang ada di root project.
 * @param {{files?: string[], root?: string}} opts
 * @returns {{runner: string, command: string, parse: Function}|null}
 */
export function detectTestRunner({ files, root } = {}) {
  const fileList = files || (root ? safeReaddir(root) : []);
  for (const def of RUNNERS) {
    if (def.markers.some(m => fileList.includes(m))) {
      return { runner: def.runner, command: def.command, parse: def.parse };
    }
  }
  return null;
}

/**
 * Build command string untuk dijalankan via bash.
 * @param {{runner: string|null, command?: string}} detected
 * @returns {string|null}
 */
export function buildTestCommand(detected) {
  if (!detected || !detected.runner) return null;
  // Kalau detectTestRunner yang manggil, field `command` udah ada.
  // Tapi kalau dipanggil manual dengan cuma `{ runner: 'npm' }`, lookup dari registry.
  if (detected.command) return detected.command;
  const match = RUNNERS.find(r => r.runner === detected.runner);
  return match ? match.command : null;
}

/**
 * Parse raw test output jadi structured result.
 * Output selalu punya shape yang sama terlepas dari runner:
 *   { passed: bool, testsPassed: number, testsFailed: number,
 *     failures: string[], summary: string, raw: string }
 *
 * @param {string} stdout
 * @param {string} runner
 * @returns {{passed:boolean, testsPassed:number, testsFailed:number, failures:string[], summary:string, raw:string}}
 */
export function parseTestOutput(stdout, runner) {
  const raw = String(stdout || '');
  if (!raw.trim()) {
    return emptyResult(false, raw, 'output kosong');
  }

  if (runner === 'go') return parseGoOutput(raw);
  if (runner === 'python') return parsePythonOutput(raw);
  return parseNodeOutput(raw); // npm / default
}

// ── Parsers per-runner ───────────────────────────────────────────────────────

function parseNodeOutput(raw) {
  const text = String(raw || '');

  // Pola KIANNNNN sendiri: "X pass, Y fail"
  const kianMatch = text.match(/(\d+)\s+pass,\s*(\d+)\s+fail/);
  if (kianMatch) {
    const tp = parseInt(kianMatch[1], 10);
    const tf = parseInt(kianMatch[2], 10);
    return {
      passed: tf === 0 && tp > 0,
      testsPassed: tp,
      testsFailed: tf,
      failures: extractFailLines(text),
      summary: `${tp} pass, ${tf} fail`,
      raw: text,
    };
  }

  // TAP format: "ok 1 - ..." / "not ok 1 - ..." / "1..N"
  const tapPlan = text.match(/^1\.\.(\d+)/m);
  if (tapPlan) {
    const oks = (text.match(/^ok\b/gm) || []).length;
    const notOks = (text.match(/^not ok\b/gm) || []).length;
    return {
      passed: notOks === 0 && oks > 0,
      testsPassed: oks,
      testsFailed: notOks,
      failures: extractFailLines(text),
      summary: `TAP: ${oks} ok, ${notOks} not ok`,
      raw: text,
    };
  }

  // Jest / Vitest: "Tests: X passed, Y failed" atau "Test Suites: X passed"
  const jestTests = text.match(/Tests:\s+(?:(\d+)\s+failed(?:,\s*)?)?(?:(\d+)\s+passed)?/i);
  if (jestTests) {
    const tf = parseInt(jestTests[1] || '0', 10);
    const tp = parseInt(jestTests[2] || '0', 10);
    return {
      passed: tf === 0 && tp > 0,
      testsPassed: tp,
      testsFailed: tf,
      failures: extractFailLines(text),
      summary: `Tests: ${tp} passed, ${tf} failed`,
      raw: text,
    };
  }

  // Fallback: cek exit code pattern atau kata FAIL/PASS
  const hasFail = /\bFAIL\b|failed|error/i.test(text);
  const hasPass = /\bPASS\b|passed|success/i.test(text);
  const passed = !hasFail && hasPass;

  return {
    passed,
    testsPassed: passed ? 1 : 0,
    testsFailed: hasFail ? 1 : 0,
    failures: extractFailLines(text),
    summary: truncate(text, 200),
    raw: text,
  };
}

function parseGoOutput(raw) {
  const text = String(raw || '');
  // go test: "ok  pkg  0.001s" atau "FAIL  pkg  0.001s"
  const oks = (text.match(/^ok\s+/gm) || []).length;
  const fails = (text.match(/^FAIL\s+/gm) || []).length;
  // Atau pola "--- FAIL: TestName"
  const failTests = (text.match(/--- FAIL:/g) || []).length;
  const passTests = (text.match(/--- PASS:/g) || []).length;

  const tp = passTests || oks;
  const tf = failTests || fails;

  return {
    passed: tf === 0 && (tp > 0 || /^ok\s/m.test(text)),
    testsPassed: tp,
    testsFailed: tf,
    failures: extractFailLines(text),
    summary: `go: ${tp} passed, ${tf} failed`,
    raw: text,
  };
}

function parsePythonOutput(raw) {
  const text = String(raw || '');
  // pytest: "X passed, Y failed" atau "X passed in 0.1s"
  const pytestMatch = text.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
  if (pytestMatch) {
    const tp = parseInt(pytestMatch[1], 10);
    const tf = parseInt(pytestMatch[2] || '0', 10);
    return {
      passed: tf === 0 && tp > 0,
      testsPassed: tp,
      testsFailed: tf,
      failures: extractFailLines(text),
      summary: `pytest: ${tp} passed, ${tf} failed`,
      raw: text,
    };
  }

  // unittest: "Ran X tests ... OK" atau "FAILED (failures=Y, errors=Z)"
  const unitMatch = text.match(/Ran\s+(\d+)\s+tests?/i);
  if (unitMatch) {
    const total = parseInt(unitMatch[1], 10);
    const isOk = /\bOK\b/.test(text);
    const failMatch = text.match(/failures=(\d+)/i);
    const errMatch = text.match(/errors=(\d+)/i);
    const tf = parseInt(failMatch?.[1] || '0', 10) + parseInt(errMatch?.[1] || '0', 10);
    return {
      passed: isOk && tf === 0,
      testsPassed: isOk ? total : total - tf,
      testsFailed: tf,
      failures: extractFailLines(text),
      summary: `unittest: ${total} ran, ${isOk ? 'OK' : tf + ' failed'}`,
      raw: text,
    };
  }

  return parseNodeOutput(text); // fallback ke generic
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(passed, raw, reason) {
  return { passed, testsPassed: 0, testsFailed: 0, failures: [], summary: reason, raw: String(raw || '') };
}

function extractFailLines(text) {
  const lines = String(text).split('\n');
  const fails = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(✗|FAIL|not ok|--- FAIL|Error:|×)/.test(trimmed)) {
      fails.push(truncate(trimmed, 200));
    }
  }
  return fails.slice(0, 20); // batas 20 biar gak jebol context
}

function truncate(s, max) {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir).filter(f => {
      try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; }
    });
  } catch {
    return [];
  }
}
