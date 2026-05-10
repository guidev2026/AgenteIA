/**
 * Tests for SearchReplaceEditor — Edição por bloco exato com normalização.
 *
 * Cenários (Critério de Aceitação):
 * ✅ Match exato (sucesso): substituição ocorre, arquivo é escrito
 * ✅ Zero matches (falha): matchCount: 0, arquivo não escrito
 * ✅ Múltiplos matches (falha): matchCount: N, mensagem pedindo bloco mais específico
 * ✅ \r\n vs \n (sucesso): normalização trata diferença de CRLF
 * ✅ Trailing whitespace diferente (sucesso): trimEnd normaliza
 * ✅ Indentação diferente (falha): indentação é significativa
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchReplaceEditor } from '../../../src/core/SearchReplaceEditor';
import type { FileReader } from '../../../src/core/FileReader';

// Mock do fs nativo
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
  },
  writeFile: vi.fn(),
}));

import * as fs from 'node:fs/promises';

describe('SearchReplaceEditor', () => {
  let mockFileReader: FileReader;
  let editor: SearchReplaceEditor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileReader = {
      readFile: vi.fn(),
      readDir: vi.fn(),
      searchFiles: vi.fn(),
    };
    editor = new SearchReplaceEditor(mockFileReader);
  });

  describe('apply — match exato (sucesso)', () => {
    it('deve substituir bloco único e escrever o arquivo', async () => {
      const source = `function hello() {\n  return 'world';\n}\n\nconst x = 1;\n`;
      const search = `function hello() {\n  return 'world';\n}`;
      const replace = `function hello() {\n  return 'universe';\n}`;
      const expected = `function hello() {\n  return 'universe';\n}\n\nconst x = 1;\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.apply('/fake/file.ts', search, replace);

      expect(result.success).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(result.filePath).toBe('/fake/file.ts');
      expect(result.error).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalledWith('/fake/file.ts', expected, 'utf-8');
    });

    it('deve funcionar com bloco de múltiplas linhas no meio do arquivo', async () => {
      const source = `a\nb\nc\nd\ne\n`;
      const search = `b\nc\nd`;
      const replace = `B\nC\nD`;
      const expected = `a\nB\nC\nD\ne\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.apply('/fake/file.ts', search, replace);

      expect(result.success).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(fs.writeFile).toHaveBeenCalledWith('/fake/file.ts', expected, 'utf-8');
    });
  });

  describe('apply — zero matches (falha)', () => {
    it('deve retornar falha com matchCount: 0 quando bloco não existe', async () => {
      const source = `function hello() {\n  return 'world';\n}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);

      const result = await editor.apply('/fake/file.ts', 'notfound', 'replacement');

      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.error).toContain('0');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('deve retornar falha com matchCount: 0 para arquivo vazio', async () => {
      (mockFileReader.readFile as any).mockResolvedValue('');

      const result = await editor.apply('/fake/file.ts', 'anything', 'replacement');

      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('apply — múltiplos matches (falha)', () => {
    it('deve retornar falha com matchCount > 1', async () => {
      const source = `function dup() {}\n\nfunction dup() {}\n\nother\n`;
      const search = `function dup() {}`;

      (mockFileReader.readFile as any).mockResolvedValue(source);

      const result = await editor.apply('/fake/file.ts', search, 'replacement');

      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(2);
      expect(result.error).toContain('2');
      expect(result.error).toContain('específico');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('apply — normalização de \r\n vs \n', () => {
    it('deve casar search com \r\n contra conteúdo com \n', async () => {
      // Conteúdo com LF, search com CRLF
      const source = `a\nb\nc\n`;
      const search = `a\r\nb\r\nc`;
      const replace = `A\nB\nC`;
      // A busca encontra 'a\nb\nc' (normalizado), e substitui no original
      const expected = `A\nB\nC\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.apply('/fake/file.ts', search, replace);

      expect(result.success).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(fs.writeFile).toHaveBeenCalledWith('/fake/file.ts', expected, 'utf-8');
    });
  });

  describe('apply — trailing whitespace diferente (sucesso)', () => {
    it('deve casar search com trailing whitespace contra conteúdo sem', async () => {
      const source = `function hello() {\n  return 'world';\n}\n`;
      // search tem trailing whitespace em uma linha
      const search = `function hello() {\n  return 'world';   \n}`;
      const replace = `function hello() {\n  return 'universe';\n}`;
      const expected = `function hello() {\n  return 'universe';\n}\n`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockResolvedValue(undefined);

      const result = await editor.apply('/fake/file.ts', search, replace);

      expect(result.success).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(fs.writeFile).toHaveBeenCalledWith('/fake/file.ts', expected, 'utf-8');
    });
  });

  describe('apply — indentação diferente (falha)', () => {
    it('deve falhar quando indentação difere (indentação é significativa)', async () => {
      const source = `function hello() {\n  return 'world';\n}\n`;
      // search com indentação diferente (3 espaços vs 2)
      const search = `function hello() {\n   return 'world';\n}`;

      (mockFileReader.readFile as any).mockResolvedValue(source);

      const result = await editor.apply('/fake/file.ts', search, 'replacement');

      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('apply — cenário de erro de arquivo', () => {
    it('deve retornar falha quando o arquivo não pode ser lido', async () => {
      (mockFileReader.readFile as any).mockRejectedValue(
        new Error('ENOENT: no such file')
      );

      const result = await editor.apply('/nonexistent.ts', 'search', 'replace');

      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.error).toContain('ENOENT');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('deve retornar falha quando a escrita do arquivo falha', async () => {
      const source = `function ok() {}\n`;
      const search = `function ok() {}`;
      const replace = `function ok() { return 1; }`;

      (mockFileReader.readFile as any).mockResolvedValue(source);
      (fs.writeFile as any).mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await editor.apply('/fake/readonly.ts', search, replace);

      expect(result.success).toBe(false);
      expect(result.matchCount).toBe(1); // match encontrado, mas escrita falhou
      expect(result.error).toContain('EACCES');
    });
  });
});
