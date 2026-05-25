import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sanitizeBlogHtml } from './blog-sanitize';

describe('sanitizeBlogHtml', () => {
  it('strips allowed-but-empty <xmp> raw-text passthrough (GHSA-rpr9-rxv7-x643)', () => {
    const out1 = sanitizeBlogHtml('<xmp><script>alert(1)</script></xmp>');
    const out2 = sanitizeBlogHtml('<xmp><img src=x onerror=alert(1)></xmp>');
    const out3 = sanitizeBlogHtml('<xmp><svg><script>alert(1)</script></svg></xmp>');

    for (const out of [out1, out2, out3]) {
      expect(out).not.toContain('<script');
      expect(out).not.toContain('onerror');
      expect(out).not.toContain('<svg');
      expect(out).not.toContain('<img');
    }
  });

  it('keeps benign content intact', () => {
    const html = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeBlogHtml(html)).toBe(html);
  });

  it('rewrites <a> with safe rel/target', () => {
    const out = sanitizeBlogHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('does not open in-page TOC anchors in a new tab', () => {
    const out = sanitizeBlogHtml(
      '<a href="#intro" target="_blank" rel="noopener noreferrer">Intro</a>',
    );
    expect(out).toContain('href="#intro"');
    expect(out).not.toContain('target="_blank"');
    expect(out).not.toContain('rel="noopener noreferrer"');
  });
});
