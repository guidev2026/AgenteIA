/**
 * SessionStore: Persistência de sessões de conversa em disco.
 *
 * Responsabilidade Única (SRP):
 * - Ler, escrever, listar e deletar arquivos de sessão (.json)
 *   no diretório .soberano/sessions/.
 * - Zero conhecimento do que é uma conversa ou ReActLoop.
 * - Usa apenas módulos nativos do Node.js (node:fs/promises).
 *
 * DIP (Dependency Inversion Principle):
 * - A interface ISessionStore é a abstração que o SessionManager
 *   e os testes usam, nunca a classe concreta diretamente.
 */

import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { ReActMessage } from './rag/ReActLoop';

/**
 * Representa uma sessão de conversa completa, persistida em disco.
 */
export interface Session {
  /** UUID v4 — identificador único da sessão */
  id: string;
  /** ISO 8601 — timestamp de criação */
  createdAt: string;
  /** ISO 8601 — timestamp da última atualização */
  updatedAt: string;
  /** Array de mensagens da conversa (em ordem cronológica) */
  messages: ReActMessage[];
  /** Metadados opcionais (modelo usado, título, etc.) */
  metadata?: {
    /** Modelo utilizado na sessão (ex: "llama3.2:1b") */
    model?: string;
    /** Título auto-extraído da primeira pergunta (máx 80 chars) */
    title?: string;
  };
}

/**
 * Resumo leve de uma sessão para listagem (sem mensagens).
 */
export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
}

/** Interface para erros com código (Enoent, EACCES, etc.) */
interface FileSystemError extends Error {
  code?: string;
}

/**
 * ISessionStore: Abstração para persistência de sessões.
 *
 * DIP (Dependency Inversion Principle):
 * - SessionManager depende desta interface, não da implementação concreta.
 * - Testes podem mockar facilmente.
 */
export interface ISessionStore {
  /** Persiste uma sessão em disco (cria ou sobrescreve) */
  save(session: Session): Promise<void>;
  /** Carrega uma sessão pelo ID. Retorna null se não existir ou corrompida. */
  load(sessionId: string): Promise<Session | null>;
  /** Lista todas as sessões disponíveis (apenas resumo). */
  list(): Promise<SessionSummary[]>;
  /** Remove uma sessão do disco. Idempotente (não erra se não existir). */
  delete(sessionId: string): Promise<void>;
}

/**
 * SessionStore: Implementação concreta de ISessionStore.
 *
 * Salva arquivos .json no diretório especificado (padrão: .soberano/sessions).
 * Usa exclusivamente módulos nativos do Node.js.
 */
export class SessionStore implements ISessionStore {
  private baseDir: string;

  /**
   * @param baseDir Diretório base para armazenar as sessões.
   *                Padrão: '.soberano/sessions'
   */
  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? '.soberano/sessions';
  }

  /**
   * Retorna o caminho completo para o arquivo de uma sessão.
   */
  private sessionPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.json`);
  }

  async save(session: Session): Promise<void> {
    // Garante que o diretório existe
    await mkdir(this.baseDir, { recursive: true });

    // Atualiza o timestamp antes de salvar
    session.updatedAt = new Date().toISOString();

    const filePath = this.sessionPath(session.id);
    const data = JSON.stringify(session, null, 2);
    await writeFile(filePath, data, 'utf-8');
  }

  async load(sessionId: string): Promise<Session | null> {
    const filePath = this.sessionPath(sessionId);

    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data) as Session;
    } catch (err: unknown) {
      // Arquivo não encontrado — retorna null (caso normal)
      if (err && typeof err === 'object' && 'code' in err && (err as FileSystemError).code === 'ENOENT') {
        return null;
      }
      // JSON inválido — retorna null (tolerância a corrupção)
      if (err instanceof SyntaxError) {
        return null;
      }
      // Outros erros (permissão, etc.) — relança
      throw err;
    }
  }

  async list(): Promise<SessionSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.baseDir);
    } catch {
      // Diretório não existe — retorna lista vazia
      return [];
    }

    const summaries: SessionSummary[] = [];

    for (const file of files) {
      // Ignora arquivos que não são .json
      if (extname(file) !== '.json') continue;

      const sessionId = file.replace(/\.json$/, '');
      const filePath = join(this.baseDir, file);

      try {
        const data = await readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data) as Session;

        summaries.push({
          id: sessionId,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
          messageCount: parsed.messages.length,
          title: parsed.metadata?.title,
        });
      } catch {
        // Pula arquivos corrompidos (não quebra o loop)
        continue;
      }
    }

    // Ordena por updatedAt decrescente (mais recentes primeiro)
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return summaries;
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.sessionPath(sessionId);

    try {
      await unlink(filePath);
    } catch (err: unknown) {
      // Se o arquivo não existe, resolve silenciosamente (idempotente)
      if (err && typeof err === 'object' && 'code' in err && (err as FileSystemError).code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }
}