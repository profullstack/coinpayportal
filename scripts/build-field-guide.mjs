// Rebuilds the CoinPayPortal founder's field guide PDF from content.mjs.
//
// The original Edition 1.3 PDF was lost (never committed, not recoverable), so
// this regenerates a real, branded guide from the documented outline and writes
// it to public/guides/, then updates docs/field-guide-asset.json to match the
// bytes it actually produced. Deterministic: same content in, same PDF out.
//
// Usage: node scripts/build-field-guide.mjs
// Requires Playwright's Chromium (already used by the repo's e2e tests).

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { META, REGIONAL_CALLOUT, DISCLAIMER_PARAS, HOW_TO_USE, PARTS, WORKSHEETS } from './field-guide/content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PDF = path.join(root, 'public', 'guides', 'coinpayportal-los-gatos-field-guide-edition-1-3.pdf');
const MANIFEST = path.join(root, 'docs', 'field-guide-asset.json');

// Escape for both text and attribute contexts (quotes included), so values
// interpolated into href="…" are safe.
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function callout() {
  return `<aside class="callout"><h4>${esc(REGIONAL_CALLOUT.heading)}</h4><p>${esc(REGIONAL_CALLOUT.body)}</p>
  <p class="contact">${esc(META.contactEmail)} &middot; ${esc(META.contactPhone)} &middot; <a href="${esc(META.contactUrl)}">${esc(META.contactUrl)}</a></p></aside>`;
}

