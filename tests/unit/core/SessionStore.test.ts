import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore, Session } from '../../../src/core/SessionStore';

// ── Mocks do node:fs/promises ──

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn();
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn();

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

describe('SessionStore', () => {
  let store: SessionStore;
  const baseDir = '.soberano/sessions';

  beforeEach(() => {
    // Reseta chamadas e implementações de todos os mocks
    vi.clearAllMocks();
    store = new SessionStore(baseDir);
  });

  // ── save() ──

  describe('save()', () => {
    it('cria diretório e escreve JSON com updatedAt atualizado', async () => {
      const session: Session = {
        id: 'abc-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        messages: [
          { role: 'user', content: 'Olá' },
          { role: 'assistant', content: 'Oi!' },
        ],
      };

      await store.save(session);

      // Verifica que mkdir foi chamado com recursive true
      expect(mockMkdir).toHaveBeenCalledWith(baseDir, { recursive: true });

      // Verifica que writeFile foi chamado com o caminho correto
      const expectedPath = `${baseDir}/abc-123.json`;
      expect(mockWriteFile).toHaveBeenCalledWith(expectedPath, expect.any(String), 'utf-8');

      // Extrai o JSON passado para writeFile e verifica o conteúdo
      const jsonArg = mockWriteFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(jsonArg);
      expect(parsed.id).toBe('abc-123');
      expect(parsed.messages).toHaveLength(2);
      // updatedAt deve ter sido atualizado (não é mais o original)
      expect(parsed.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });
  });

  // ── load() ──

  describe('load()', () => {
    it('retorna Session parseada quando arquivo existe', async () => {
      const sessionData: Session = {
        id: 'abc-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        messages: [{ role: 'user', content: 'teste' }],
        metadata: { model: 'llama3.2:1b', title: 'Teste' },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(sessionData));

      const result = await store.load('abc-123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('abc-123');
      expect(result!.messages).toHaveLength(1);
      expect(result!.metadata!.model).toBe('llama3.2:1b');
      expect(result!.metadata!.title).toBe('Teste');
    });

    it('retorna null quando arquivo não existe (ENOENT)', async () => {
      const err = Object.assign(new Error('File not found'), { code: 'ENOENT' });
      mockReadFile.mockRejectedValue(err);

      const result = await store.load('inexistente');
      expect(result).toBeNull();
    });

    it('retorna null quando JSON é inválido', async () => {
      mockReadFile.mockResolvedValue('isto não é json válido {{{');

      const result = await store.load('corrompido');
      expect(result).toBeNull();
    });
  });

  // ── list() ──

  describe('list()', () => {
    it('retorna array de SessionSummary ordenado por updatedAt desc', async () => {
      mockReaddir.mockResolvedValue(['a.json', 'b.json']);

      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('a.json')) {
          return Promise.resolve(JSON.stringify({
            id: 'a',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T10:00:00.000Z',
            messages: [{ role: 'user', content: 'msg1' }],
          }));
        }
        if (filePath.endsWith('b.json')) {
          return Promise.resolve(JSON.stringify({
            id: 'b',
            createdAt: '2024-01-02T00:00:00.000Z',
            updatedAt: '2024-01-02T10:00:00.000Z',
            messages: [
              { role: 'user', content: 'msg1' },
              { role: 'assistant', content: 'msg2' },
            ],
            metadata: { title: 'Sessão B' },
          }));
        }
        return Promise.reject(new Error('Unexpected file'));
      });

      const result = await store.list();

      expect(result).toHaveLength(2);
      // Deve vir primeiro o mais recente (b)
      expect(result[0].id).toBe('b');
      expect(result[0].messageCount).toBe(2);
      expect(result[0].title).toBe('Sessão B');
      expect(result[1].id).toBe('a');
      expect(result[1].messageCount).toBe(1);
    });

    it('pula arquivos com JSON inválido', async () => {
      // Isola completamente este teste: redefine o mock
      mockReadFile.mockImplementation(() => Promise.reject(new Error('no default')));

      mockReaddir.mockResolvedValue(['invalido.json', 'valido.json']);

      // Força a ordem: primeiro invalido.json, depois valido.json
      mockReadFile
        .mockImplementationOnce(() => Promise.resolve('json quebrado {{{'))
        .mockImplementationOnce(() => Promise.resolve(JSON.stringify({
          id: 'valido',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          messages: [],
        })));

      const result = await store.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valido');
    });

    it('retorna array vazio quando diretório não existe', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const result = await store.list();
      expect(result).toEqual([]);
    });

    it('ignora arquivos que não são .json', async () => {
      mockReaddir.mockResolvedValue(['session.json', 'notas.txt', 'dados.csv']);

      mockReadFile
        .mockImplementationOnce(() => Promise.resolve(JSON.stringify({
          id: 'session',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          messages: [],
        })));

      const result = await store.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session');
    });
  });

  // ── delete() ──

  describe('delete()', () => {
    it('remove arquivo da sessão', async () => {
      await store.delete('abc-123');

      expect(mockUnlink).toHaveBeenCalledWith(`${baseDir}/abc-123.json`);
    });

    it('não lança erro se arquivo não existe (ENOENT)', async () => {
      const err = Object.assign(new Error('Not found'), { code: 'ENOENT' });
      mockUnlink.mockRejectedValue(err);

      // Deve resolver sem lançar
      await expect(store.delete('inexistente')).resolves.toBeUndefined();
    });
  });
});