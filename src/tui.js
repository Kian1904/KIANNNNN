/**
 * src/tui.js — Interactive Terminal UI with animations and Agent CLI-style chat box
 * Fitur:
 * - Global keyword activation: ketik "KIANNNNN" untuk membuka chat interaktif
 * - Chat box style seperti Agent CLI dengan animasi typing
 * - Real-time output updating di dalam box
 * - State chat yang maintenance per session
 * - ANSI escape codes untuk positioning dan effects
 */

export const BLANK = ' ';

// Warna ANSI
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Posisi cursor
const POS = {
  save: '\x1b[s',
  restore: '\x1b[u',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
};

// Clear screen
const CLR = '\x1b[2J';

// Move cursor
const MOV = {
  top: '\x1b[0;0H',
  // Move to row, col (1-indexed)
  pos: (r, c) => `\x1b[${r};${c}H`,
};

// Erase
const ERASE = {
  line: '\x1b[2K', // Hapus baris di bawah cursor
  screen: '\x1b[H', // Kembar ke awal
};

// Animation frames untuk typing
const ANIMATION_FRAMES = ['▌', '▌', '▌', '▏', '▏', '▏'];

// State chat
let chatState = {
  history: [],
  inputBuffer: '',
  isTyping: false,
  animationIdx: 0,
  lastUpdate: 0,
};

// Deteksi keyword KIANNNNN
const KEYWORD = 'KIANNNNN';
let keywordWatchdog = null;

/**
 * Toggle cursor visibility
 * @param {boolean} visible
 */
export function setCursorVisible(visible) {
  process.stdout.write(POS[visible ? 'show' : 'hide']);
}

/**
 * Clear screen dan reset posisikan cursor
 */
export function clearScreen() {
  process.stdout.write(CLR + MOV.top);
}

/**
 * Get terminal width
 * @returns {number}
 */
function getWidth() {
  try {
    return process.stdout.columns || 80;
  } catch {
    return 80;
  }
}

/**
 * Word wrap dengan memperhitungkan lebar terminal
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
export function wrap(text, width) {
  const tw = width || getWidth() - 10;
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

/**
 * Buat border box dengan warna
 * @param {string} title
 * @param {string[]} lines
 * @param {Object} options
 * @returns {string}
 */
export function box(title, lines, options = {}) {
  const width = getWidth();
  const color = options.color || COLORS.cyan;
  const bold = options.bold ? COLORS.bright : '';
  const bg = options.bg ? COLORS.bgBlue : '';
  const titlePad = 2;

  const boxWidth = width - 4;
  const titleLine = `${color}${bold}╭${'─'.repeat(boxWidth - 2)}╮${COLORS.reset}`;
  const titleContent = `${color}${bold}│ ${title.padEnd(boxWidth - 4)} │${COLORS.reset}`;

  const renderedLines = lines.map(line => {
    const padded = line.length > boxWidth - 4
      ? line.substring(0, boxWidth - 4)
      : line.padEnd(boxWidth - 4);
    return `${color}${bold}│ ${padded} │${COLORS.reset}`;
  });

  const bottom = `${color}${bold}╰${'─'.repeat(boxWidth - 2)}╯${COLORS.reset}`;

  return [
    titleLine,
    titleContent,
    ...renderedLines,
    bottom,
  ].join('\n');
}

/**
 * Chat box style Agent CLI
 * @param {string} role ('user' | 'assistant' | 'system')
 * @param {string} name ('KIANNNNN' | 'You')
 * @param {string} message
 * @param {boolean} animate typing
 * @returns {string}
 */
