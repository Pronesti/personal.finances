import { describe, expect, it } from 'vitest';
import { apiBase } from './client';

describe('trusted API configuration', () => {
  it('permits only the versioned HTTPS deployment URL', () => {
    expect(apiBase('https://api.tarjetas.test/api/v1')).toBe('https://api.tarjetas.test/api/v1');
    for (const value of [undefined, '/api/v1', 'http://api.test/api/v1', 'https://user:secret@api.test/api/v1', 'https://api.test/api/v1?redirect=https://evil.test', 'https://api.test/api/v2', 'https://api.test/api/v1#x']) {
      expect(() => apiBase(value)).toThrow();
    }
  });
});
