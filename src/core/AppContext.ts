/**
 * AppContext: Container de injeção de dependência (DIP).
 *
 * Dependency Inversion Principle (DIP):
 * - Módulos de ALTO nível (CLI, comandos) NÃO dependem de módulos de BAIXO nível
 *   (OllamaProvider, FileReader concretos).
 * - Ambos dependem de abstrações (IProvider, FileReader, CommandExecutor).
 * - AppContext é o "ponto de cola" onde as implementações concretas são injetadas.
 *
 * Benefícios:
 * 1. Testabilidade: nos testes unitários, podemos passar mocks/stubs
 *    no lugar das implementações reais.
 * 2. Flexibilidade: para trocar de provider (ex: Ollama → OpenRouter),
 *    basta mudar a fábrica em um único lugar.
 * 3. Configuração por flags CLI: os parâmetros (host, porta) são passados
 *    pelo AppContext, não lidos diretamente dentro do comando.
 */

import type { IProvider, IEmbedProvider } from '../providers/types';
import { FileReader } from './FileReader';
import { CommandExecutor } from './CommandExecutor';
import { ToolRegistry } from './ToolRegistry';
import { ProviderFactory } from './ProviderFactory';
import type { ProviderConfig } from './ProviderFactory';
import { SessionManager } from './SessionManager';
import { SessionStore } from './SessionStore';
import type { ReActMessage } from './rag/ReActLoop';
import { ASTEditor } from './ASTEditor';
import { SearchReplaceEditor } from './SearchReplaceEditor';

export interface AppContextConfig {
  provider: ProviderConfig;
  model?: string;
  jsonMode?: boolean;
  ragDir?: string;
  sessionId?: string;
  newSession?: boolean;
}

export class AppContext {
  public readonly fileReader: FileReader;
  public readonly commandExecutor: CommandExecutor;
  public readonly provider: IProvider;
  public readonly embedProvider: IEmbedProvider;
  public readonly toolRegistry: ToolRegistry;
  public readonly model: string;
  public readonly jsonMode: boolean;
  public readonly ragDir: string | undefined;
  public readonly sessionManager: SessionManager;

  constructor(config: AppContextConfig) {
    // Utilitários base — sempre os mesmos
    this.fileReader = new FileReader();
    this.commandExecutor = new CommandExecutor();

    // Provider via fábrica (OCP) — fácil de estender para novos providers
    this.provider = ProviderFactory.createProvider(config.provider);
    this.embedProvider = ProviderFactory.createEmbedProvider(config.provider);

    // ToolRegistry — configurado com as tools padrão
    this.toolRegistry = new ToolRegistry();
    this.setupDefaultTools();

    // Configurações de execução
    this.model = config.model ?? 'llama3.2:1b';
    this.jsonMode = config.jsonMode ?? false;
    this.ragDir = config.ragDir;

    // SessionManager — gerencia histórico da conversa multi-turn
    const store = new SessionStore();
    this.sessionManager = new SessionManager(store);

    // NOTA: initSession NÃO é chamado aqui no construtor para evitar race condition.
    // Chame app.initialize() após construir o AppContext para carregar/criar a sessão.
  }

  /**
   * Inicializa a sessão de conversa (carrega existente ou cria nova).
   *
   * Deve ser chamado após a construção do AppContext, antes de usar o sessionManager.
   * Separar do construtor evita race condition entre initSession() assíncrono
   * e addMessage() síncrono.
   *
   * @param config Configuração original passada no construtor
   */
  async initialize(config?: AppContextConfig): Promise<void> {
    const sessionId = config?.sessionId;
    const newSession = config?.newSession;
    if (!sessionId && !newSession) return; // Nada a inicializar
    await this.initSession(sessionId, newSession);
  }

  private async initSession(sessionId?: string, newSession?: boolean): Promise<void> {
    if (newSession) {
      await this.sessionManager.newSession(this.model);
    } else if (sessionId) {
      const loaded = await this.sessionManager.loadSession(sessionId);
      if (!loaded) {
        console.warn(`[AppContext] Sessão "${sessionId}" não encontrada. Criando nova.`);
        await this.sessionManager.newSession(this.model);
      }
    }
  }

  /**
   * Helper para obter o histórico de mensagens da sessão ativa.
   * Retorna array vazio se não houver sessão ativa.
   */
  getSessionHistory(): ReActMessage[] {
    return this.sessionManager.getHistory();
  }

