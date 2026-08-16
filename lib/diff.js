export function showDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const out = [];

  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      out.push(`  ${o ?? ''}`);
    } else {
      if (o !== undefined) out.push(`- ${o}`);
      if (n !== undefined) out.push(`+ ${n}`);
    }
  }
  return out.join('\n');
}
