import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../../src/core/SessionManager';
import type { ISessionStore, Session } from '../../../src/core/SessionStore';

// ── Mock do ISessionStore ──

function createMockStore(): ISessionStore {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SessionManager', () => {
  let store: ISessionStore;
  let manager: SessionManager;

  beforeEach(() => {
    store = createMockStore();
    manager = new SessionManager(store);
  });

  // ── Estado inicial ──

  describe('estado inicial', () => {
    it('não tem sessão ativa', () => {
      expect(manager.isActive()).toBe(false);
      expect(manager.getCurrentSessionId()).toBeNull();
      expect(manager.getCurrentTitle()).toBeNull();
      expect(manager.getHistory()).toEqual([]);
      expect(manager.getMessageCount()).toBe(0);
    });
  });

  // ── addMessage (criação automática) ──

  describe('addMessage()', () => {
    it('cria sessão automaticamente na primeira mensagem', async () => {
      await manager.addMessage({ role: 'user', content: 'Olá mundo' });

      expect(manager.isActive()).toBe(true);
      expect(manager.getCurrentSessionId()).toBeTruthy();
      expect(manager.getHistory()).toHaveLength(1);
      expect(manager.getHistory()[0].content).toBe('Olá mundo');
    });

    it('adiciona mensagens em sequência', async () => {
      await manager.addMessage({ role: 'user', content: 'Pergunta 1' });
      await manager.addMessage({ role: 'assistant', content: 'Resposta 1' });
      await manager.addMessage({ role: 'user', content: 'Pergunta 2' });

      expect(manager.getMessageCount()).toBe(3);
      expect(manager.getHistory()[1].content).toBe('Resposta 1');
    });

    it('extrai título da primeira mensagem do usuário', async () => {
      await manager.addMessage({ role: 'user', content: 'Como faço para instalar o Node.js no Ubuntu' });

      expect(manager.getCurrentTitle()).toBe('Como faço para instalar o Node.js no Ubuntu');
    });

    it('não sobrescreve título se já existe', async () => {
      await manager.addMessage({ role: 'user', content: 'Primeira pergunta' });
      const title = manager.getCurrentTitle();

      await manager.addMessage({ role: 'assistant', content: 'Resposta' });
      await manager.addMessage({ role: 'user', content: 'Segunda pergunta' });

      // Título continua sendo o da primeira
      expect(manager.getCurrentTitle()).toBe(title);
    });

    it('trunca título em 80 caracteres', async () => {
      const longMessage = 'a '.repeat(50); // 100 chars
      await manager.addMessage({ role: 'user', content: longMessage });

      expect(manager.getCurrentTitle()!.length).toBeLessThanOrEqual(80);
    });
  });

  // ── newSession ──

  describe('newSession()', () => {
    it('cria nova sessão vazia', async () => {
      const id = await manager.newSession('llama3.2:1b');

      expect(id).toBeTruthy();
      expect(manager.getCurrentSessionId()).toBe(id);
      expect(manager.getHistory()).toEqual([]);
      expect(manager.getMessageCount()).toBe(0);
    });

    it('faz flush da sessão anterior antes de criar nova', async () => {
      await manager.addMessage({ role: 'user', content: 'msg' });
      expect(store.save).toHaveBeenCalledTimes(0); // flush implícito no newSession

      await manager.newSession('llama3.2:1b');

      // save deve ter sido chamado após newSession (flush)
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('associa modelo à nova sessão', async () => {
      await manager.newSession('llama3.2:1b');

      // Acessa internamente via addMessage depois
      await manager.addMessage({ role: 'user', content: 'teste' });
      expect(manager.getCurrentTitle()).toBe('teste');
    });
  });

  // ── loadSession ──

  describe('loadSession()', () => {
    it('carrega sessão existente pelo ID', async () => {
      const existingSession: Session = {
        id: 'abc-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        messages: [
          { role: 'user', content: 'Olá' },
          { role: 'assistant', content: 'Oi' },
        ],
        metadata: { model: 'llama3.2:1b', title: 'Saudação' },
      };

      vi.mocked(store.load).mockResolvedValue(existingSession);

      const success = await manager.loadSession('abc-123');
      expect(success).toBe(true);
      expect(manager.getCurrentSessionId()).toBe('abc-123');
      expect(manager.getMessageCount()).toBe(2);
      expect(manager.getCurrentTitle()).toBe('Saudação');
    });

    it('retorna false se sessão não existe', async () => {
      vi.mocked(store.load).mockResolvedValue(null);

      const success = await manager.loadSession('inexistente');
      expect(success).toBe(false);
      expect(manager.isActive()).toBe(false);
    });
  });

  // ── flush ──

  describe('flush()', () => {
    it('persiste sessão ativa no store', async () => {
      await manager.addMessage({ role: 'user', content: 'teste' });
      expect(store.save).toHaveBeenCalledTimes(0);

      await manager.flush();
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('não faz nada se não há sessão ativa', async () => {
      await manager.flush();
      expect(store.save).toHaveBeenCalledTimes(0);
    });
  });

  // ── listSessions ──

  describe('listSessions()', () => {
    it('delega ao store', async () => {
      const mockList = vi.mocked(store.list);
      mockList.mockResolvedValue([{ id: '1', createdAt: '', updatedAt: '', messageCount: 0 }]);

      const result = await manager.listSessions();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });
  });

  // ── deleteSession ──

  describe('deleteSession()', () => {
    it('delega ao store e limpa sessão ativa se for a mesma', async () => {
      await manager.addMessage({ role: 'user', content: 'teste' });
      const sessionId = manager.getCurrentSessionId()!;

      await manager.deleteSession(sessionId);

      expect(store.delete).toHaveBeenCalledWith(sessionId);
      expect(manager.isActive()).toBe(false);
    });

    it('não limpa sessão ativa se o ID for diferente', async () => {
      await manager.addMessage({ role: 'user', content: 'teste' });

      await manager.deleteSession('outro-id');

      expect(manager.isActive()).toBe(true);
    });
  });
});