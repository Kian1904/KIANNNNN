/** Pure web search/fetch fallback planning helpers. */
export function collectUrls(history = []) {
  const urls = [];
  for (const item of Array.isArray(history) ? history : []) {
    if (item?.action !== 'web_search') continue;
    for (const url of String(item.summary || '').match(/https?:\/\/[^\s)]+/g) || []) {
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

export function chooseOfficialUrl(urls = []) {
  const list = Array.isArray(urls) ? urls : [];
  return list.find(url => /bmkg\.go\.id|\.gov\.|\.go\.id\//i.test(url)) || list[0] || null;
}

export function buildForcedResearchPrompt(instruction, evidence) {
  return `${instruction}\n\n[SISTEM: Kamu sudah mencapai batas pencarian web. WAJIB ACTION: done sekarang. Tulis SUMMARY singkat dari evidence data yang sudah ada. Evidence terstruktur:\n${evidence}\nDILARANG ACTION: web_search atau ACTION: mcp_call apapun di langkah ini.]`;
}
