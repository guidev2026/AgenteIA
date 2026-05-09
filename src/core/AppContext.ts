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

export interface AppContextConfig {
  provider: ProviderConfig;
  model?: string;
  jsonMode?: boolean;
  ragDir?: string;
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
  }
}