import { contextBridge, ipcRenderer } from 'electron';

const api = {
  askSoberano: (prompt: string): Promise<string> => {
    return ipcRenderer.invoke('ask-soberano', prompt);
  },
};

contextBridge.exposeInMainWorld('api', api);
