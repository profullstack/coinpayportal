import 'server-only';
import sanitizeHtml from 'sanitize-html';

const OPTIONS: sanitizeHtml.IOptions = {
  // Workaround for GHSA-rpr9-rxv7-x643 (CVE-2026-44990): sanitize-html's default
  // `nonTextTags` omits `xmp`, letting an attacker smuggle live markup through
  // <xmp>...</xmp>. Override the list so xmp's contents are discarded with the tag.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'xmp', 'noscript', 'noembed', 'noframes'],
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'loading'],
    '*': ['class', 'id'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? '';
      if (href.startsWith('#')) {
        const { target: _target, rel: _rel, ...rest } = attribs;
        return { tagName, attribs: rest };
      }
      return {
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      };
    },
  },
};

export function sanitizeBlogHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
