import { app, BrowserWindow, ipcMain, WebContents } from 'electron';
import path from 'node:path';
import { AppContext, ReActLoop, StatefulCompressor } from '@soberano/core';
import type { ReActMessage, LogPayload } from '@soberano/core';

const VITE_DEV_SERVER_URL = 'http://localhost:5173';

let appContext: AppContext | null = null;

/**
 * Diretório raiz do monorepo.
 * Em desenvolvimento (dev): __dirname = packages/shell/electron → sobe 3 níveis até a raiz
 * Em produção (packaged): app.getAppPath() retorna o diretório raiz do app,
 *   e subimos "../../" devido à estrutura packages/shell/electron.
 *
 * A lógica resolve ambos os cenários garantindo que a Sandbox do agente
 * aponte para a raiz absoluta do monorepo AgenteIA.
 */
function resolveMonorepoRoot(): string {
  if (app.isPackaged) {
    // Modo produção: app.getAppPath() retorna o diretório do app
    return path.resolve(app.getAppPath(), '../../');
  }
  // Modo desenvolvimento: __dirname = packages/shell/electron (compilado)
  return path.resolve(__dirname, '..', '..', '..');
}

const MONOREPO_ROOT = resolveMonorepoRoot();
console.log(`[Init] Monorepo root: ${MONOREPO_ROOT}`);
console.log(`[Init] app.isPackaged: ${app.isPackaged}`);
console.log(`[Init] __dirname: ${__dirname}`);

// ── Persistência de Memória (Histórico Multi-turn) ──
// Mantém o histórico entre chamadas IPC, permitindo continuidade
// na conversa com o mesmo agente.
let chatHistory: ReActMessage[] = [];

let mainWebContents: WebContents | null = null;

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

  // Armazena referência para webContents usada nos handlers IPC
  mainWebContents = win.webContents;

  const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

  if (isDev) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/**
 * Gera o system prompt dinamicamente a partir do ToolRegistry.
 *
 * Principio DRY: as definições das ferramentas são centralizadas em
 * AppContext.setupDefaultTools() e expostas via toolRegistry.getDefinitions().
 * Este builder converte a saída JSON do registry em instruções legíveis
 * pelo modelo, eliminando a duplicação manual que causava a omissão de
 * ferramentas como readDir.
 *
 * @param toolRegistryJson JSON string com as definições das ferramentas
 * @param baseDir Caminho absoluto para a raiz do monorepo (ex: /home/user/Documentos/estudos/AgenteIA)
 * @returns System prompt completo com instruções + ferramentas disponíveis
 */
function buildSystemPrompt(toolRegistryJson: string, baseDir: string): string {
  let prompt =
    'You are Soberano-Core, an AI assistant running locally via Ollama. ' +
    'You have access to tools for reading files, executing commands, and editing code.\n\n' +
    `Seu diretório base de trabalho é "${baseDir}". ` +
    'Sempre use caminhos relativos a partir deste diretório ou caminhos absolutos completos ' +
    `iniciando em "${baseDir}" para todas as operações de sistema de arquivos.\n\n` +

    // ── Autoridade Administrativa Total sobre o Monorepo ──
    `Você é o Soberano 2.0 e possui permissão administrativa total sobre o diretório "${baseDir}". ` +
    'Não peça permissão para ler ou escrever. Se receber "Acesso Negado", valide o caminho com ' +
    'readDir antes de reportar falha. Sua prioridade é autonomia total no monorepo.\n\n' +

    'You MUST respond with valid JSON in one of these two formats:\n' +
    '1. {"tool_call": "<toolName>", "args": {...}} — to call a tool and get results\n' +
    '2. {"final_response": "<your answer>"} — to give the final answer to the user\n\n' +
    'Available tools:\n';

  // Parse as definições JSON do ToolRegistry e gera lista legível
  try {
    const definitions: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: {
          type: string;
          properties: Record<string, { type: string; description: string }>;
          required: string[];
        };
      };
    }> = JSON.parse(toolRegistryJson);

    for (const def of definitions) {
      const fn = def.function;
      const params = Object.entries(fn.parameters.properties)
        .map(([key, val]) => `${key}: ${val.type}`)
        .join(', ');
      prompt += `- ${fn.name}(${params}): ${fn.description}\n`;
    }
  } catch {
    // Fallback: se o JSON estiver malformado, usa a lista crua
    prompt += toolRegistryJson;
  }

  prompt +=
    '\nAlways reason step by step. Call tools when needed, then respond with final_response. ' +
    'Be concise and accurate in your answers.';

  return prompt;
}

/**
 * checkOllamaStatus — Verifica se o motor Ollama está respondendo.
 *
 * Retorna 'online' se o endpoint /api/tags responder dentro de 5 segundos,
 * ou 'offline' em caso de falha (timeout, rede, servidor desligado).
 */
async function checkOllamaStatus(): Promise<'online' | 'offline'> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return 'online';
    }
    return 'offline';
  } catch {
    return 'offline';
  }
}

