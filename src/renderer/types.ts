/** Tipe state squad untuk layer TUI (dipisah dari core JS). */
export type AgentStatus = 'pending' | 'running' | 'done' | 'error';

export interface SquadAgent {
  id: string | number;
  role: string;
  status: AgentStatus;
  error?: string;
}

export interface SquadState {
  task?: string;
  currentWave?: number | string;
  evidence?: number;
  agents: SquadAgent[];
}
