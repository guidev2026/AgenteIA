/**
 * ErrorJournal: Persistência de erros de reflexão em disco.
 *
 * SRP: Responsabilidade única — salvar e recuperar registros de erros
 * encontrados pelo Reflector durante a auto-correção.
 *
 * Sem dependências externas: usa apenas node:fs/promises nativo.
 * Operações assíncronas para não bloquear o Event Loop.
 *
 * Os registros são salvos em .soberano/error-journal.json na raiz do projeto
 *
 * Formato do arquivo:
 * ```json
 * {
 *   "version": 1,
 *   "entries": [
 *     {
 *       "timestamp": "2026-05-09T10:30:00.000Z",
 *       "model": "llama3.2:1b",
 *       "type": "hallucination",
 *       "description": "Menção a função inexistente 'fs.readJsonSync'",
 *       "correctionStatus": "stable",
 *       "originalLength": 245,
 *       "correctedLength": 260
 *     }
 *   ]
 * }
 * ```
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CorrectionStatus } from '../providers/types';

/** Um único registro de erro no journal */
export interface ErrorJournalEntry {
  timestamp: string;
  model: string;
  type: 'hallucination' | 'syntax' | 'inconsistency' | 'logic';
  description: string;
  correctionStatus: CorrectionStatus;
  originalLength: number;
  correctedLength: number;
}

/** Estrutura completa do journal */
export interface ErrorJournalData {
  version: number;
  entries: ErrorJournalEntry[];
}

const DEFAULT_JOURNAL_PATH = path.join(
  process.cwd(),
  '.soberano',
  'error-journal.json'
);

export class ErrorJournal {
  private filePath: string;
  private maxEntries: number;

  /**
   * @param filePath Caminho do arquivo JSON (opcional, default .soberano/error-journal.json na raiz do projeto)
   * @param maxEntries Número máximo de entradas (default 1000)
   */
  constructor(filePath?: string, maxEntries: number = 1000) {
    this.filePath = filePath || DEFAULT_JOURNAL_PATH;
    this.maxEntries = maxEntries;
  }

  /**
   * Carrega o journal do disco (assíncrono).
   * Se o arquivo não existir, retorna um journal vazio.
   */
  private async load(): Promise<ErrorJournalData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as ErrorJournalData;
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        return parsed;
      }
      return { version: 1, entries: [] };
    } catch {
      return { version: 1, entries: [] };
    }
  }

  /**
   * Salva o journal no disco (assíncrono).
   */
  private async save(data: ErrorJournalData): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Falha silenciosa — o journal é auxiliar, não deve quebrar o fluxo
    }
  }

  /**
   * Adiciona um entry ao journal e persiste.
   *
   * @param entry Dados do erro a ser registrado
   */
  async addEntry(entry: ErrorJournalEntry): Promise<void> {
    const data = await this.load();
    data.entries.push(entry);

    // Limita o número de entradas (FIFO)
    if (data.entries.length > this.maxEntries) {
      data.entries = data.entries.slice(-this.maxEntries);
    }

    await this.save(data);
  }

  /**
   * Retorna todos os entries do journal (mais recentes primeiro).
   */
  async getEntries(): Promise<ErrorJournalEntry[]> {
    const data = await this.load();
    return data.entries.slice().reverse();
  }

  /**
   * Retorna os últimos N entries, filtrados por tipo (opcional).
   *
   * @param limit Número máximo de entries
   * @param type Filter por tipo de erro (opcional)
   */
  async getRecentEntries(limit: number = 10, type?: string): Promise<ErrorJournalEntry[]> {
    const all = await this.getEntries();
    const filtered = type ? all.filter((e) => e.type === type) : all;
    return filtered.slice(0, limit);
  }

  /**
   * Retorna estatísticas agregadas do journal.
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    lastEntry: string | null;
  }> {
    const data = await this.load();
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const entry of data.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byStatus[entry.correctionStatus] = (byStatus[entry.correctionStatus] || 0) + 1;
    }

    return {
      total: data.entries.length,
      byType,
      byStatus,
      lastEntry: data.entries.length > 0
        ? data.entries[data.entries.length - 1].timestamp
        : null,
    };
  }
}