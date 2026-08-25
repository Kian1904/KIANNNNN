// lib/ui.js — TUI utilities: word wrap, header, consistent output

const B = { tl:'╭', tr:'╮', bl:'╰', br:'╯', h:'─', v:'│' };
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
  const line1 = `K-sRouter  ·  ${model}`;
  const line2 = tools && tools.length ? `tools: ${tools.join(', ')}` : null;
  console.log('');
  console.log(B.tl + B.h.repeat(width - 2) + B.tr);
  console.log(`${B.v}  ${pad(line1, width - 4)}  ${B.v}`);
  if (line2) console.log(`${B.v}  ${pad(line2, width - 4)}  ${B.v}`);
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
};

export function print(type, text = '') {
  const label = pad(LABELS[type] || String(type).toUpperCase(), LABEL_W);
  const textW = w() - LABEL_W - 5;
  const lines = wrap(String(text), textW);
  const indent = '  ' + ' '.repeat(LABEL_W + 2);
  console.log(`  ${label}  ${lines[0]}`);
  for (let i = 1; i < lines.length; i++) {
    console.log(indent + lines[i]);
  }
}

export function printBlock(text, indentN = 4) {
  const sp = ' '.repeat(indentN);
  for (const line of wrap(String(text), w() - indentN)) {
    console.log(sp + line);
  }
}

export function printList(items, currentKey = null) {
  items.forEach((item, i) => {
    const mark = item.key === currentKey ? '●' : ' ';
    console.log(`  ${mark} ${i + 1}. ${item.label}`);
  });
}

export function sep() { console.log('  ' + B.h.repeat(w() - 4)); }
export function blank() { console.log(''); }

export const PROMPT = '  │ > ';

export const SLASH_COMMANDS = [
  { cmd: '/exit',     desc: 'keluar dari K-sRouter' },
  { cmd: '/rollback', desc: 'restore file ke snapshot sebelumnya' },
  { cmd: '/model',    desc: 'switch atau lihat model aktif' },
  { cmd: '/usage',    desc: 'statistik sesi ini' },
  { cmd: '/connect',  desc: 'kelola MCP plugin connector' },
];

export function completer(line) {
  const cmds = SLASH_COMMANDS.map(c => c.cmd);
  if (line.startsWith('/')) {
    const hits = cmds.filter(c => c.startsWith(line));
    return [hits.length ? hits : cmds, line];
  }
  return [[], line];
}
