import { contextBridge, ipcRenderer } from 'electron';

/**
 * LogPayload — estrutura dos logs recebidos do backend via IPC.
 */
interface LogPayload {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  iteration: number;
  timestamp: string;
  data?: Record<string, unknown>;
}

const api = {
  askSoberano: (prompt: string): Promise<string> => {
    return ipcRenderer.invoke('ask-soberano', prompt);
  },

  /**
   * onSoberanoLog — Registra um listener para logs em tempo real
   * vindos do ReActLoop no backend.
   *
   * Uso no frontend:
   *   window.api.onSoberanoLog((payload) => {
   *     console.log(payload.message);
   *   });
   *
   * Retorna uma função de cleanup para remover o listener.
   */
  onSoberanoLog: (callback: (payload: LogPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: LogPayload): void => {
      callback(payload);
    };
    ipcRenderer.on('soberano:log', handler);

    // Retorna função de cleanup para desinscrever
    return () => {
      ipcRenderer.removeListener('soberano:log', handler);
    };
  },

  /**
   * onOllamaStatus — Registra um listener para o status do motor Ollama.
   *
   * Uso no frontend:
   *   const cleanup = window.api.onOllamaStatus((status) => {
   *     setIsOnline(status === 'online');
   *   });
   *
   * Retorna uma função de cleanup para remover o listener.
   */
  onOllamaStatus: (callback: (status: 'online' | 'offline') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: 'online' | 'offline'): void => {
      callback(status);
    };
    ipcRenderer.on('ollama:status', handler);

    return () => {
      ipcRenderer.removeListener('ollama:status', handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
