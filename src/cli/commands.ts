/**
 * commands.ts — Roteador de comandos CLI com Injeção de Dependência (DIP).
 *
 * Fluxo:
 *   parseArgs (index.ts) → CliArgs → buildContext() → AppContext
 *   ↓
 *   runCommand() usa AppContext para acessar:
 *     - fileReader, commandExecutor, provider, toolRegistry
 *
 * DIP: Nenhum comando instancia diretamente FileReader, OllamaProvider, etc.
 *       Tudo é injetado via AppContext → ProviderFactory → interfaces.
 */

import { AppContext } from '../core';
import { StreamStrategy, ReActStrategy } from './strategies';

/**
 * Estrutura que representa os argumentos parseados da linha de comando.
 *
 * Exemplo: `soberano chat "Explique SOLID" --model phi3:3b`
 *   command = "chat"
 *   args    = ["Explique SOLID"]
 *   flags   = { model: "phi3:3b" }
 *
 * Flags booleanas:
 *   --json     → ativa tool_call/final_response em JSON
 *   --stream   → ativa streaming SSE (efeito máquina de escrever)
 *   --no-think → desativa o indicador "pensando..." (útil para scripting)
 *   --reflect  → ativa Reflector (auto-revisão) na resposta final
 */
export interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Cria o AppContext (container DI) a partir dos argumentos CLI parseados.
 *
 * DIP (Dependency Inversion Principle):
 * - AppContext gerencia a criação e injeção de TODAS as dependências.
 * - O comando não instancia diretamente providers, readers ou executors.
 * - Basta mudar o AppContextConfig para trocar de provider ou config.
 *
 * Flags de sessão:
 *   --session <id>    → carrega uma sessão existente pelo UUID
 *   --new-session     → força a criação de uma nova sessão (ignora --session)
 */
function buildContext(parsed: CliArgs): AppContext {
  const model = (parsed.flags.model as string) || 'llama3.2:1b';
  const ollamaHost = (parsed.flags.ollama as string) || 'localhost';
  const ollamaPort = Number(parsed.flags['ollama-port']) || 11434;
  const jsonMode = parsed.flags.json === true;
  const ragDir = parsed.flags.rag as string | undefined;
  const sessionId = parsed.flags.session as string | undefined;
  const newSession = parsed.flags['new-session'] === true;

  return new AppContext({
    provider: {
      type: 'ollama',
      host: ollamaHost,
      port: ollamaPort,
    },
    model,
    jsonMode,
    ragDir,
    sessionId,
    newSession,
  });
}

// Cache do contexto — construído uma vez por execução CLI
let ctx: AppContext | null = null;

function getContext(parsed: CliArgs): AppContext {
  if (!ctx) {
    ctx = buildContext(parsed);
  }
  return ctx;
}

/**
 * Função central de roteamento da CLI.
 *
 * Fluxo geral de dados:
 * ┌──────────┐    CliArgs     ┌──────────────────┐    comando     ┌─────────────────┐
 * │  index.ts│ ── parse ──▶  │  runCommand()     │ ── switch ──▶ │  FileReader /   │
 * │ (argv)   │              │                    │              │  CmdExecutor /  │
 * └──────────┘              └──────────────────┘              │  OllamaProvider │
 *                                    │                        └─────────────────┘
 *                                    │ string (output)
 *                                    ▼
 *                              ┌──────────┐
 *                              │  console │
 *                              └──────────┘
 *
 * @param parsed Argumentos parseados da linha de comando
 * @returns String formatada para exibição no terminal
 */
