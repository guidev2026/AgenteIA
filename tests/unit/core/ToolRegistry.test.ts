import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../../src/core/ToolRegistry';

/**
 * Testes unitários para ToolRegistry.
 *
 * Nenhuma dependência externa — apenas Map interno e handlers mockados.
 * Zero consumo de CPU por Ollama, zero I/O.
 */

describe('ToolRegistry', () => {
  it('registra e executa uma tool com sucesso', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn().mockResolvedValue('resultado mock');

    registry.register(
      'myTool',
      'Uma ferramenta de teste',
      { input: { type: 'string', description: 'Entrada' } },
      handler
    );

    expect(registry.hasTool('myTool')).toBe(true);
    expect(registry.getToolNames()).toEqual(['myTool']);

    const result = await registry.execute('myTool', { input: 'hello' });
    expect(result).toBe('resultado mock');
    expect(handler).toHaveBeenCalledWith({ input: 'hello' });
  });

  it('lança erro ao executar tool inexistente', async () => {
    const registry = new ToolRegistry();

    await expect(
      registry.execute('toolInexistente', {})
    ).rejects.toThrow(/Unknown tool.*toolInexistente/);
  });

  it('hasTool retorna false para tool não registrada', () => {
    const registry = new ToolRegistry();
    expect(registry.hasTool('nonexistent')).toBe(false);
  });

  it('getToolNames retorna lista vazia quando sem tools', () => {
    const registry = new ToolRegistry();
    expect(registry.getToolNames()).toEqual([]);
  });

  it('getToolNames retorna todas as tools registradas', () => {
    const registry = new ToolRegistry();
    registry.register('a', 'tool A', {}, vi.fn());
    registry.register('b', 'tool B', {}, vi.fn());
    registry.register('c', 'tool C', {}, vi.fn());

    const names = registry.getToolNames();
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('c');
    expect(names).toHaveLength(3);
  });

  it('getDefinitions retorna JSON Schema válido', () => {
    const registry = new ToolRegistry();
    registry.register(
      'readFile',
      'Lê um arquivo',
      {
        path: { type: 'string', description: 'Caminho do arquivo' },
      },
      vi.fn()
    );

    const defs = registry.getDefinitions();
    const parsed = JSON.parse(defs);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('function');
    expect(parsed[0].function.name).toBe('readFile');
    expect(parsed[0].function.parameters.required).toEqual(['path']);
  });

  it('permite sobrescrever tool existente (último registro vence)', async () => {
    const registry = new ToolRegistry();
    const handlerOld = vi.fn().mockResolvedValue('old');
    const handlerNew = vi.fn().mockResolvedValue('new');

    registry.register('dup', 'versão original', {}, handlerOld);
    registry.register('dup', 'versão nova', {}, handlerNew);

    const result = await registry.execute('dup', {});
    expect(result).toBe('new');
    expect(handlerNew).toHaveBeenCalled();
    expect(handlerOld).not.toHaveBeenCalled();
  });

  it('tool registrada sem parâmetros funciona normalmente', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn().mockResolvedValue('sem params');

    registry.register('noParams', 'Tool sem parâmetros', {}, handler);

    const result = await registry.execute('noParams', {});
    expect(result).toBe('sem params');
  });

  it('erro do handler é propagado corretamente', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn().mockRejectedValue(new Error('falha interna'));

    registry.register('failing', 'Tool que falha', {}, handler);

    await expect(registry.execute('failing', {})).rejects.toThrow('falha interna');
  });
});