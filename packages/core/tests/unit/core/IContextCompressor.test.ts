import { describe, it, expect } from 'vitest';
import { assessCompressionNeed, CompressionTrigger } from '../../../src/core/IContextCompressor';

describe('assessCompressionNeed', () => {
  const CONTEXT_LIMIT = 1000;

  it('retorna NONE quando a proporcao esta abaixo de 70%', () => {
    // 69% → NONE
    const result = assessCompressionNeed(690, CONTEXT_LIMIT);
    expect(result).toBe(CompressionTrigger.NONE);
  });

  it('retorna SOFT quando a proporcao atinge exatamente 70%', () => {
    // 70% → SOFT
    const result = assessCompressionNeed(700, CONTEXT_LIMIT);
    expect(result).toBe(CompressionTrigger.SOFT);
  });

  it('retorna HARD quando a proporcao atinge exatamente 85%', () => {
    // 85% → HARD
    const result = assessCompressionNeed(850, CONTEXT_LIMIT);
    expect(result).toBe(CompressionTrigger.HARD);
  });

  it('retorna SOFT entre 70% e 84%', () => {
    const result = assessCompressionNeed(750, CONTEXT_LIMIT);
    expect(result).toBe(CompressionTrigger.SOFT);
  });

  it('retorna HARD acima de 85%', () => {
    const result = assessCompressionNeed(900, CONTEXT_LIMIT);
    expect(result).toBe(CompressionTrigger.HARD);
  });

  it('retorna NONE com contextLimit zero', () => {
    const result = assessCompressionNeed(1000, 0);
    expect(result).toBe(CompressionTrigger.NONE);
  });

  it('retorna NONE com contextLimit negativo', () => {
    const result = assessCompressionNeed(1000, -1);
    expect(result).toBe(CompressionTrigger.NONE);
  });

  it('retorna NONE quando estimatedTokens é zero', () => {
    const result = assessCompressionNeed(0, CONTEXT_LIMIT);
    expect(result).toBe(CompressionTrigger.NONE);
  });
});