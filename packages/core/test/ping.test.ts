import { describe, expect, it } from 'vitest';
import { ping } from '../src/index';

describe('ping', () => {
  it('returns pong', () => {
    expect(ping()).toBe('pong from @pdfx/core');
  });
});
