/**
 * SessionManager: Orquestração da sessão de conversa ativa.
 *
 * Responsabilidade Única (SRP):
 * - Gerenciar a sessão ativa (carregar, iniciar nova, adicionar mensagens).
 * - Orquestrar a persistência via ISessionStore.
 * - Fornecer o histórico formatado (ReActMessage[]) para o ReActLoop.
 * - Extrair título automaticamente da primeira mensagem do usuário.
 *
 * DIP (Dependency Inversion Principle):
 * - Depende da abstração ISessionStore, não da implementação concreta.
 * - Pode ser testado com mock de ISessionStore.
 */

import { randomUUID } from 'node:crypto';
import type { ISessionStore, Session } from './SessionStore';
import type { ReActMessage } from './rag/ReActLoop';

/**
 * SessionManager: interface pública para gerenciar sessões.
 */
export class SessionManager {
  private store: ISessionStore;
  private currentSession: Session | null = null;

  constructor(store: ISessionStore) {
    this.store = store;
  }

  /**
   * Retorna o ID da sessão ativa, ou null se nenhuma foi iniciada.
   */
  getCurrentSessionId(): string | null {
    return this.currentSession?.id ?? null;
  }

  /**
   * Retorna o título da sessão ativa, ou null.
   */
  getCurrentTitle(): string | null {
    return this.currentSession?.metadata?.title ?? null;
  }

  /**
   * Indica se há uma sessão ativa com mensagens.
   */
  isActive(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Retorna cópia das mensagens da sessão ativa.
   * Útil para o ReActLoop consumir como histórico.
   */
  getHistory(): ReActMessage[] {
    if (!this.currentSession) return [];
    return [...this.currentSession.messages];
  }

  /**
   * Contagem de mensagens na sessão ativa.
   */
  getMessageCount(): number {
    return this.currentSession?.messages.length ?? 0;
  }

  /**
   * Carrega uma sessão existente pelo ID.
   * @param sessionId UUID da sessão a carregar
   * @returns true se a sessão foi carregada, false se não existir
   */
  async loadSession(sessionId: string): Promise<boolean> {
    const session = await this.store.load(sessionId);
    if (!session) return false;

    this.currentSession = session;
    return true;
  }

  /**
   * Cria uma nova sessão com ID único e timestamp atual.
   * Se já houver uma sessão ativa, ela é salva automaticamente antes.
   */
  async newSession(model?: string): Promise<string> {
    // Salva sessão anterior se existir
    await this.flush();

    const id = randomUUID();
    const now = new Date().toISOString();

    this.currentSession = {
      id,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {
        model,
        title: undefined,
      },
    };

    return id;
  }

  /**
   * Adiciona uma mensagem ao histórico da sessão ativa.
   * Se a sessão não foi iniciada, cria uma automaticamente.
   * Se for a primeira mensagem do usuário, extrai título.
   *
   * @param message Mensagem para adicionar (role + content)
   * @param model Modelo usado (opcional, para metadado)
   */
  async addMessage(message: ReActMessage, model?: string): Promise<void> {
    // Garante sessão ativa
    if (!this.currentSession) {
      await this.newSession(model);
    }

    this.currentSession!.messages.push(message);

    // Extrai título da primeira mensagem do usuário (máx 80 chars)
    if (message.role === 'user' && !this.currentSession!.metadata?.title) {
      this.currentSession!.metadata = this.currentSession!.metadata ?? {};
      this.currentSession!.metadata.title = this.extractTitle(message.content);
    }
  }

  /**
   * Persiste a sessão ativa em disco via ISessionStore.
   * Chamado automaticamente ao trocar de sessão; também exposto
   * para ser chamado explicitamente após cada turno de conversa.
   */
  async flush(): Promise<void> {
    if (!this.currentSession) return;
    await this.store.save(this.currentSession);
  }

  /**
   * Lista todas as sessões disponíveis (delega ao store).
   */
  listSessions() {
    return this.store.list();
  }

  /**
   * Deleta uma sessão específica (delega ao store).
   * Se for a sessão ativa, limpa o estado atual.
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);

    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
  }

  /**
   * Extrai um título legível da primeira pergunta do usuário.
   * Pega as primeiras N palavras, no máximo 80 caracteres.
   */
  private extractTitle(content: string): string {
    // Remove quebras de linha e espaços extras
    const clean = content.replace(/\s+/g, ' ').trim();

    // Pega primeiras 8 palavras ou até 80 chars
    const words = clean.split(' ');
    let title = words.slice(0, 8).join(' ');

    if (title.length > 80) {
      title = title.substring(0, 77) + '...';
    }

    return title;
  }
}