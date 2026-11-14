// Preload module untuk `node --import <path ini>`.
// Dipakai test yang men-spawn proses dengan cwd di folder temp: bare specifier
// 'tsx' tidak akan ke-resolve dari cwd itu, tapi spesifier di file ini
// di-resolve relatif ke lokasi file (di dalam repo) → selalu ketemu.
import { register } from 'tsx/esm/api';
register();
