// lib/ui.js — TUI utilities: word wrap, header, consistent output
import chalk from 'chalk';

const B = { tl:'\u256D', tr:'\u256E', bl:'\u2570', br:'\u256F', h:'\u2500', v:'\u2502' };
const LABEL_W = 11;

function w() { return Math.min(process.stdout.columns || 80, 100); }

function pad(str, len) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

export function wrap(text, width) {
  const tw = width || w() - LABEL_W - 5;
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) { out.push(''); continue; }
    if (line.length <= tw) { out.push(line); continue; }
    const words = line.split(' ');
    let cur = '';
    for (const word of words) {
      if (!cur) { cur = word; continue; }
      if (cur.length + 1 + word.length <= tw) { cur += ' ' + word; }
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [''];
}

export function header(model, tools) {
  const width = w();
  const line1 = 'K-sRouter  \u00B7  ' + model;
  const line2 = tools && tools.length ? 'tools: ' + tools.join(', ') : null;
  console.log('');
  console.log(B.tl + B.h.repeat(width - 2) + B.tr);
  console.log(B.v + '  ' + pad(line1, width - 4) + '  ' + B.v);
  if (line2) console.log(B.v + '  ' + pad(line2, width - 4) + '  ' + B.v);
  console.log(B.bl + B.h.repeat(width - 2) + B.br);
  console.log('');
}

const LABELS = {
  step:'LANGKAH', provider:'PROVIDER', reasoning:'REASONING',
  read:'READ', list_dir:'LIST', remember:'REMEMBER',
  mcp:'MCP', mcp_err:'MCP ERROR', edit_ok:'WRITE',
  snapshot:'SNAPSHOT', bash:'COMMAND', exit_code:'EXIT',
  stderr:'STDERR', done:'SELESAI', blocked:'BLOCKED',
  rejected:'DITOLAK', auto:'AUTO', session_ok:'SESSION',
  condition:'CONDITION', safety:'SAFETY', rollback:'ROLLBACK',
  distill:'DISTILL', mcp_init:'MCP', agent_md:'AGENT.MD',
  model:'MODEL', usage:'USAGE', warn:'WARN', error:'ERROR',
  info:'INFO', stop:'BERHENTI', diff:'DIFF', approval:'APPROVAL',
  connect:'CONNECT',
  web_search:'WEB SEARCH', sources:'SUMBER', search_err:'SEARCH ERROR',
};

export function print(type, text) {
  text = text || '';
  const label = pad(LABELS[type] || String(type).toUpperCase(), LABEL_W);
  const textW = w() - LABEL_W - 5;
  const lines = wrap(String(text), textW);
  const indent = '  ' + ' '.repeat(LABEL_W + 2);
  console.log('  ' + label + '  ' + lines[0]);
  for (let i = 1; i < lines.length; i++) {
    console.log(indent + lines[i]);
  }
}

export function printBlock(text, indentN) {
  indentN = indentN || 4;
  const sp = ' '.repeat(indentN);
  for (const line of wrap(String(text), w() - indentN)) {
    console.log(sp + line);
  }
}

export function printUserMessage(text) {
  const width = w();
  const lines = wrap(String(text), width - 10);
  console.log('');
  console.log('\u256D' + '\u2500'.repeat(width - 2) + '\u256E');
  console.log('\u2502 You: ' + lines[0].padEnd(width - 8) + ' \u2502');
  for (let i = 1; i < lines.length; i++) {
    console.log('\u2502      ' + lines[i].padEnd(width - 8) + ' \u2502');
  }
  console.log('\u2570' + '\u2500'.repeat(width - 2) + '\u256F');
  console.log('');
}

export function printAssistantMessage(text) {
  const width = w();
  const lines = wrap(String(text), width - 15);
  console.log('');
  console.log('\u256D' + '\u2500'.repeat(width - 2) + '\u256E');
  console.log('\u2502 KIANNNNN: ' + lines[0].padEnd(width - 13) + ' \u2502');
  for (let i = 1; i < lines.length; i++) {
    console.log('\u2502          ' + lines[i].padEnd(width - 13) + ' \u2502');
  }
  console.log('\u2570' + '\u2500'.repeat(width - 2) + '\u256F');
  console.log('');
}

