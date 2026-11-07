#!/data/data/com.termux/files/usr/bin/bash
# run-suite.sh — jalankan SEMUA test .mjs di tests/ dan rekap hasilnya.
# Sengaja gak ada runner eksternal (jest/vitest) — KIANNNNN zero-dep.
cd "$(dirname "$0")" || exit 1

total_pass=0
total_fail=0
files=0
failed_files=""
skipped_files=""

for f in tests/test-*.mjs; do
  raw=$(node "$f" 2>&1)
  code=$?
  out=$(printf '%s\n' "$raw" | grep -v "^\[telegram-bot\]")
  line=$(printf '%s\n' "$out" | grep -oE "[0-9]+ pass, [0-9]+ fail" | tail -1)
  p=$(printf '%s' "$line" | grep -oE "^[0-9]+")
  fl=$(printf '%s' "$line" | grep -oE "[0-9]+ fail" | grep -oE "^[0-9]+")
  [ -z "$p" ] && p=0
  [ -z "$fl" ] && fl=0

  files=$((files + 1))
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + fl))

  if [ "$code" -ne 0 ]; then
    if printf '%s\n' "$out" | grep -qiE 'skip|skipped|environment|not configured|belum di-set|tidak tersedia'; then
      skipped_files="$skipped_files $f(exit=$code)"
      printf 'skip %-34s %s pass, %s fail\n' "$(basename "$f")" "$p" "$fl"
    else
      failed_files="$failed_files $f(exit=$code)"
      printf 'FAIL %-34s %s pass, %s fail\n' "$(basename "$f")" "$p" "$fl"
      printf '%s\n' "$out" | grep -E '^  ✗' | head -8
    fi
  else
    printf 'ok   %-34s %s pass, %s fail\n' "$(basename "$f")" "$p" "$fl"
  fi
done

echo ""
echo "=== TOTAL: $total_pass pass, $total_fail fail | $files file ==="
[ -n "$failed_files" ] && echo "FILE GAGAL:$failed_files"
[ -n "$skipped_files" ] && echo "FILE SKIP:$skipped_files"
[ -n "$failed_files" ] && exit 1 || exit 0
