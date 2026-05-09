import { FileReader, CommandExecutor } from '../core';
import { OllamaProvider } from '../providers';

export interface CliArgs {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const fileReader = new FileReader();
const commandExecutor = new CommandExecutor();

export async function runCommand(parsed: CliArgs): Promise<string> {
  switch (parsed.command) {
    case 'read': {
      const filePath = parsed.args[0];
      if (!filePath) {
        throw new Error('Usage: soberano read <filepath>');
      }
      return fileReader.readFile(filePath);
    }

    case 'dir': {
      const dirPath = parsed.args[0] || '.';
      const entries = await fileReader.readDir(dirPath);
      return entries.join('\n');
    }

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

    case 'exec': {
      const rawCmd = parsed.args.join(' ');
      if (!rawCmd) {
        throw new Error('Usage: soberano exec <command>');
      }
      // Divide o comando em nome + argumentos
      const [cmd, ...cmdArgs] = rawCmd.split(' ');
      const result = await commandExecutor.execute(cmd, cmdArgs);
      return result.stdout || result.stderr || '(no output)';
    }

    case 'chat': {
      const prompt = parsed.args.join(' ');
      if (!prompt) {
        throw new Error('Usage: soberano chat <prompt>');
      }

      const model = (parsed.flags.model as string) || 'phi3:3b';
      const ollamaHost = (parsed.flags.ollama as string) || 'localhost';
      const ollamaPort = Number(parsed.flags['ollama-port']) || 11434;

      const provider = new OllamaProvider(ollamaHost, ollamaPort);

      const response = await provider.chat({
        model,
        prompt,
        temperature: 0.7,
      });

      return `[${response.model}]\n${response.response}`;
    }

    default:
      throw new Error(
        `Unknown command: "${parsed.command}". Available: read, dir, search, exec, chat`
      );
  }
}