export function agentChatBox(role, name, message, animate = false) {
  const width = getWidth();
  const isAssistant = role === 'assistant';
  const userName = isAssistant ? 'KIANNNNN' : 'You';
  const assistantName = isAssistant ? 'KIANNNNN' : 'You';

  // Warna berdasarkan role
  const color = isAssistant ? COLORS.green : COLORS.cyan;
  const bg = isAssistant ? COLORS.bgGreen : COLORS.bgCyan;
  const reset = COLORS.reset;
  const bold = COLORS.bright;

  // Hapus karakter animasi typing
  const cleanMsg = message.replace(/▌/g, '').trim();

  // Pisahkan menjadi lines dengan word wrap
  const lines = wrap(cleanMsg, width - 20);

  // Animasi typing jika diminta
  let output = '';

  if (animate && chatState.isTyping) {
    // Show typing animation
    const frame = ANIMATION_FRAMES[chatState.animationIdx % ANIMATION_FRAMES.length];
    chatState.animationIdx++;

    output += `${MOV.pos(1, 1)}${CLR}`;
    output += `${bg}${bold}╭${'─'.repeat(width - 4)}╮${reset}\n`;
    output += `${bg}${bold}│ ${color}${name.padEnd(width - 6)} ${frame}${bold} │${reset}\n`;

    // Show pesan yang sedang ketik (partial)
    const partial = lines.length > 0 ? lines[0] : '';
    const displayLine = partial.length > width - 20
      ? partial.substring(0, width - 20) + '...'
      : partial;

    output += `${bg}${bold}│ ${color}${' '.repeat(userName.length + 2)}${displayLine.padEnd(width - 20 - userName.length - 2)}│${reset}\n`;

    // Show sisa lines jika ada
    for (let i = 1; i < lines.length; i++) {
      output += `${bg}${bold}│ ${' '.repeat(width - 4)} │${reset}\n`;
    }

    output += `${bg}${bold}╰${'─'.repeat(width - 4)}╯${reset}\n`;
  } else {
    // Tampilkan pesan selesai
    output += `${MOV.pos(1, 1)}${CLR}`;
    output += `${bg}${bold}╭${'─'.repeat(width - 4)}╮${reset}\n`;
    output += `${bg}${bold}│ ${color}${name.padEnd(width - 6)} │${reset}\n`;

    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i].length > width - 20
        ? lines[i].substring(0, width - 20)
        : lines[i].padEnd(width - 20);
      output += `${bg}${bold}│ ${' '.repeat(userName.length + 2)}${lineContent} │${reset}\n`;
    }

    output += `${bg}${bold}╰${'─'.repeat(width - 4)}╯${reset}\n`;
  }

  return output;
}

/**
 * Typing animation effect
 * @param {string} message
 * @param {number} speed ms per frame
 * @returns {Promise<string>}
 */
export async function typingAnimation(message, speed = 50) {
  chatState.isTyping = true;
  chatState.animationIdx = 0;

  const width = getWidth();
  const lines = wrap(message, width - 20);
  let output = '';

  // Clear area dan show typing cursor
  output += `${MOV.pos(1, 1)}${CLR}`;

  for (let i = 0; i < lines.length; i++) {
    // Show frame animasi
    const frame = ANIMATION_FRAMES[chatState.animationIdx % ANIMATION_FRAMES.length];
    chatState.animationIdx++;

    output += `${COLORS.bgGreen}${COLORS.bright}╭${'─'.repeat(width - 4)}╮${COLORS.reset}\n`;
    output += `${COLORS.bgGreen}${COLORS.bright}│ ${COLORS.green}KIANNNNN${COLORS.bright} ${frame}${COLORS.reset}\n`;

    // Partial line dengan cursor
    const partial = lines[i].length > width - 20
      ? lines[i].substring(0, width - 20) + '...'
      : lines[i];

    output += `${COLORS.bgGreen}${COLORS.bright}│ ${' '.repeat(9)}${partial.padEnd(width - 20)} ${frame}${COLORS.reset}\n`;
    output += `${COLORS.bgGreen}${COLORS.bright}╰${'─'.repeat(width - 4)}╯${COLORS.reset}\n`;

    // Update setelah delay
    await new Promise(resolve => setTimeout(resolve, speed));
  }

  chatState.isTyping = false;
  return output;
}

/**
 * Render chat history ke dalam box
 * @param {Array} messages [{role, content}]
 * @returns {string}
 */
