import * as tui from '../src/tui.js';

// Reset cursor dan bersihkan layar
tui.setCursorVisible(false);
tui.clearScreen();

// Contoh chat box user
const userBox = tui.agentChatBox('user', 'You', 'Halo, ada yang bisa dibantu?', false);
process.stdout.write(userBox);

// Contoh chat box assistant
const assistantBox = tui.agentChatBox('assistant', 'KIANNNNN', 'Halo! Aku KIANNNNN, asisten AI-mu. Ada yang bisa kubantu?', false);
process.stdout.write(assistantBox);

// Contoh loading animation
const load = await tui.loadingAnimation('memproses permintaan', 2000);
process.stdout.write(load);

// Contoh spinner
const spin = await tui.spinnerAnimation('menunggu respon', 2000);
process.stdout.write(spin);

tui.setCursorVisible(true);
console.log('Test selesai.');