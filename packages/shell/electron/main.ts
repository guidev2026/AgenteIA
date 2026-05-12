import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { AppContext } from '@soberano/core';
import type { ReActMessage } from '@soberano/core';

const VITE_DEV_SERVER_URL = 'http://localhost:5173';

let appContext: AppContext | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Soberano-Core',
    backgroundColor: '#0a0a0a',
    show: false,
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

  if (isDev) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  // ── Inicializa o AppContext (DIP Container) ──
  // O Core não sabe que o Electron existe. A injeção é feita via bridge,
  // mantendo o desacoplamento SOLID.
  appContext = new AppContext({
    provider: { type: 'ollama', host: 'http://localhost:11434' },
    model: 'llama3.2:1b',
  });

  console.log('[IPC] AppContext initialized with Ollama provider');
  console.log(`[IPC] Model: ${appContext.model}`);
  console.log(`[IPC] Tools available: ${appContext.toolRegistry.getToolNames().length}`);
  appContext.toolRegistry.getToolNames().forEach((name: string) => {
    console.log(`  ├─ ${name}`);
  });

  // ── IPC Handler: Ponte de Soberania ──
  // Renderer → IPC Bridge → Core (ReActLoop) → Resposta → Renderer
  ipcMain.handle('ask-soberano', async (_event, prompt: string): Promise<string> => {
    if (!appContext) {
      return 'Erro: AppContext não foi inicializado.';
    }

    console.log(`\n[IPC] Recebido prompt: "${prompt}"`);

    try {
      // Monta o histórico com o prompt do usuário
      const history: ReActMessage[] = [
        { role: 'user', content: prompt },
      ];

      // System prompt enxuto para o shell
      const systemPrompt =
        'You are Soberano-Core, an AI assistant running locally via Ollama. ' +
        'Answer the user\'s question concisely and accurately. ' +
        'You have access to tools for reading files, executing commands, and editing code. ' +
        'Use them when needed to fulfill the user\'s request.';

      // Executa o ReActLoop em modo texto (sem JSON) para respostas diretas
      console.log(`[ReActLoop] Starting execution...`);
      const result = await appContext.provider.chat({
        model: appContext.model,
        prompt: `${systemPrompt}\n\n[USER]: ${prompt}`,
        temperature: 0.3,
      });

      const answer = result.response.trim();
      console.log(`[ReActLoop] Response received (${answer.length} chars)`);
      console.log(`[ReActLoop] Iterations: 1`);

      return answer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[IPC] Error: ${errorMessage}`);
      return `Erro ao processar: ${errorMessage}`;
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});