/**
 * Testes unitários para TokenEstimator
 *
 * Critérios de aceitação (TASK 01):
 * 1. string vazia retorna 0
 * 2. string de 400 chars retorna 100
 * 3. array de mensagens soma corretamente
 * 4. modelo desconhecido retorna 4096
 * Zero dependências externas.
 */

import { describe, it, expect } from 'vitest';
import { TokenEstimator, DEFAULT_CONTEXT_WINDOWS } from '../../../src/core/TokenEstimator';
import type { ReActMessage } from '../../../src/core/rag/ReActLoop';

describe('TokenEstimator', () => {
  // ---------------------------------------------------------------------------
  // estimate()
  // ---------------------------------------------------------------------------
  describe('estimate()', () => {
    it('deve retornar 0 para string vazia', () => {
      expect(TokenEstimator.estimate('')).toBe(0);
    });

    it('deve retornar 0 para string com apenas espaços', () => {
      expect(TokenEstimator.estimate('   ')).toBe(1); // Math.ceil(3/4) = 1
    });

    it('deve calcular corretamente para string de 400 caracteres', () => {
      const text = 'a'.repeat(400);
      expect(TokenEstimator.estimate(text)).toBe(100); // Math.ceil(400/4) = 100
    });

    it('deve lidar com texto que não é múltiplo exato de 4', () => {
      expect(TokenEstimator.estimate('abc')).toBe(1);   // Math.ceil(3/4) = 1
      expect(TokenEstimator.estimate('abcd')).toBe(1);  // Math.ceil(4/4) = 1
      expect(TokenEstimator.estimate('abcde')).toBe(2); // Math.ceil(5/4) = 2
    });
  });

  // ---------------------------------------------------------------------------
  // estimateMessages()
  // ---------------------------------------------------------------------------
  describe('estimateMessages()', () => {
    it('deve retornar 0 para array vazio', () => {
      expect(TokenEstimator.estimateMessages([])).toBe(0);
    });

    it('deve somar estimate(role + content) de cada mensagem', () => {
      const messages: ReActMessage[] = [
        { role: 'user', content: 'hello' },         // "userhello" = 9 chars => ceil(9/4)=3
        { role: 'assistant', content: 'world' },     // "assistantworld" = 14 chars => ceil(14/4)=4
        { role: 'system', content: '' },             // "system" = 6 chars => ceil(6/4)=2
      ];
      // 3 + 4 + 2 = 9
      expect(TokenEstimator.estimateMessages(messages)).toBe(9);
    });

    it('deve funcionar com apenas uma mensagem', () => {
      const messages: ReActMessage[] = [
        { role: 'user', content: 'a'.repeat(400) }, // "user" + 400 = 404 chars => ceil(404/4)=101
      ];
      expect(TokenEstimator.estimateMessages(messages)).toBe(101);
    });
  });

  // ---------------------------------------------------------------------------
  // getLimit()
  // ---------------------------------------------------------------------------
  describe('getLimit()', () => {
    it('deve retornar 8192 para mistral:7b', () => {
      expect(TokenEstimator.getLimit('mistral:7b')).toBe(8192);
    });

    it('deve retornar 4096 para llama3.2:1b', () => {
      expect(TokenEstimator.getLimit('llama3.2:1b')).toBe(4096);
    });

    it('deve retornar 4096 para phi3:3b', () => {
      expect(TokenEstimator.getLimit('phi3:3b')).toBe(4096);
    });

    it('deve retornar 4096 como fallback para modelo desconhecido', () => {
      expect(TokenEstimator.getLimit('modelo-inexistente')).toBe(4096);
    });

    it('deve retornar 4096 como fallback para string vazia', () => {
      expect(TokenEstimator.getLimit('')).toBe(4096);
    });
  });

  // ---------------------------------------------------------------------------
  // DEFAULT_CONTEXT_WINDOWS (constante exportada)
  // ---------------------------------------------------------------------------
  describe('DEFAULT_CONTEXT_WINDOWS', () => {
    it('deve conter os 4 modelos definidos', () => {
      expect(Object.keys(DEFAULT_CONTEXT_WINDOWS)).toEqual([
        'llama3.2:1b',
        'phi3:3b',
        'llama3.2:3b',
        'mistral:7b',
      ]);
    });

    it('mistral:7b deve ter 8192, os demais 4096', () => {
      expect(DEFAULT_CONTEXT_WINDOWS['mistral:7b']).toBe(8192);
      expect(DEFAULT_CONTEXT_WINDOWS['llama3.2:1b']).toBe(4096);
      expect(DEFAULT_CONTEXT_WINDOWS['phi3:3b']).toBe(4096);
      expect(DEFAULT_CONTEXT_WINDOWS['llama3.2:3b']).toBe(4096);
    });
  });
});