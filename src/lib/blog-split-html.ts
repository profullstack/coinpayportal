// Finds a safe place to drop a mid-article ad into rendered post HTML.
//
// Post bodies are sanitized markdown injected with dangerouslySetInnerHTML, so
// a naive "cut at the halfway character" would routinely land inside a list, a
// blockquote or a code block and leave unbalanced tags in both halves. This
// only ever cuts after a top-level block element closes.

/** Block elements we're willing to cut after. */
const CLOSERS = new Set([
  'p',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'table',
  'figure',
]);

/** Elements whose interior must stay intact — never cut while inside one. */
const CONTAINERS = new Set([
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'figure',
  'figcaption',
  'dl',
  'dd',
  'dt',
  'div',
  'details',
  'section',
]);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

/** Below this, an article is too short to be worth interrupting. */
const MIN_LENGTH = 1500;

// Keep the break away from the very start and end of the body. A single big
// block (a long list, a 200-line code sample) can straddle the midpoint and
// leave no legal boundary in the preferred window — rather than drop the unit
// entirely on exactly those long posts, fall back to a wider window before
// giving up.
const PREFERRED_WINDOW = [0.25, 0.75] as const;
const FALLBACK_WINDOW = [0.12, 0.88] as const;

export type SplitHtml = { before: string; after: string };

/**
 * Split `html` into two halves at the top-level block boundary nearest the
 * midpoint, for an ad to sit between. Returns null when the article is too
 * short or has no safe boundary — callers should then render it unsplit.
 */
export function splitHtmlForMidAd(html: string | null | undefined): SplitHtml | null {
  if (!html || html.length < MIN_LENGTH) return null;

  // Every top-level block boundary in the document, in order.
  const boundaries: number[] = [];
  let depth = 0;

  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(html)) !== null) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const selfClosing = m[3] === '/';

    if (CONTAINERS.has(name) && !selfClosing) {
      if (closing) depth = Math.max(0, depth - 1);
      else depth += 1;
    }

    if (closing && depth === 0 && CLOSERS.has(name)) {
      boundaries.push(m.index + m[0].length);
    }
  }

  const target = html.length / 2;
  const nearestWithin = ([lo, hi]: readonly [number, number]) => {
    const lower = html.length * lo;
    const upper = html.length * hi;
    let pick: number | null = null;
    let bestDistance = Infinity;
    for (const offset of boundaries) {
      if (offset < lower || offset > upper) continue;
      const distance = Math.abs(offset - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        pick = offset;
      }
    }
    return pick;
  };

  const best = nearestWithin(PREFERRED_WINDOW) ?? nearestWithin(FALLBACK_WINDOW);
  if (best === null) return null;

  const before = html.slice(0, best);
  const after = html.slice(best);
  // A boundary that leaves only whitespace behind is no boundary at all.
  if (!after.trim()) return null;

  return { before, after };
}
