import { describe, test, expect } from 'bun:test';
import { formatDate, parseConfig, debounce } from '../src/utils';

describe('formatDate', () => {
  test('formats a date correctly', () => {
    const date = new Date(2026, 0, 15, 9, 30);
    expect(formatDate(date)).toBe('2026-01-15 09:30');
  });
});

describe('parseConfig', () => {
  test('parses key=value pairs', () => {
    const input = 'HOST=localhost\nPORT=3000\n# comment\n';
    const result = parseConfig(input);
    expect(result.HOST).toBe('localhost');
    expect(result.PORT).toBe('3000');
  });
});