export function printSystemMessage(text) {
  const width = w();
  const lines = wrap(String(text), width - 10);
  console.log('');
  console.log('\u250C' + '\u2500'.repeat(width - 2) + '\u2510');
  console.log('\u2502 SYS: ' + lines[0].padEnd(width - 8) + ' \u2502');
  for (let i = 1; i < lines.length; i++) {
    console.log('\u2502      ' + lines[i].padEnd(width - 8) + ' \u2502');
  }
  console.log('\u2514' + '\u2500'.repeat(width - 2) + '\u2518');
  console.log('');
}

export function printList(items, currentKey) {
  items.forEach(function(item, i) {
    const mark = item.key === currentKey ? '\u25CF' : ' ';
    console.log('  ' + mark + ' ' + (i + 1) + '. ' + item.label);
  });
}

export function sep() { console.log('  ' + B.h.repeat(w() - 4)); }
export function blank() { console.log(''); }

// Tool-call indicators (colored prefixes ala Qwen Code / Antigravity)
var ACTION_ICONS = {
  read:       { icon: '\uD83D\uDCD6', color: 'cyan' },
  list_dir:   { icon: '\uD83D\uDCC2', color: 'cyan' },
  edit:       { icon: '\u270F\uFE0F', color: 'yellow' },
  bash:       { icon: '\u26A1', color: 'red' },
  mcp_call:   { icon: '\uD83D\uDD0C', color: 'magenta' },
  web_search: { icon: '\uD83D\uDD0D', color: 'blue' },
  remember:   { icon: '\uD83D\uDCBE', color: 'green' },
  done:       { icon: '\u2705', color: 'green' },
  chat:       { icon: '\uD83D\uDCAC', color: 'white' },
  blocked:    { icon: '\uD83D\uDEAB', color: 'red' },
  thinking:   { icon: '\uD83E\uDDE0', color: 'gray' },
};

export function actionIndicator(action, detail) {
  var meta = ACTION_ICONS[action] || { icon: '\u25B6', color: 'white' };
  var fn = chalk[meta.color] || chalk.white;
  var label = String(action).toUpperCase().padEnd(10);
  var d = detail ? ' ' + chalk.dim(detail) : '';
  console.log('  ' + meta.icon + ' ' + fn.bold(label) + d);
}

export function banner(version, model, agentCount, toolCount) {
  var width = w();
  var inner = width - 4;
  var lines = [
    chalk.bold.cyan('  KIANNNNN v' + version),
    chalk.dim('  Multi-Agent CLI Orchestrator'),
    '',
    '  ' + chalk.bold('Model:') + '   ' + chalk.green(model),
    '  ' + chalk.bold('Agents:') + '  ' + agentCount + ' registered',
    '  ' + chalk.bold('MCP:') + '     ' + toolCount + ' tool' + (toolCount !== 1 ? 's' : '') + ' available',
  ];
  console.log('');
  console.log(chalk.cyan('  \u256D' + '\u2500'.repeat(inner) + '\u256E'));
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var stripped = l.replace(/\u001b\[[0-9;]*m/g, '');
    var padLen = Math.max(0, inner - stripped.length - 1);
    console.log(chalk.cyan('  \u2502') + l + ' '.repeat(padLen) + chalk.cyan('\u2502'));
  }
  console.log(chalk.cyan('  \u2570' + '\u2500'.repeat(inner) + '\u256F'));
  console.log('');
}

export var PROMPT = '  \u2502 > ';

export var SLASH_COMMANDS = [
  { cmd: '/exit',     desc: 'keluar dari K-sRouter' },
  { cmd: '/mode',     desc: 'mode approval: safe | wellwell | yolo' },
  { cmd: '/route',    desc: 'auto-routing ke squad: on | off | test <task>' },
  { cmd: '/rollback', desc: 'restore file ke snapshot sebelumnya' },
  { cmd: '/model',    desc: 'switch atau lihat model aktif' },
  { cmd: '/usage',    desc: 'statistik sesi ini' },
  { cmd: '/connect',  desc: 'kelola MCP plugin connector' },
];

export function completer(line) {
  var cmds = SLASH_COMMANDS.map(function(c) { return c.cmd; });
  if (line.startsWith('/')) {
    var hits = cmds.filter(function(c) { return c.startsWith(line); });
    return [hits.length ? hits : cmds, line];
  }
  return [[], line];
}
