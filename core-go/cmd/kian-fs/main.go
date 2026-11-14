// Command kian-fs — bridge JSON via stdio untuk fsutil.
//
// Protokol: satu request JSON per baris di stdin, satu response JSON per baris
// di stdout. Dipakai JS (src/utils/fs.js) buat delegasi ke Go.
//
// Request:  {"op":"isSafePath","target":"x.txt"}
//           {"op":"readFileSafe","target":"x.txt"}
//           {"op":"readFileRange","target":"x.txt","offset":1,"limit":400}
//           {"op":"listDirSafe","target":"."}
//           {"op":"loadAgentMd"}
// Response: {"ok":true,"result":...} atau {"ok":false,"error":"..."}
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"

	"github.com/Kian1904/KIANNNNN/core-go/internal/diffutil"
	"github.com/Kian1904/KIANNNNN/core-go/internal/fsutil"
)

type request struct {
	Op         string `json:"op"`
	Target     string `json:"target"`
	Offset     int    `json:"offset"`
	Limit      int    `json:"limit"`
	OldContent string `json:"oldContent"`
	NewContent string `json:"newContent"`
}

func main() {
	root := os.Getenv("KIAN_WORKSPACE")
	if root == "" {
		root, _ = os.Getwd()
	}
	ws := fsutil.NewWorkspace(root)

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	for in.Scan() {
		line := in.Bytes()
		if len(line) == 0 {
			continue
		}
		var req request
		if err := json.Unmarshal(line, &req); err != nil {
			writeJSON(out, map[string]any{"ok": false, "error": "bad_json: " + err.Error()})
			continue
		}

		switch req.Op {
		case "isSafePath":
			writeJSON(out, map[string]any{"ok": true, "result": ws.IsSafePath(req.Target)})
		case "readFileSafe":
			writeJSON(out, map[string]any{"ok": true, "result": ws.ReadFileSafe(req.Target)})
		case "readFileRange":
			writeJSON(out, map[string]any{"ok": true, "result": ws.ReadFileRange(req.Target, req.Offset, req.Limit)})
		case "listDirSafe":
			writeJSON(out, map[string]any{"ok": true, "result": ws.ListDirSafe(req.Target)})
		case "loadAgentMd":
			content, found := ws.LoadAgentMd()
			writeJSON(out, map[string]any{"ok": true, "result": content, "found": found})
		case "diff":
			writeJSON(out, map[string]any{"ok": true, "result": diffutil.ShowDiff(req.OldContent, req.NewContent)})
		default:
			writeJSON(out, map[string]any{"ok": false, "error": "unknown_op: " + req.Op})
		}
	}
}

func writeJSON(w *bufio.Writer, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintln(w, `{"ok":false,"error":"marshal_failed"}`)
		w.Flush()
		return
	}
	w.Write(b)
	w.WriteByte('\n')
	w.Flush()
}
