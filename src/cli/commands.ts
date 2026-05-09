import { FileReader, CommandExecutor } from '../core';
import { OllamaProvider } from '../providers';

/**
 * Estrutura que representa os argumentos parseados da linha de comando.
 *
 * Exemplo: `soberano chat "Explique SOLID" --model phi3:3b`
 *   command = "chat"
 *   args    = ["Explique SOLID"]
 *   flags   = { model: "phi3:3b" }
 */
export interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

// Instâncias singleton — criadas uma única vez e compartilhadas em todas as chamadas
const fileReader = new FileReader();
const commandExecutor = new CommandExecutor();

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
 * Cada case do switch implementa um comando:
 *   - read:  lê arquivo via FileReader.readFile()
 *   - dir:   lista diretório via FileReader.readDir()
 *   - search: busca recursiva via FileReader.searchFiles()
 *   - exec:  executa comando shell via CommandExecutor.execute()
 *   - chat:  conversa com Ollama via OllamaProvider.chat()
 *
 * @param parsed Argumentos parseados da linha de comando
 * @returns String formatada para exibição no terminal
 */
export async function runCommand(parsed: CliArgs): Promise<string> {
  switch (parsed.command) {
    /**
     * Comando: read <file>
     *
     * Pipeline:
     *   args[0] → fileReader.readFile(path) → string do conteúdo → console
     *
     * Exemplo: soberano read package.json
     * Saída: conteúdo do package.json como string
     */
    case 'read': {
      const filePath = parsed.args[0];
      if (!filePath) {
        throw new Error('Usage: soberano read <filepath>');
      }
      return fileReader.readFile(filePath);
    }

    /**
     * Comando: dir <path>
     *
     * Pipeline:
     *   args[0] (ou '.') → fileReader.readDir(path) → string[] → join('\n') → console
     *
     * Exemplo: soberano dir src
     * Saída: "cli\ncore\nproviders"
     */
    case 'dir': {
      const dirPath = parsed.args[0] || '.';
      const entries = await fileReader.readDir(dirPath);
      return entries.join('\n');
    }

    /**
     * Comando: search <dir> <pattern>
     *
     * Pipeline:
     *   args[0] (dir), args[1] (pattern) → fileReader.searchFiles(dir, pattern)
     *   → SearchResult[] → mapeia para "arquivo:linha  conteúdo" → join('\n') → console
     *
     * Exemplo: soberano search src "export"
     * Saída: "src/cli/commands.ts:4  export interface CliArgs {"
     *
     * Se não encontrar nada, retorna "No matches found."
     */
    case 'search': {
      const dirPath = parsed.args[0];
      const pattern = parsed.args[1];
      if (!dirPath || !pattern) {
        throw new Error('Usage: soberano search <directory> <pattern>');
      }
      const results = await fileReader.searchFiles(dirPath, pattern);
      if (results.length === 0) return 'No matches found.';
      return results
        .map((r) => `${r.file}:${r.line}  ${r.content}`)
        .join('\n');
    }

    /**
     * Comando: exec <cmd>
     *
     * Pipeline:
     *   args.join(' ') → rawCmd → split(' ') → [cmd, ...args]
     *   → commandExecutor.execute(cmd, args) → CommandResult
     *   → stdout ou stderr ou "(no output)" → console
     *
     * Exemplo: soberano exec "ls -la"
     * Saída: saída do comando ls -la
     *
     * ⚠️ Segurança: o comando é dividido em executável + argumentos,
     * e o CommandExecutor usa spawn com shell:false, prevenindo injeção.
     * Nota: isso significa que pipes (|), redirecionamentos (>) e outros
     * recursos de shell não funcionam — apenas comandos diretos.
     */
    case 'exec': {
      const rawCmd = parsed.args.join(' ');
      if (!rawCmd) {
        throw new Error('Usage: soberano exec <command>');
      }
      // Separa o executável dos argumentos
      // Ex: "ls -la" → cmd="ls", cmdArgs=["-la"]
      const [cmd, ...cmdArgs] = rawCmd.split(' ');
      const result = await commandExecutor.execute(cmd, cmdArgs);
      // stdout tem prioridade; se vazio, mostra stderr; senão "(no output)"
      return result.stdout || result.stderr || '(no output)';
    }

    /**
     * Comando: chat <prompt>
     *
     * Pipeline completo do fluxo de IA:
     * ┌──────────────┐
     * │ 1. args.join │  prompt ← "Explique SOLID"
     * └──────┬───────┘
     *        │
     * ┌──────▼───────┐
     * │ 2. flags     │  model ← --model phi3:3b (ou padrão)
     * │    parsing   │  host  ← --ollama localhost (ou padrão)
     * │              │  port  ← --ollama-port 11434 (ou padrão)
     * └──────┬───────┘
     *        │
     * ┌──────▼───────┐
     * │ 3. new       │  Cria instância do provider com host:port
     * │ OllamaProvider│
     * └──────┬───────┘
     *        │
     * ┌──────▼───────┐
     * │ 4. .chat()   │  Envia { model, prompt, temperature } via HTTP POST
     * │              │  para Ollama em /api/generate
     * └──────┬───────┘
     *        │
     * ┌──────▼───────┐
     * │ 5. ChatResp  │  { response: "...", model: "phi3:3b", done: true }
     * └──────┬───────┘
     *        │
     * ┌──────▼───────┐
     * │ 6. Formata   │  "[phi3:3b]\n<resposta do modelo>"
     * │    output     │
     * └──────────────┘
     *
     * Exemplo: soberano chat "Explique SOLID" --model tinyllama:1b
     * Saída: "[tinyllama:1b]\nSOLID é um acrônimo..."
     */
    case 'chat': {
      const prompt = parsed.args.join(' ');
      if (!prompt) {
        throw new Error('Usage: soberano chat <prompt>');
      }

      // Extrai configurações dos flags (ou usa defaults)
      // --model: qual modelo usar no Ollama (ex: tinyllama:1b, phi3:3b)
      const model = (parsed.flags.model as string) || 'llama3.2:1b';
      // --ollama: host onde o Ollama está rodando
      const ollamaHost = (parsed.flags.ollama as string) || 'localhost';
      // --ollama-port: porta da API do Ollama
      const ollamaPort = Number(parsed.flags['ollama-port']) || 11434;
      // --json: ativa Grammar Restraint (força resposta em JSON estrito)
      const useJson = parsed.flags.json === true;

      // Instancia o provider com as configurações do usuário
      const provider = new OllamaProvider(ollamaHost, ollamaPort);

      // System Prompt automático: injeta a instrução de JSON no prompt
      // para que o modelo Qwen 1B/3B entenda o formato esperado,
      // em conjunto com a flag format: "json" do Ollama.
      const finalPrompt = useJson
        ? `Responda estritamente em formato JSON válido.\n\n${prompt}`
        : prompt;

      // Envia o prompt ao modelo e aguarda a resposta
      const response = await provider.chat({
        model,
        prompt: finalPrompt,
        temperature: 0.7, // 0.7 = equilíbrio entre coerência e criatividade
        format: useJson ? 'json' : undefined,
      });

      // Formata a saída: cabeçalho com nome do modelo + resposta
      return `[${response.model}]\n${response.response}`;
    }

    /** Fallback: comando não reconhecido */
    default:
      throw new Error(
        `Unknown command: "${parsed.command}". Available: read, dir, search, exec, chat`
      );
  }
}