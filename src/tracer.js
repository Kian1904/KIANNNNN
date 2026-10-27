// M65: observability/tracing — trace ID per task, timeline, export.
// Written by K'

export function createTrace(input = {}) {
  return {
    taskId: input.taskId || `tr-${Date.now().toString(36)}`,
    label: input.label || '',
    events: [],
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
}

export function logEvent(trace, event = {}) {
  if (!trace) return;
  trace.events.push({ ...event, at: new Date().toISOString() });
}

export function getTraceReport(trace) {
  if (!trace) return '';
  const durations = trace.events.filter(e => typeof e.durationMs === 'number');
  const totalMs = durations.reduce((sum, e) => sum + e.durationMs, 0);
  return [
    `Trace: ${trace.taskId}${trace.label ? ` — ${trace.label}` : ''}`,
    `Events: ${trace.events.length}`,
    `Total duration: ${totalMs}ms`,
    `Started: ${trace.startedAt}`,
  ].join('\n');
}

export function exportTrace(trace) {
  return JSON.stringify(trace, null, 2);
}
