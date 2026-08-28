import 'dotenv/config';
import { startREPL } from './src/repl.js';

// Global error handler
process.on('uncaughtException', (err) => {
  console.error('\n[FATAL ERROR] Terjadi kesalahan tidak terduga:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n[FATAL REJECTION] Terjadi penolakan tidak tertangani:', reason);
  process.exit(1);
});

// Boot KIANNNNN REPL
startREPL().catch(err => {
  console.error('Boot failed:', err.message);
  process.exit(1);
});
