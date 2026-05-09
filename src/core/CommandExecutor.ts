import * as cp from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class CommandExecutor {
  /**
   * Executa um comando shell de forma segura usando spawn.
   * Timeout padrão de 60 segundos.
   */
  execute(
    command: string,
    args: string[] = [],
    options?: { cwd?: string; timeout?: number }
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = cp.spawn(command, args, {
        cwd: options?.cwd,
        shell: false,
        timeout: options?.timeout ?? 60_000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn "${command}": ${err.message}`));
      });

      child.on('close', (exitCode, signal) => {
        resolve({ stdout, stderr, exitCode, signal });
      });
    });
  }
}