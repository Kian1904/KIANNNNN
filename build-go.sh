#!/usr/bin/env bash
# build-go.sh — build binary Go (core-go) ke core-go/bin/.
#
# Binary ini dipakai src/utils/fs.js buat delegasi operasi fs. Kalau binary
# tidak ada, JS otomatis fallback ke implementasi sendiri — jadi build ini
# opsional, tapi disarankan (lebih cepat + hemat RAM).
#
# Cross-compile: set GOOS/GOARCH, mis.
#   GOOS=linux GOARCH=amd64 ./build-go.sh
# Catatan: CGO_ENABLED=0 wajib buat cross-compile dari Termux (gcc-nya cuma ARM).
set -e
cd "$(dirname "$0")"

if ! command -v go >/dev/null 2>&1; then
  echo "build-go: 'go' tidak ditemukan — lewati (JS fallback tetap jalan)"
  exit 0
fi

mkdir -p core-go/bin
# go build harus dijalankan dari dalam module dir (core-go/).
(cd core-go && CGO_ENABLED=0 go build -o bin/kian-fs ./cmd/kian-fs)
echo "build-go: OK -> core-go/bin/kian-fs ($(ls -lh core-go/bin/kian-fs | awk '{print $5}'))"
