/** Pure formatting and history mapping for bash actions. */
export function buildBashHistory(command, result = {}, verification = {}) {
  return {
    action: 'bash',
    command,
    approved: true,
    result,
    verified: verification.ok === true,
    error: verification.ok === true ? undefined : verification.reason,
  };
}

export function formatBashOutput(command, result = {}) {
  return [
    `Command executed: ${command}`,
    `Exit code: ${result.code ?? 'unknown'}`,
    `Stdout: ${result.stdout || '(kosong)'}`,
    result.stderr ? `Stderr: ${result.stderr}` : '',
  ].filter(Boolean).join('\n');
}