function renderHtml() {
  let chapterNo = 0;
  const toc = [];
  const body = [];

  for (const group of PARTS) {
    body.push(`<section class="part-divider"><p class="part-label">${esc(group.part)}</p><h2>${esc(group.name)}</h2></section>`);
    for (const ch of group.chapters) {
      chapterNo += 1;
      toc.push({ no: chapterNo, title: ch.title, part: group.name });
      const secs = ch.sections.map((s) => `<h3>${esc(s.h)}</h3>${s.p.map((p) => `<p>${esc(p)}</p>`).join('')}`).join('');
      const list = ch.checklist.map((c) => `<li>${esc(c)}</li>`).join('');
      body.push(`<section class="chapter"><p class="chapter-kicker">${esc(group.part)} &middot; Chapter ${chapterNo}</p>
        <h2>${esc(ch.title)}</h2><p class="chapter-intro">${esc(ch.intro)}</p>${secs}
        <div class="checklist"><h4>Checklist</h4><ul>${list}</ul></div></section>`);
    }
    // A regional setup callout at the end of each part.
    body.push(`<section class="callout-page">${callout()}</section>`);
  }

  const worksheets = WORKSHEETS.map((w) => {
    const rows = w.fields
      .map((f) => `<div class="ws-row"><div class="ws-label"><span>${esc(f.label)}</span>${f.hint ? `<em>${esc(f.hint)}</em>` : ''}</div><div class="ws-line"></div></div>`)
      .join('');
    return `<section class="worksheet"><h2>${esc(w.title)}</h2><p class="chapter-intro">${esc(w.intro)}</p>${rows}</section>`;
  }).join('');

  const tocHtml = toc
    .map((t) => `<li><span class="toc-no">${t.no}</span><span class="toc-title">${esc(t.title)}</span></li>`)
    .join('');
  const wsTocHtml = WORKSHEETS.map((w) => `<li><span class="toc-title">${esc(w.title)}</span></li>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  :root { --cream:#f4f1e9; --ink:#203b2f; --rust:#9b4d2b; --line:#b5bcae; --soft:#5c6b5f; }
  * { box-sizing: border-box; }
  @page { size: Letter; margin: 22mm 20mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background:#fff; margin:0; font-size: 11.5pt; line-height: 1.6; }
  h1,h2,h3,h4 { font-family: Georgia, serif; font-weight: 700; line-height: 1.15; }
  p { margin: 0 0 11px; }
  a { color: var(--rust); text-decoration: none; }
  .cover { height: 232mm; background: var(--cream); display:flex; flex-direction:column; justify-content:space-between; padding: 26mm 22mm; page-break-after: always; }
  .cover .brand { font-family: Georgia, serif; font-size: 10pt; letter-spacing: .22em; text-transform: uppercase; color: var(--rust); }
  .cover h1 { font-size: 46pt; line-height: 1.04; margin: 0; }
  .cover h1 em { color: var(--rust); font-style: italic; }
  .cover .sub { font-size: 17pt; margin-top: 14px; }
  .cover .edition { font-size: 11pt; color: var(--soft); margin-top: 8px; }
  .cover .pub { font-size: 10.5pt; color: var(--soft); }
  .page { page-break-after: always; }
  .disclaimer { background: var(--cream); padding: 16mm 14mm; }
  .disclaimer h3 { font-size: 13pt; margin: 0 0 10px; }
  .disclaimer p { font-size: 9.5pt; color:#2c4034; }
  .howto h2, .toc h2 { font-size: 20pt; border-bottom: 2px solid var(--line); padding-bottom: 8px; }
  .howto h3 { font-size: 12pt; color: var(--rust); margin-top: 16px; }
  .howto ul { margin: 0 0 10px; padding-left: 18px; }
  .howto li { margin-bottom: 7px; }
  .toc ol { list-style: none; padding: 0; margin: 0; }
  .toc li { display:flex; gap: 12px; padding: 6px 0; border-bottom: 1px dotted var(--line); font-size: 11pt; }
  .toc .toc-no { color: var(--rust); font-weight: 700; width: 22px; }
  .toc .toc-sub { margin-top: 18px; font-size: 10pt; letter-spacing:.14em; text-transform:uppercase; color: var(--soft); }
  .part-divider { page-break-before: always; background: var(--ink); color: var(--cream); height: 232mm; display:flex; flex-direction:column; justify-content:center; padding: 0 24mm; page-break-after: always; }
  .part-divider .part-label { letter-spacing:.24em; text-transform:uppercase; color:#cfa07e; font-size: 11pt; margin:0; }
  .part-divider h2 { font-size: 34pt; margin: 8px 0 0; }
  .chapter { page-break-before: always; }
  .chapter-kicker { letter-spacing:.16em; text-transform:uppercase; color: var(--rust); font-size: 9pt; margin: 0 0 4px; }
  .chapter h2 { font-size: 23pt; margin: 0 0 12px; }
  .chapter-intro { font-size: 12.5pt; font-style: italic; color:#2c4034; margin-bottom: 16px; }
  .chapter h3 { font-size: 13pt; margin: 18px 0 6px; }
  .checklist { margin-top: 20px; background: var(--cream); border-left: 4px solid var(--rust); padding: 12px 16px; }
  .checklist h4 { margin: 0 0 6px; font-size: 11pt; letter-spacing:.08em; text-transform: uppercase; }
  .checklist ul { margin: 0; padding-left: 18px; }
  .checklist li { margin-bottom: 5px; }
  .callout-page { page-break-before: always; display:flex; align-items:center; min-height: 180mm; }
  .callout { background: var(--cream); border: 1px solid var(--line); border-top: 4px solid var(--rust); padding: 22px 26px; width:100%; }
  .callout h4 { font-size: 15pt; margin: 0 0 8px; }
  .callout .contact { font-size: 10pt; color: var(--soft); margin-top: 10px; }
  .worksheet { page-break-before: always; }
  .worksheet h2 { font-size: 19pt; border-bottom: 2px solid var(--line); padding-bottom: 8px; }
  .ws-row { margin: 14px 0; }
  .ws-label { display:flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .ws-label span { font-weight: 700; font-size: 11pt; }
  .ws-label em { color: var(--soft); font-size: 9pt; font-style: italic; }
  .ws-line { height: 22px; border-bottom: 1px solid var(--line); margin-top: 4px; }
  .end { page-break-before: always; background: var(--cream); padding: 24mm 18mm; min-height: 200mm; }
  .end h2 { font-size: 22pt; }
  .end .contact { font-size: 11pt; color: var(--ink); margin-top: 14px; }
  </style></head><body>
  <section class="cover">
    <div><p class="brand">${esc(META.publisher)}</p></div>
    <div><h1>The online<br>S-corp<br><em>field guide.</em></h1>
      <p class="sub">${esc(META.subtitle)}</p>
      <p class="edition">${esc(META.edition)}</p></div>
    <div><p class="pub">A practical operating handbook for Santa Clara County founders.<br>Accounting tips for humans. Technical guidance for agents.</p></div>
  </section>

  <section class="page disclaimer">
    <h3>Please read this first</h3>
    ${DISCLAIMER_PARAS.map((p) => `<p>${esc(p)}</p>`).join('')}
  </section>

  <section class="page howto">
    <h2>${esc(HOW_TO_USE.title)}</h2>
    <h3>For humans</h3><ul>${HOW_TO_USE.forHumans.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>For agents</h3><ul>${HOW_TO_USE.forAgents.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </section>

  <section class="page toc">
    <h2>Contents</h2>
    <ol>${tocHtml}</ol>
    <p class="toc-sub">Worksheets</p>
    <ol>${wsTocHtml}</ol>
  </section>

  ${body.join('\n')}

  <section class="worksheet" style="page-break-before:always"><h2>Worksheets</h2>
    <p class="chapter-intro">Reading about this is not the same as writing it down. Fill these in and keep them with your records.</p></section>
  ${worksheets}

  <section class="end">
    <h2>Questions, or want a hand?</h2>
    <p>${esc(REGIONAL_CALLOUT.body)}</p>
    <p class="contact">${esc(META.contactEmail)}<br>${esc(META.contactPhone)}<br><a href="${esc(META.contactUrl)}">${esc(META.contactUrl)}</a></p>
    <p style="margin-top:18px;font-size:9.5pt;color:#5c6b5f">${esc(META.edition)} &middot; ${esc(META.publisher)}. Educational use only; not legal, tax, accounting or investment advice.</p>
  </section>
  </body></html>`;
}

function countPages(pdf) {
  // Count page objects without a PDF library: good enough for a generated file.
  const matches = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

async function main() {
  const html = renderHtml();
  await mkdir(path.dirname(OUT_PDF), { recursive: true });
  // Allow an explicit Chromium path (CHROME_PATH) when Playwright's own
  // download does not match the installed browser revision.
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: OUT_PDF,
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      footerTemplate:
        '<div style="width:100%;font-family:Georgia,serif;font-size:8px;color:#5c6b5f;padding:0 18mm;text-align:center;">' +
        'The Online S-Corp Field Guide &middot; coinpayportal.com &middot; <span class="pageNumber"></span></div>',
      headerTemplate: '<div></div>',
    });
  } finally {
    await browser.close();
  }

  const bytes = await readFile(OUT_PDF);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pages = countPages(bytes);
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  manifest.edition = '1.3';
  manifest.pages = pages;
  manifest.bytes = bytes.length;
  manifest.sha256 = sha256;
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built ${path.relative(root, OUT_PDF)}: ${pages} pages, ${bytes.length} bytes`);
  console.log(`sha256 ${sha256}`);
}

await main();
