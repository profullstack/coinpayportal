// Minimal markdown -> HTML string converter.
// Supports: ATX headings, fenced code blocks, inline code, **bold**, *italic*,
// unordered lists, ordered lists, links, paragraphs, horizontal rules.
// This is intentionally tiny — we control the input (our own prompt files).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(s: string): string {
  // Code spans first (so their contents aren't further parsed).
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code) => {
    codeSpans.push(`<code class="px-1.5 py-0.5 rounded bg-slate-800 text-purple-300 text-sm">${escapeHtml(code)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    `<a href="${url}" class="text-purple-400 hover:text-purple-300 underline" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );

  // Bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');
  // Italic *text*
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // Restore code spans
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codeSpans[Number(i)]);

  return s;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return;
    out.push(`<p class="text-gray-300 leading-relaxed mb-4">${renderInline(buf.join(' '))}</p>`);
    buf.length = 0;
  };

  let para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushParagraph(para);
      const lang = fence[1] || '';
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(
        `<pre class="bg-slate-950 border border-slate-800 rounded-lg p-4 overflow-x-auto mb-4"><code class="text-sm text-gray-100 font-mono" data-lang="${lang}">${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const sizes: Record<number, string> = {
        1: 'text-4xl font-bold text-white mt-2 mb-6',
        2: 'text-2xl font-bold text-white mt-8 mb-4',
        3: 'text-xl font-semibold text-white mt-6 mb-3',
        4: 'text-lg font-semibold text-white mt-4 mb-2',
        5: 'text-base font-semibold text-white mt-4 mb-2',
        6: 'text-sm font-semibold text-white mt-4 mb-2',
      };
      out.push(`<h${level} class="${sizes[level]}">${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr class="border-slate-800 my-6" />');
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push(
        `<ul class="list-disc list-outside pl-6 mb-4 space-y-1 text-gray-300">${items
          .map((it) => `<li>${renderInline(it)}</li>`)
          .join('')}</ul>`,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      out.push(
        `<ol class="list-decimal list-outside pl-6 mb-4 space-y-1 text-gray-300">${items
          .map((it) => `<li>${renderInline(it)}</li>`)
          .join('')}</ol>`,
      );
      continue;
    }

    // Blank line ends paragraph
    if (line.trim() === '') {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line);
    i++;
  }

  flushParagraph(para);
  return out.join('\n');
}
