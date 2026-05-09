import * as cp from 'node:child_process';

/**
 * Resultado da execução de um comando shell.
 * Contém as saídas stdout/stderr, código de saída e sinal (se houve).
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * CommandExecutor: Camada de abstração sobre child_process.spawn do Node.js.
 *
 * Fluxo de dados:
 * CLI ──(cmd+args)──▶ execute() ──(spawn)──▶ processo filho ──(stdout/stderr streams)──▶ CommandResult
 *
 * Diferente de exec() que bufferiza tudo em memória, spawn() trabalha com streams,
 * o que é mais seguro para comandos com saída longa e permite timeout nativo.
 *
 * shell: false → previne injeção de comandos (não passa pelo interpretador shell).
 */
export class CommandExecutor {
  /**
   * Executa um comando de forma segura e assíncrona.
   *
   * Pipeline:
   *   1. cp.spawn(command, args, options) → cria processo filho
   *   2. Escuta stdout (child.stdout.on('data')) → acumula chunks Buffer
   *   3. Escuta stderr (child.stderr.on('data')) → acumula chunks Buffer
   *   4. child.on('error') → rejeita Promise se o spawn falhar
   *   5. child.on('close') → resolve Promise com stdout/stderr/exitCode
   *   6. Timeout (padrão 60s) → encerra o processo automaticamente
   *
   * Segurança:
   *   - shell: false → o comando é executado diretamente, sem interpretador.
   *     Ex: execute('ls', ['-la']) → spawn('ls', ['-la'])
   *     Isso evita vulnerabilidades como injeção de shell (ex: 'file; rm -rf /').
   *   - timeout → evita processos zumbi.
   *
   * @param command  Nome do executável (ex: 'ls', 'git', 'node')
   * @param args     Argumentos do comando como array de strings
   * @param options  Opções: cwd (working directory), timeout (ms)
   * @returns Promise com stdout, stderr, exitCode e signal
   */
  execute(
    command: string,
    args: string[] = [],
    options?: { cwd?: string; timeout?: number }
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // spawn: cria o processo filho sem shell intermediário
      const child = cp.spawn(command, args, {
        cwd: options?.cwd,
        shell: false, // Sem shell → sem injeção de comandos
        timeout: options?.timeout ?? 60_000, // 60 segundos padrão
      });

      let stdout = '';
      let stderr = '';

      // stdout: saída padrão do processo
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // stderr: saída de erro do processo (logs, erros, etc.)
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 'error': falha ao criar o processo (comando inexistente, permissão, etc.)
      child.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn "${command}": ${err.message}`));
      });

      // 'close': processo terminou (normalmente, por timeout ou por sinal)
      child.on('close', (exitCode, signal) => {
        resolve({ stdout, stderr, exitCode, signal });
      });
    });
  }
}