app.whenReady().then(async () => {
  // ── Inicializa o AppContext (DIP Container) ──
  // O Core não sabe que o Electron existe. A injeção é feita via bridge,
  // mantendo o desacoplamento SOLID.
  appContext = new AppContext({
    provider: { type: 'ollama', host: 'localhost', port: 11434 },
    model: 'qwen2.5-coder:7b',
    baseDir: MONOREPO_ROOT,
  });

  console.log('[IPC] AppContext initialized with Ollama provider');
  console.log(`[IPC] Model: ${appContext.model}`);
  console.log(`[IPC] Tools available: ${appContext.toolRegistry.getToolNames().length}`);
  appContext.toolRegistry.getToolNames().forEach((name: string) => {
    console.log(`  ├─ ${name}`);
  });

  // ── Constrói o system prompt dinâmico a partir do ToolRegistry ──
  // GARANTE que toda ferramenta registrada (incluindo readDir) seja
  // listada para o modelo, sem duplicação manual.
  const toolDefinitions = appContext.toolRegistry.getDefinitions();
  const SYSTEM_PROMPT = buildSystemPrompt(toolDefinitions, MONOREPO_ROOT);

  // ── IPC Handler: Ponte de Soberania ──
  // Renderer → IPC Bridge → Core (ReActLoop) → Resposta → Renderer
  ipcMain.handle('ask-soberano', async (_event, prompt: string): Promise<string> => {
    if (!appContext) {
      return 'Erro: AppContext não foi inicializado.';
    }

    console.log(`\n[IPC] Recebido prompt: "${prompt}"`);

    // ── Health-Check: Verifica se o motor Ollama está respondendo ──
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const healthResponse = await fetch('http://localhost:11434/api/tags', {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!healthResponse.ok) {
        return '⚠️ Motor Ollama desligado. Por favor, rode \'ollama serve\' para me acordar.';
      }
    } catch {
      return '⚠️ Motor Ollama desligado. Por favor, rode \'ollama serve\' para me acordar.';
    }

    console.log('[HealthCheck] Ollama está respondendo.');

    try {
      // ── Injeção do ReActLoop ──
      // StatefulCompressor: compressão inteligente do histórico via LLM
      const compressor = new StatefulCompressor(appContext.provider);

      // ReActLoop: ciclo Reasoning + Acting com suporte a ferramentas
      // ── Callback de Log: Envia logs em tempo real para o frontend ──
      // A cada iteração do ReActLoop, este callback é chamado e o log
      // é encaminhado para a janela Electron via webContents.send.
      const onLog = (payload: LogPayload): void => {
        if (mainWebContents && !mainWebContents.isDestroyed()) {
          mainWebContents.send('soberano:log', payload);
        }
      };

      const loop = new ReActLoop(
        appContext.provider,
        undefined,            // executor não necessário em JSON mode
        appContext.toolRegistry,
        undefined,            // reflector opcional
        compressor,           // compressor IContextCompressor
      );

      // ── Execução do Ciclo ReAct ──
      // Adiciona o prompt do utilizador ao histórico persistente
      chatHistory.push({ role: 'user', content: prompt });

      console.log(`[ReActLoop] Starting execution (jsonMode=true)...`);
      console.log(`[ReActLoop] Chat history size: ${chatHistory.length} messages`);

      const result = await loop.execute(
        SYSTEM_PROMPT,
        chatHistory,
        appContext.model,
        { jsonMode: true, onLog },
      );

      const answer = result.finalAnswer.trim();
      console.log(`[ReActLoop] Response received (${answer.length} chars)`);
      console.log(`[ReActLoop] Iterations: ${result.iterations}`);

      // Atualiza o histórico com as mensagens geradas pelo loop
      // Adiciona a resposta final como mensagem do assistente
      chatHistory.push({ role: 'assistant', content: answer });

      // Evita crescimento infinito do histórico: mantém no máximo 15 mensagens
      // Limite reduzido para ambiente de 12GB RAM com qwen2.5-coder:7b
      if (chatHistory.length > 15) {
        const overflow = chatHistory.length - 15;
        chatHistory = chatHistory.slice(overflow);
        console.log(`[ReActLoop] Histórico truncado (removeu ${overflow} mensagens antigas)`);
      }

      return answer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[IPC] Error: ${errorMessage}`);
      return `Erro ao processar: ${errorMessage}`;
    }
  });

  createWindow();

  // ── Health-Check Indicator: Polling do motor Ollama ──
  // A cada 10 segundos, verifica se o Ollama está respondendo e emite
  // o status em tempo real para o frontend via IPC.
  // Inicia imediatamente após a criação da janela.
  const healthInterval = setInterval(async () => {
    if (!mainWebContents || mainWebContents.isDestroyed()) {
      // Se a janela foi fechada, para o polling
      clearInterval(healthInterval);
      return;
    }

    const status = await checkOllamaStatus();
    console.log(`[HealthCheck] Status: ${status}`);
    mainWebContents.send('ollama:status', status);
  }, 10_000);

  // Executa o primeiro health-check imediatamente (sem esperar 10s)
  (async () => {
    if (!mainWebContents || mainWebContents.isDestroyed()) return;
    const status = await checkOllamaStatus();
    console.log(`[HealthCheck] Initial status: ${status}`);
    mainWebContents.send('ollama:status', status);
  })();
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