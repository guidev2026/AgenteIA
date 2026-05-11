import { describe, it, expect } from 'vitest';
import { JsonValidator, ValidationError } from '../../../src/validation/JsonValidator';

/**
 * Testes unitários para JsonValidator.
 *
 * Função pura, sem dependências, sem I/O.
 * Zero consumo de CPU além do necessário.
 */

describe('JsonValidator.validate()', () => {
  const validator = new JsonValidator();

  it('parseia JSON válido corretamente', () => {
    const result = validator.validate('{"chave": "valor"}');
    expect(result).toEqual({ chave: 'valor' });
  });

  it('usa o tipo genérico passado', () => {
    interface MeuTipo {
      nome: string;
      idade: number;
    }
    const result = validator.validate<MeuTipo>('{"nome":"João","idade":30}');
    expect(result.nome).toBe('João');
    expect(result.idade).toBe(30);
  });

  it('lança ValidationError para JSON inválido', () => {
    try {
      validator.validate('{invalido}', 'test response');
      expect.unreachable('Deveria ter lançado erro');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toHaveProperty('message');
      expect((err as ValidationError).message).toContain('test response');
    }
  });

  it('inclui preview do raw na mensagem de erro', () => {
    const rawInvalido = 'texto completamente inválido {{{';
    try {
      validator.validate(rawInvalido);
      expect.unreachable('Deveria ter lançado erro');
    } catch (err) {
      expect((err as ValidationError).message).toContain('texto completamente');
    }
  });

  it('rawPreview tem no máximo 200 caracteres', () => {
    const rawLong = 'a'.repeat(1000);
    try {
      validator.validate(rawLong);
      expect.unreachable('Deveria ter lançado erro');
    } catch (err) {
      expect((err as ValidationError).rawPreview.length).toBeLessThanOrEqual(200);
    }
  });

  it('usa "response" como contextLabel padrão', () => {
    try {
      validator.validate('not json');
    } catch (err) {
      expect((err as ValidationError).message).toContain('response');
    }
  });

  it('parseia arrays JSON', () => {
    const result = validator.validate<number[]>('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parseia valores primitivos JSON', () => {
    expect(validator.validate('"string"')).toBe('string');
    expect(validator.validate('42')).toBe(42);
    expect(validator.validate('null')).toBeNull();
  });
});

describe('JsonValidator.tryValidate()', () => {
  const validator = new JsonValidator();

  it('retorna objeto parseado para JSON válido', () => {
    const result = validator.tryValidate('{"ok": true}');
    expect(result).toEqual({ ok: true });
  });

  it('retorna null para JSON inválido (sem lançar erro)', () => {
    const result = validator.tryValidate('{broken}');
    expect(result).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(validator.tryValidate('')).toBeNull();
  });
});

describe('ValidationError', () => {
  it('herda de Error e tem nome ValidationError', () => {
    const err = new ValidationError('msg', 'raw');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ValidationError');
  });

  it('rawPreview é cortado em 200 chars', () => {
    const longRaw = 'x'.repeat(500);
    const err = new ValidationError('msg', longRaw);
    expect(err.rawPreview.length).toBe(200);
  });
});