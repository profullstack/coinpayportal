import { describe, expect, it } from 'vitest';
import { isDeadExternalUrl, stripDeadLinks } from './dead-links';

describe('stripDeadLinks', () => {
  it('unwraps dead anchors and keeps the text', () => {
    const html =
      '<p>Read <a href="https://jonandersen.substack.com/p/peptide-injection-without-fear-bbf/" rel="noopener">this</a>.</p>';
    expect(stripDeadLinks(html)).toBe('<p>Read this.</p>');
  });
  it('ignores query strings and fragments', () => {
    expect(
      isDeadExternalUrl('https://jonandersen.substack.com/p/hidden-inflammation-is-killing-your-3a6?utm=x#c'),
    ).toBe(true);
  });
  it('leaves live links and c0upons links alone', () => {
    const html =
      '<a href="https://c0upons.pwa.pit.world/blog/walgreens-coupon-code-workflow">c</a> <a href="https://jonandersen.substack.com/p/other">o</a>';
    expect(stripDeadLinks(html)).toBe(html);
  });
});
