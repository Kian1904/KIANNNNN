import { callTool } from '../../../mcp/client.js';

export async function executeMcp(tool, args, tools, deps = {}) {
  return (deps.callTool || callTool)(tool, args, tools);
}
