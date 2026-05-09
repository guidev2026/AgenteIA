import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandExecutor } from '../../../src/core/CommandExecutor';

/**
 * Testes unitários para CommandExecutor.
 *
 * Mock completo do módulo nativo `node:child_process` → zero execuções reais.
 * Zero consumo de CPU, zero I/O, zero risco de segurança.
 */

// Mock dos eventos do child_process
type EventHandler = (...args: any[]) => void;
const eventHandlers = new Map<string, EventHandler[]>();

function emit(event: string, ...args: any[]) {
  const handlers = eventHandlers.get(event) || [];
  handlers.forEach((h) => h(...args));
}

vi.mock('node:child_process', () => {
  const mockProcess = {
    stdout: {
      on: (_event: string, handler: EventHandler) => {
        eventHandlers.set('stdout:data', [handler]);
      },
    },
    stderr: {
      on: (_event: string, handler: EventHandler) => {
        eventHandlers.set('stderr:data', [handler]);
      },
    },
    on: (event: string, handler: EventHandler) => {
      const existing = eventHandlers.get(event) || [];
      existing.push(handler);
      eventHandlers.set(event, existing);
    },
  };

  const spawn = (_cmd: string, _args: string[], _opts: any) => mockProcess;
  return { spawn };
});

describe('CommandExecutor', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    eventHandlers.clear();
    executor = new CommandExecutor();
  });

  it('executa comando com sucesso e retorna stdout', async () => {
    const resultPromise = executor.execute('echo', ['hello']);

    // Simula dados no stdout
    const stdoutHandlers = eventHandlers.get('stdout:data') || [];
    stdoutHandlers.forEach((h) => h(Buffer.from('hello\n')));

    // Simula fechamento do processo com exitCode 0
    const closeHandlers = eventHandlers.get('close') || [];
    closeHandlers.forEach((h) => h(0, null));

    const result = await resultPromise;

    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('captura stderr corretamente', async () => {
    const resultPromise = executor.execute('bad-command');

    // Emite stderr
    const stderrHandlers = eventHandlers.get('stderr:data') || [];
    stderrHandlers.forEach((h) => h(Buffer.from('error: not found')));

    // Fecha com exitCode 1
    const closeHandlers = eventHandlers.get('close') || [];
    closeHandlers.forEach((h) => h(1, null));

    const result = await resultPromise;
    expect(result.stderr).toBe('error: not found');
    expect(result.exitCode).toBe(1);
  });

  it('rejeita com erro se spawn falhar', async () => {
    const resultPromise = executor.execute('nonexistent');

    // Emite erro de spawn
    const errorHandlers = eventHandlers.get('error') || [];
    errorHandlers.forEach((h) => h(new Error('ENOENT: command not found')));

    await expect(resultPromise).rejects.toThrow(/Failed to spawn/);
  });
});