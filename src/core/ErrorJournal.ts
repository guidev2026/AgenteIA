/**
 * ErrorJournal: Persistência de erros de reflexão em disco.
 *
 * SRP: Responsabilidade única — salvar e recuperar registros de erros
 * encontrados pelo Reflector durante a auto-correção.
 *
 * Sem dependências externas: usa apenas node:fs (fs.promises) nativo.
 * Os registros são salvos em ~/.soberano/error-journal.json
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

import * as fs from 'node:fs';
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
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.soberano',
  'error-journal.json'
);

export class ErrorJournal {
  private filePath: string;
  private maxEntries: number;

  /**
   * @param filePath Caminho do arquivo JSON (opcional, default ~/.soberano/error-journal.json)
   * @param maxEntries Número máximo de entradas (default 1000)
   */
  constructor(filePath?: string, maxEntries: number = 1000) {
    this.filePath = filePath || DEFAULT_JOURNAL_PATH;
    this.maxEntries = maxEntries;
  }

  /**
   * Carrega o journal do disco.
   * Se o arquivo não existir, retorna um journal vazio.
   */
  private loadSync(): ErrorJournalData {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
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
   * Salva o journal no disco.
   */
  private saveSync(data: ErrorJournalData): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Falha silenciosa — o journal é auxiliar, não deve quebrar o fluxo
    }
  }

  /**
   * Adiciona um entry ao journal e persiste.
   *
   * @param entry Dados do erro a ser registrado
   */
  addEntry(entry: ErrorJournalEntry): void {
    const data = this.loadSync();
    data.entries.push(entry);

    // Limita o número de entradas (FIFO)
    if (data.entries.length > this.maxEntries) {
      data.entries = data.entries.slice(-this.maxEntries);
    }

    this.saveSync(data);
  }

  /**
   * Retorna todos os entries do journal (mais recentes primeiro).
   */
  getEntries(): ErrorJournalEntry[] {
    const data = this.loadSync();
    return data.entries.slice().reverse();
  }

  /**
   * Retorna os últimos N entries, filtrados por tipo (opcional).
   *
   * @param limit Número máximo de entries
   * @param type Filter por tipo de erro (opcional)
   */
  getRecentEntries(limit: number = 10, type?: string): ErrorJournalEntry[] {
    const all = this.getEntries();
    const filtered = type ? all.filter((e) => e.type === type) : all;
    return filtered.slice(0, limit);
  }

  /**
   * Retorna estatísticas agregadas do journal.
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    lastEntry: string | null;
  } {
    const data = this.loadSync();
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