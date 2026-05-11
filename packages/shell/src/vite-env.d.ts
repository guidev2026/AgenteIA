/// <reference types="vite/client" />

export interface SoberanoAPI {
  askSoberano: (prompt: string) => Promise<string>;
}

declare global {
  interface Window {
    api: SoberanoAPI;
  }
}