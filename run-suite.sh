#!/data/data/com.termux/files/usr/bin/bash
# run-suite.sh — jalankan SEMUA test .mjs di tests/ dan rekap hasilnya.
# Sengaja gak ada runner eksternal (jest/vitest) — KIANNNNN zero-dep.
cd "$(dirname "$0")" || exit 1

total_pass=0
total_fail=0
files=0
failed_files=""

for f in tests/test-*.mjs; do
  out=$(node "$f" 2>&1 | grep -v "^\[telegram-bot\]")
  code=$?
  line=$(printf '%s\n' "$out" | grep -oE "[0-9]+ pass, [0-9]+ fail" | tail -1)
  p=$(printf '%s' "$line" | grep -oE "^[0-9]+")
  fl=$(printf '%s' "$line" | grep -oE "[0-9]+ fail" | grep -oE "^[0-9]+")
  [ -z "$p" ] && p=0
  [ -z "$fl" ] && fl=0

  files=$((files + 1))
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + fl))

  if [ "$code" -ne 0 ]; then
    failed_files="$failed_files $f(exit=$code)"
    printf 'FAIL %-34s %s pass, %s fail\n' "$(basename "$f")" "$p" "$fl"
    printf '%s\n' "$out" | grep -E "^  ✗" | head -8
  else
    printf 'ok   %-34s %s pass, %s fail\n' "$(basename "$f")" "$p" "$fl"
  fi
done

echo ""
echo "=== TOTAL: $total_pass pass, $total_fail fail | $files file ==="
[ -n "$failed_files" ] && echo "FILE GAGAL:$failed_files"
[ "$total_fail" -eq 0 ] && exit 0 || exit 1
