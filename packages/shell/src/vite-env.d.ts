/// <reference types="vite/client" />

/** LogPayload — estrutura dos logs recebidos do backend via IPC. */
export interface LogPayload {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  iteration: number;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface SoberanoAPI {
  askSoberano: (prompt: string) => Promise<string>;
  /**
   * onSoberanoLog — Registra um listener para logs em tempo real
   * vindos do ReActLoop no backend.
   * Retorna função de cleanup para remover o listener.
   */
  onSoberanoLog: (callback: (payload: LogPayload) => void) => () => void;
}

declare global {
  interface Window {
    api: SoberanoAPI;
  }
}