  /**
   * Registra as tools padrão disponíveis para o ReAct loop.
   * São injetadas via DI, mas configuradas com as dependências reais.
   */
  private setupDefaultTools(): void {
    const reader = this.fileReader;
    const executor = this.commandExecutor;

    // Tool: readFile
    this.toolRegistry.register(
      'readFile',
      'Read the complete contents of a file from disk',
      {
        filePath: { type: 'string', description: 'Absolute or relative path to the file' },
      },
      async (args) => reader.readFile(args.filePath as string)
    );

    // Tool: readDir
    this.toolRegistry.register(
      'readDir',
      'List all files and directories inside a directory',
      {
        dirPath: { type: 'string', description: 'Absolute or relative path to the directory' },
      },
      async (args) => {
        const entries = await reader.readDir(args.dirPath as string);
        return entries.join('\n');
      }
    );

    // Tool: execute
    this.toolRegistry.register(
      'execute',
      'Execute a shell command safely (no shell injection). Returns stdout.',
      {
        command: { type: 'string', description: 'The executable name (e.g., ls, git, node)' },
        args: { type: 'array', description: 'Arguments as array of strings, e.g. ["-la"]' },
      },
      async (toolArgs) => {
        const cmd = toolArgs.command as string;
        const rawArgs = toolArgs.args;
        const cmdArgs: string[] = Array.isArray(rawArgs)
          ? rawArgs.map(String)
          : typeof rawArgs === 'string'
            ? rawArgs.split(' ')
            : [];
        const result = await executor.execute(cmd, cmdArgs);
        return result.stdout || result.stderr || '(no output)';
      }
    );

    // Tool: editSymbol — edição estrutural de símbolos TypeScript via AST
    this.toolRegistry.register(
      'editSymbol',
      'Replace a top-level symbol (function, class, interface, variable) in a TypeScript file by name. The symbol must exist in the file. Returns a confirmation with the symbol name and file path on success.',
      {
        filePath: { type: 'string', description: 'Absolute or relative path to the .ts file' },
        symbolName: { type: 'string', description: 'Name of the top-level symbol to replace' },
        newCode: { type: 'string', description: 'Complete new source code for the symbol' },
      },
      async (args) => {
        const filePath = args.filePath as string;
        const symbolName = args.symbolName as string;
        const newCode = args.newCode as string;
        const astEditor = new ASTEditor(reader);
        const result = await astEditor.replaceSymbol(filePath, symbolName, newCode);
        if (!result.success) {
          throw new Error(
            `editSymbol failed for symbol "${symbolName}" in "${filePath}": ${result.error}`
          );
        }
        return `OK: Symbol "${symbolName}" in "${filePath}" has been replaced successfully.`;
      }
    );

    // Tool: searchReplace — edição textual por bloco exato com normalização
    this.toolRegistry.register(
      'searchReplace',
      'Replace an exact block of text in any file. The search block is normalized (CRLF→LF, trailing whitespace removed) before matching, so small whitespace differences are tolerated. Indentation IS significant and must match exactly. Returns the full file path on success.',
      {
        filePath: { type: 'string', description: 'Absolute or relative path to the file' },
        searchBlock: { type: 'string', description: 'Exact block of text to find (indentation sensitive)' },
        replaceBlock: { type: 'string', description: 'New block of text to replace with' },
      },
      async (args) => {
        const filePath = args.filePath as string;
        const searchBlock = args.searchBlock as string;
        const replaceBlock = args.replaceBlock as string;
        const editor = new SearchReplaceEditor(reader);
        const result = await editor.apply(filePath, searchBlock, replaceBlock);
        if (!result.success) {
          if (result.matchCount === 0) {
            return 'BLOCK_NOT_FOUND: O bloco de busca não foi encontrado no arquivo. Verifique se o código está exatamente como está no arquivo.';
          }
          if (result.matchCount > 1) {
            return `AMBIGUOUS_MATCH: O bloco de busca aparece ${result.matchCount} vezes no arquivo. Forneça um bloco mais específico.`;
          }
          throw new Error(
            `searchReplace failed for "${filePath}": ${result.error}`
          );
        }
        return `OK: File "${filePath}" has been updated.`;
      }
    );

    // Tool: readFileForEdit — leitura com numeração de linhas
    this.toolRegistry.register(
      'readFileForEdit',
      'Read a file with line numbers prepended to each line. Use this tool to see the exact content with line numbers, so you can identify blocks to use with the searchReplace tool.',
      {
        filePath: { type: 'string', description: 'Absolute or relative path to the file' },
      },
      async (args) => {
        const filePath = args.filePath as string;
        const content = await reader.readFile(filePath);
        const lines = content.split('\n');

        const MAX_LINES_DISPLAY = 1000;
        const maxDisplayLines = Math.min(lines.length, MAX_LINES_DISPLAY);

        const numbered = lines.slice(0, maxDisplayLines).map((line, i) => {
          const lineNum = String(i + 1).padStart(4, ' ');
          return `${lineNum} | ${line}`;
        });

        let result = numbered.join('\n');

        if (lines.length > MAX_LINES_DISPLAY) {
          const cutCount = lines.length - MAX_LINES_DISPLAY;
          result +=
            `\n\n⚠️ ATENÇÃO: O arquivo tem ${lines.length} linhas, ` +
            `mas apenas as primeiras ${MAX_LINES_DISPLAY} foram exibidas ` +
            `(${cutCount} linhas cortadas). ` +
            `Se precisar de mais contexto, use readFile para ler o arquivo completo.`;
        }

        return result;
      }
    );
  }
}