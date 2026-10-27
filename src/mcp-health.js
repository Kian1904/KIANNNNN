// M66: MCP production layer — health check, config validation.
// Written by K'

export function validateServerConfig(config = {}) {
  const errors = [];
  if (!config.name || !String(config.name).trim()) errors.push('name kosong');
  if (!config.url || !String(config.url).trim()) errors.push('url kosong');
  if (config.url && !/^https?:\/\//.test(String(config.url))) errors.push('url harus http/https');
  return { valid: errors.length === 0, errors };
}

export async function healthCheck(server = {}) {
  const config = validateServerConfig(server);
  if (!config.valid) {
    return { name: server.name || '?', status: 'down', error: config.errors.join('; ') };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), server.timeout || 5000);
    const res = await fetch(server.url, { signal: controller.signal, method: 'GET' });
    clearTimeout(timer);
    return { name: server.name, status: res.ok ? 'up' : 'down', httpStatus: res.status };
  } catch (err) {
    return { name: server.name, status: 'down', error: err.message };
  }
}

export function formatHealthReport(results = []) {
  return results.map(r => {
    const icon = r.status === 'up' ? '✓' : '✗';
    return `${icon} ${r.name}: ${r.status}${r.error ? ` (${r.error})` : ''}`;
  }).join('\n');
}
