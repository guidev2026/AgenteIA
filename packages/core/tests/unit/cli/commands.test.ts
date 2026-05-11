/**
 * commands.test.ts — Testes unitários para o roteador de comandos CLI.
 *
 * Cobertura:
 * - Comandos individuais: read, dir, search, exec, chat
 * - Modos: normal e stream
 * - Erros: prompt vazio, comando desconhecido, falta de argumentos
 * - Sessões: listagem, addMessage, flush (multi-turn)
 *
 * Arquitetura:
 *   runCommand() recebe CliArgs parseados e usa AppContext.
 *   Para testar, mockamos AppContext com um provider mock que suporta streamChat.
 *
 * IMPORTANTE:
 *   vi.mock() é HOISTED para o topo do arquivo. Tudo que as factories precisam
 *   referenciar deve ser criado via vi.hoisted().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════
// Estado compartilhado (vi.hoisted → NÃO é hoisted, executado antes)
// ═══════════════════════════════════════════════════════════════════════

const { mockState, mockProvider, MockAppContext, MockStreamStrategy, MockReActStrategy, mockSessionManager } =
  vi.hoisted(() => {
    // ── Objetos mock ──
    const mp: Record<string, unknown> = {
      chat: () => Promise.resolve({ response: 'mock chat response' }),
    };
    // streamChat como async generator
    Object.defineProperty(mp, 'streamChat', {
      value: async function* () {
        yield 'mock ';
        yield 'stream ';
        yield 'response';
      },
      writable: true,
      configurable: true,
    });

    const ms = {
      fileReader: {
        readFile: () => Promise.resolve('file content mock'),
        readDir: () => Promise.resolve(['file1.ts', 'file2.ts']),
        searchFiles: () =>
          Promise.resolve([
            { file: 'src/test.ts', line: 10, content: 'export const x = 1' },
          ]),
      },
      commandExecutor: {
        execute: () => Promise.resolve({ stdout: 'command output', stderr: '' }),
      },
      toolRegistry: {
        getToolNames: () => ['read', 'search', 'editSymbol', 'searchReplace', 'readFileForEdit'],
        getDefinitions: () => '[{"name":"read","description":"Read file"}]',
        execute: vi.fn(),
      },
      provider: mp,
      embedProvider: { chat: () => Promise.resolve({ response: '' }) },
      model: 'test-model',
      jsonMode: false,
      ragDir: undefined as string | undefined,
    };

    // ── Mock SessionManager ──
    const mockSM = {
      addMessage: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockReturnValue([]),
      flush: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'abc12345-0000-0000-0000-000000000001',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T01:00:00.000Z',
          messageCount: 3,
          title: 'Test Session',
        },
      ]),
      getSessionId: vi.fn().mockReturnValue('abc12345'),
    };

    // ── Classes mock construtíveis ──
    class MockCtx {
      get fileReader() { return ms.fileReader; }
      get commandExecutor() { return ms.commandExecutor; }
      get toolRegistry() { return ms.toolRegistry; }
      get provider() { return ms.provider; }
      get embedProvider() { return ms.embedProvider; }
      get model() { return ms.model; }
      get jsonMode() { return ms.jsonMode; }
      get ragDir() { return ms.ragDir; }
      get sessionManager() { return mockSM; }
      getSessionHistory() { return []; }
      initialize() { return Promise.resolve(); }
    }

    class MockStrat {
      execute = () => Promise.resolve('stream strategy output');
    }

    class MockReAct {
      execute = () => Promise.resolve('react strategy output');
    }

    return {
      mockState: ms,
      mockProvider: mp,
      MockAppContext: MockCtx,
      MockStreamStrategy: MockStrat,
      MockReActStrategy: MockReAct,
      mockSessionManager: mockSM,
    };
  });

// ═══════════════════════════════════════════════════════════════════════
// Mocks (hoisted — podem referenciar vi.hoisted vars)
// ═══════════════════════════════════════════════════════════════════════

vi.mock('../../../src/core', () => ({
  AppContext: MockAppContext,
  FileReader: class {},
  CommandExecutor: class {},
  ToolRegistry: class {},
  ReActLoop: class {
    execute = () =>
      Promise.resolve({
        finalAnswer: 'mock react final answer',
        history: [],
      });
  },
  RAGManager: {
    create: () => ({
      ensureIndex: () => Promise.resolve(undefined),
      retrieve: () => Promise.resolve([]),
      formatContext: () => '',
    }),
  },
  PromptBuilder: class {},
  SessionManager: class {
    addMessage = () => Promise.resolve(undefined);
    getHistory = () => [];
    flush = () => Promise.resolve(undefined);
    listSessions = () => Promise.resolve([]);
    getSessionId = () => 'mock-session-id';
  },
  SessionStore: class {},
}));

vi.mock('../../../src/cli/strategies', () => ({
  StreamStrategy: MockStreamStrategy,
  ReActStrategy: MockReActStrategy,
}));

// ═══════════════════════════════════════════════════════════════════════
// Imports (depois dos mocks)
// ═══════════════════════════════════════════════════════════════════════

import { runCommand } from '../../../src/cli/commands';
import type { CliArgs } from '../../../src/cli/commands';

// ═══════════════════════════════════════════════════════════════════════
// Testes
// ═══════════════════════════════════════════════════════════════════════

describe('CLI Commands', () => {
  beforeEach(() => {
    // Reseta estado entre testes
    mockState.jsonMode = false;
    // Garante streamChat existe (pode ter sido deletado)
    if (!('streamChat' in mockProvider)) {
      Object.defineProperty(mockProvider, 'streamChat', {
        value: async function* () {
          yield 'mock ';
          yield 'stream ';
          yield 'response';
        },
        writable: true,
        configurable: true,
      });
    }
  });

  // ── Helpers ──
  function makeArgs(
    command: string,
    args: string[],
    flags: Record<string, string | boolean> = {}
  ): CliArgs {
    return { command, args, flags };
  }

  // ── read ──
  describe('read', () => {
    it('deve retornar o conteúdo do arquivo', async () => {
      const result = await runCommand(makeArgs('read', ['package.json']));
      expect(result).toBe('file content mock');
    });

    it('deve lançar erro se filepath estiver faltando', async () => {
      await expect(runCommand(makeArgs('read', []))).rejects.toThrow(
        'Usage: soberano read <filepath>'
      );
    });
  });

  // ── dir ──
  describe('dir', () => {
    it('deve listar diretório com path informado', async () => {
      const result = await runCommand(makeArgs('dir', ['src']));
      expect(result).toBe('file1.ts\nfile2.ts');
    });

    it('deve usar "." se nenhum path for informado', async () => {
      const result = await runCommand(makeArgs('dir', []));
      expect(result).toBe('file1.ts\nfile2.ts');
    });
  });

  // ── search ──
  describe('search', () => {
    it('deve retornar resultados formatados', async () => {
      const result = await runCommand(makeArgs('search', ['src', 'export']));
      expect(result).toBe('src/test.ts:10  export const x = 1');
    });

    it('deve lançar erro se dir ou pattern estiverem faltando', async () => {
      await expect(runCommand(makeArgs('search', ['src']))).rejects.toThrow(
        'Usage: soberano search <directory> <pattern>'
      );
    });

    it('deve retornar "No matches found" se não houver resultados', async () => {
      mockState.fileReader.searchFiles = () => Promise.resolve([]);
      const result = await runCommand(makeArgs('search', ['src', 'nonexistent']));
      expect(result).toBe('No matches found.');
    });
  });

  // ── exec ──
  describe('exec', () => {
    it('deve executar comando e retornar stdout', async () => {
      const result = await runCommand(makeArgs('exec', ['ls', '-la']));
      expect(result).toBe('command output');
    });

    it('deve lançar erro se comando estiver vazio', async () => {
      await expect(runCommand(makeArgs('exec', []))).rejects.toThrow(
        'Usage: soberano exec <command>'
      );
    });
  });

  // ── chat ──
  describe('chat', () => {
    beforeEach(() => {
      // Reseta contadores dos mocks de sessão entre testes de chat
      mockSessionManager.addMessage.mockClear();
      mockSessionManager.flush.mockClear();
    });

    it('deve usar ReActStrategy por padrão (sem --stream, sem --json)', async () => {
      const result = await runCommand(makeArgs('chat', ['explique SOLID']));
      expect(result).toBe('react strategy output');
    });

    it('deve usar StreamStrategy quando --stream e provider suporta', async () => {
      const result = await runCommand(
        makeArgs('chat', ['explique SOLID'], { stream: true })
      );
      expect(result).toBe('stream strategy output');
    });

    it('deve usar ReActStrategy quando --json mesmo com --stream', async () => {
      mockState.jsonMode = true;
      const result = await runCommand(
        makeArgs('chat', ['explique SOLID'], { stream: true, json: true })
      );
      expect(result).toBe('react strategy output');
    });

    it('deve usar ReActStrategy quando --stream mas provider não suporta streamChat', async () => {
      mockState.jsonMode = false;

      // Remove streamChat dinamicamente
      delete (mockProvider as Record<string, unknown>).streamChat;

      const result = await runCommand(
        makeArgs('chat', ['explique SOLID'], { stream: true })
      );
      expect(result).toBe('react strategy output');
    });

    it('deve lançar erro se prompt estiver vazio', async () => {
      await expect(runCommand(makeArgs('chat', []))).rejects.toThrow(
        'Usage: soberano chat <prompt>'
      );
    });

    it('deve adicionar mensagem ao histórico da sessão no chat', async () => {
      await runCommand(makeArgs('chat', ['explique SOLID']));
      expect(mockSessionManager.addMessage).toHaveBeenCalledWith(
        { role: 'user', content: 'explique SOLID' },
        'test-model'
      );
    });

    it('deve chamar flush após o chat para persistir sessão', async () => {
      await runCommand(makeArgs('chat', ['explique SOLID']));
      expect(mockSessionManager.flush).toHaveBeenCalledOnce();
    });
  });

  // ── sessions ──
  describe('sessions', () => {
    it('deve listar sessões disponíveis', async () => {
      const result = await runCommand(makeArgs('sessions', []));
      expect(result).toContain('Sessões disponíveis');
      expect(result).toContain('abc12345');
      expect(result).toContain('Test Session');
    });

    it('deve retornar "Nenhuma sessão" quando não há sessões', async () => {
      mockSessionManager.listSessions.mockResolvedValueOnce([]);
      const result = await runCommand(makeArgs('sessions', []));
      expect(result).toBe('Nenhuma sessão encontrada.');
    });
  });

  // ── Comando desconhecido ──
  describe('unknown command', () => {
    it('deve lançar erro com comando não reconhecido', async () => {
      await expect(runCommand(makeArgs('unknown', []))).rejects.toThrow(
        'Unknown command: "unknown". Available: read, dir, search, exec, chat, sessions'
      );
    });
  });
});