export async function runCommand(parsed: CliArgs): Promise<string> {
  const app = getContext(parsed);

  switch (parsed.command) {
    /**
     * Comando: read <file>
     * Exemplo: soberano read package.json
     */
    case 'read': {
      const filePath = parsed.args[0];
      if (!filePath) {
        throw new Error('Usage: soberano read <filepath>');
      }
      return app.fileReader.readFile(filePath);
    }

    /**
     * Comando: dir <path>
     * Exemplo: soberano dir src
     */
    case 'dir': {
      const dirPath = parsed.args[0] || '.';
      const entries = await app.fileReader.readDir(dirPath);
      return entries.join('\n');
    }

    /**
     * Comando: search <dir> <pattern>
     * Exemplo: soberano search src "export"
     */
    case 'search': {
      const dirPath = parsed.args[0];
      const pattern = parsed.args[1];
      if (!dirPath || !pattern) {
        throw new Error('Usage: soberano search <directory> <pattern>');
      }
      const results = await app.fileReader.searchFiles(dirPath, pattern);
      if (results.length === 0) return 'No matches found.';
      return results
        .map((r) => `${r.file}:${r.line}  ${r.content}`)
        .join('\n');
    }

    /**
     * Comando: exec <cmd>
     * Exemplo: soberano exec "ls -la"
     *
     * ⚠️ Segurança: o comando é dividido em executável + argumentos,
     * e o CommandExecutor usa spawn com shell:false, prevenindo injeção.
     */
    case 'exec': {
      const rawCmd = parsed.args.join(' ');
      if (!rawCmd) {
        throw new Error('Usage: soberano exec <command>');
      }
      const [cmd, ...cmdArgs] = rawCmd.split(' ');
      const result = await app.commandExecutor.execute(cmd, cmdArgs);
      return result.stdout || result.stderr || '(no output)';
    }

    /**
     * Comando: chat <prompt>
     *
     * Pipeline com suporte a dois modos:
     *   - StreamStrategy: streaming direto (efeito máquina de escrever, sem ReAct)
     *   - ReActStrategy: ReAct Loop (com ou sem streaming pós-resposta)
     *
     * OCP (Open-Closed Principle): Novos modos de chat são adicionados criando
     * novas classes que implementam ChatStrategy, sem modificar este case.
     *
     * Flags:
     *   --stream   → ativa streaming SSE (efeito máquina de escrever)
     *   --json     → ativa tool_call/final_response em JSON (força ReAct)
     *   --no-think → desativa o indicador "pensando..." (útil para scripting)
     *
     * Exemplos:
     *   soberano chat "Explique SOLID" --model phi3:3b --stream
     *   soberano chat "Qual o conteúdo do package.json?" --json
     *   soberano chat "Liste os arquivos" --stream --no-think
     */
    case 'chat': {
      const prompt = parsed.args.join(' ');
      if (!prompt) {
        throw new Error('Usage: soberano chat <prompt>');
      }

      const streamMode = parsed.flags.stream === true;
      const noThink = parsed.flags['no-think'] === true;
      const reflectMode = parsed.flags.reflect === true;

      // Adiciona a mensagem do usuário ao histórico da sessão
      await app.sessionManager.addMessage({ role: 'user', content: prompt }, app.model);

      // Estratégia: decide qual pipeline executar
      // - streaming direto: quando --stream está ativo, --json NÃO está, e provider suporta
      // - ReAct: quando --json está ativo OU streaming não é suportado
      const useStreamDirect = streamMode && !app.jsonMode && app.provider.streamChat;

      const strategy = useStreamDirect
        ? new StreamStrategy()
        : new ReActStrategy();

      const result = await strategy.execute({
        app,
        prompt,
        streamMode,
        noThink,
        reflectMode,
      });

      // Adiciona a resposta do assistente ao histórico e persiste
      await app.sessionManager.addMessage({ role: 'assistant', content: result }, app.model);
      await app.sessionManager.flush();

      return result;
    }

    /**
     * Comando: sessions
     * Exemplo: soberano sessions
     *
     * Lista todas as sessões de conversa salvas, ordenadas por
     * última atualização (mais recentes primeiro).
     */
    case 'sessions': {
      const summaries = await app.sessionManager.listSessions();

      if (summaries.length === 0) {
        return 'Nenhuma sessão encontrada.';
      }

      const lines = summaries.map((s) => {
        const date = new Date(s.updatedAt).toLocaleString('pt-BR');
        const title = s.title ?? '(sem título)';
        const sessionLabel = s.id.substring(0, 8) + '...';
        return `  ${sessionLabel}  ${date}  [${s.messageCount} msgs]  ${title}`;
      });

      return 'Sessões disponíveis:\n' + lines.join('\n');
    }

    /** Fallback: comando não reconhecido */
    default:
      throw new Error(
        `Unknown command: "${parsed.command}". ` +
        'Available: read, dir, search, exec, chat, sessions'
      );
  }
}