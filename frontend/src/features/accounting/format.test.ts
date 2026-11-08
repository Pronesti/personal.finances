import { expect, it } from 'vitest';
import { nativeMoney } from './Accounting';
it('formats native cents using the frozen display vectors without float conversion', () => {
  expect(nativeMoney(123456, 'ARS')).toBe('$\u00a01.234,56');
  expect(nativeMoney(500, 'USD')).toBe('US$ 5.00');
  expect(nativeMoney('9007199254740992', 'USD')).toBe('US$ 90071992547409.92');
});
