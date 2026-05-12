/**
 * Testes unitários do ErrorJournal (TASK 6, ARCH-04).
 *
 * Cobertura:
 * - addEntry e persistência assíncrona
 * - getEntries ordenação FIFO reversa
 * - getRecentEntries com filtro
 * - getStats agregação
 * - Carregamento de arquivo corrompido
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorJournal } from '../../../src/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('ErrorJournal', () => {
  const testDir = path.join(os.tmpdir(), 'soberano-test-journal');
  const testFile = path.join(testDir, 'test-journal.json');
  let journal: ErrorJournal;

  beforeEach(async () => {
    // Limpa resíduos de testes anteriores
    try { fs.rmSync(testDir, { recursive: true }); } catch { /* ok */ }
    journal = new ErrorJournal(testFile, 100);
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch { /* ok */ }
  });

  it('deve criar arquivo vazio quando não existe', async () => {
    const entries = await journal.getEntries();
    expect(entries).toEqual([]);
  });

  it('deve adicionar um entry e persisti-lo', async () => {
    await journal.addEntry({
      timestamp: '2026-05-09T10:00:00.000Z',
      model: 'llama3.2:1b',
      type: 'hallucination',
      description: 'Função inexistente fs.readJsonSync',
      correctionStatus: 'stable',
      originalLength: 100,
      correctedLength: 120,
    });

    const entries = await journal.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('hallucination');
    expect(entries[0].correctionStatus).toBe('stable');

    // Verifica que foi persistido em disco
    expect(fs.existsSync(testFile)).toBe(true);
  });

  it('deve retornar entries mais recentes primeiro', async () => {
    await journal.addEntry({
      timestamp: '2026-05-09T10:00:00.000Z',
      model: 'tinyllama:1b',
      type: 'syntax',
      description: 'Erro 1',
      correctionStatus: 'stable',
      originalLength: 10,
      correctedLength: 10,
    });

    await journal.addEntry({
      timestamp: '2026-05-09T11:00:00.000Z',
      model: 'tinyllama:1b',
      type: 'logic',
      description: 'Erro 2',
      correctionStatus: 'suspicious',
      originalLength: 20,
      correctedLength: 30,
    });

    const entries = await journal.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('logic'); // Mais recente primeiro
    expect(entries[1].type).toBe('syntax');
  });

  it('deve filtrar por tipo em getRecentEntries', async () => {
    await journal.addEntry({
      timestamp: '2026-05-09T10:00:00.000Z',
      model: 'test',
      type: 'hallucination',
      description: 'Alucinação',
      correctionStatus: 'stable',
      originalLength: 10,
      correctedLength: 10,
    });

    await journal.addEntry({
      timestamp: '2026-05-09T11:00:00.000Z',
      model: 'test',
      type: 'syntax',
      description: 'Erro sintaxe',
      correctionStatus: 'stable',
      originalLength: 20,
      correctedLength: 20,
    });

    const filtered = await journal.getRecentEntries(10, 'hallucination');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('hallucination');
  });

  it('deve limitar número de entradas (FIFO)', async () => {
    const smallJournal = new ErrorJournal(testFile, 3);

    for (let i = 0; i < 5; i++) {
      await smallJournal.addEntry({
        timestamp: `2026-05-09T${10 + i}:00:00.000Z`,
        model: 'test',
        type: 'hallucination',
        description: `Erro ${i + 1}`,
        correctionStatus: 'stable',
        originalLength: 10,
        correctedLength: 10,
      });
    }

    const entries = await smallJournal.getEntries();
    expect(entries).toHaveLength(3); // Apenas os 3 últimos
    expect(entries[0].description).toBe('Erro 5'); // Mais recente
    expect(entries[2].description).toBe('Erro 3'); // Mais antigo dos 3
  });

  it('deve retornar stats corretas', async () => {
    await journal.addEntry({
      timestamp: '2026-05-09T10:00:00.000Z',
      model: 'test',
      type: 'hallucination',
      description: 'Alucinação',
      correctionStatus: 'stable',
      originalLength: 10,
      correctedLength: 15,
    });

    await journal.addEntry({
      timestamp: '2026-05-09T11:00:00.000Z',
      model: 'test',
      type: 'syntax',
      description: 'Erro',
      correctionStatus: 'suspicious',
      originalLength: 20,
      correctedLength: 25,
    });

    await journal.addEntry({
      timestamp: '2026-05-09T12:00:00.000Z',
      model: 'test',
      type: 'hallucination',
      description: 'Outra',
      correctionStatus: 'stable',
      originalLength: 30,
      correctedLength: 35,
    });

    const stats = await journal.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byType).toEqual({ hallucination: 2, syntax: 1 });
    expect(stats.byStatus).toEqual({ stable: 2, suspicious: 1 });
    expect(stats.lastEntry).toBe('2026-05-09T12:00:00.000Z');
  });

  it('deve carregar de arquivo corrompido retornando vazio', async () => {
    // Cria arquivo inválido
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, 'invalid json', 'utf-8');

    const loaded = await journal.getEntries();
    expect(loaded).toEqual([]);
  });

  it('deve carregar de arquivo com versão inválida retornando vazio', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, JSON.stringify({ version: 999, entries: [] }), 'utf-8');

    const loaded = await journal.getEntries();
    expect(loaded).toEqual([]);
  });
});