export function renderChatHistory(messages) {
  const width = getWidth();
  let output = '';

  // Clear screen
  output += `${CLR}${MOV.top}`;

  // Header
  output += `${COLORS.cyan}${COLORS.bold}╭${'─'.repeat(width - 4)}╮${COLORS.reset}\n`;
  output += `${COLORS.cyan}${COLORS.bold}│ ${'KIANNNNN CLI'.padEnd(width - 6)} │${COLORS.reset}\n`;
  output += `${COLORS.cyan}${COLORS.bold}│ ${'Ketik KIANNNNN untuk chat'.padEnd(width - 6)} │${COLORS.reset}\n`;
  output += `${COLORS.cyan}${COLORS.bold}╰${'─'.repeat(width - 4)}╯${COLORS.reset}\n`;
  output += '\n';

  // Chat area
  const chatWidth = width - 4;

  messages.forEach((msg, i) => {
    const role = msg.role;
    const content = msg.content || '';

    if (role === 'user') {
      output += agentChatBox('user', 'You', content, false);
    } else if (role === 'assistant') {
      output += agentChatBox('assistant', 'KIANNNNN', content, false);
    }

    // Add small gap between messages
    if (i < messages.length - 1) {
      output += '\n';
    }
  });

  // Input bar di bawah
  output += `${MOV.pos(1, 1)}`;
  output += `${COLORS.bgBlack}${COLORS.white}  KIANNNNN > ${BLANK.repeat(width - 12)} ${COLORS.reset}\n`;

  return output;
}

/**
 * Fitur: Global keyword watcher
 * Mendeteksi ketika user mengetik "KIANNNNN" untuk membuka chat interaktif
 */
export function startKeywordWatcher() {
  if (keywordWatchdog) {
    clearInterval(keywordWatchdog);
  }

  keywordWatchdog = setInterval(() => {
    // Cek apakah ada input yang menunggu (non-blocking check)
    // Di Termux, kita bisa cek process.stdin.available
    // Namun, yang lebih sederhana: kita konfigurasikan /clear /reset sebagai trigger
    // atau kita lihat ada input baru dari readline
  }, 100);
}

/**
 * Stop keyword watcher
 */
export function stopKeywordWatcher() {
  if (keywordWatchdog) {
    clearInterval(keywordWatchdog);
    keywordWatchdog = null;
  }
}

/**
 * Animasi loading real-time
 * @param {string} message
 * @param {number} duration ms
 * @returns {Promise<string>}
 */
export async function loadingAnimation(message, duration = 3000) {
  const start = Date.now();
  let output = '';

  while (Date.now() - start < duration) {
    const elapsed = Date.now() - start;
    const progress = Math.min(Math.floor((elapsed / duration) * 10), 9);
    const bar = '█'.repeat(progress) + '░'.repeat(10 - progress);
    const percent = Math.floor((elapsed / duration) * 100);

    output = `${MOV.pos(1, 1)}${CLR}`;
    output += `${COLORS.bgBlue}${COLORS.white}  Memproses ${message} [${bar}] ${percent}% ${COLORS.reset}\n`;
    output += `${MOV.pos(1, 1)}`;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Clear bar
  output += `${CLR}${MOV.top}`;

  return output;
}

/**
 * Progress spinner animasi
 * @param {string} message
 * @param {number} duration ms
 * @returns {Promise<string>}
 */
export async function spinnerAnimation(message, duration = 3000) {
  const frames = ['|', '/', '-', '\\'];
  let idx = 0;
  const start = Date.now();
  let output = '';

  while (Date.now() - start < duration) {
    const elapsed = Date.now() - start;
    const percent = Math.min(Math.floor((elapsed / duration) * 100), 100);

    output = `${MOV.pos(1, 1)}${CLR}`;
    output += `${COLORS.bgCyan}${COLORS.white}  ${message} ${frames[idx]} ${percent}% ready${COLORS.reset}\n`;
    output += `${MOV.pos(1, 1)}`;

    idx = (idx + 1) % frames.length;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  output += `${CLR}${MOV.top}`;
  return output;
}

// Exports done via individual export statements.