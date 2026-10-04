import { toUnits, isNegativeAmount, negateAmount, type ExactAmount } from './decimal';
import { formatMoney, type ReportSummary, type SummaryMonth, type SummaryBreakdownLine, type SummaryBalance } from './report-summary';

/**
 * Charts for the executive summary, drawn once and rendered twice.
 *
 * Each chart is written against a small `Canvas` so the same geometry lands
 * in the HTML artifact (inline SVG, no script) and in the PDF (jsPDF vector
 * primitives). Colour never carries meaning alone: every series is named in
 * a legend or a direct label, estimated figures are a lighter tint AND
 * labelled "est.", and money owed is drawn to the left of a zero line as
 * well as in red.
 *
 * Geometry uses floating point on purpose: these are pixel positions. The
 * numbers printed beside them come from the exact decimal strings.
 */

export const CHART_COLORS = {
  income: '#2a78d6', // categorical slot 1, blue
  incomeEstimated: '#9ec5f4', // blue ramp step 200
  spending: '#eb6834', // categorical slot 2, orange
  spendingEstimated: '#f7bfa5',
  magnitude: '#2a78d6', // sequential, one hue
  owed: '#e34948', // diverging warm pole
  surface: '#ffffff',
  grid: '#e5e5e5',
  axis: '#c9c8c4',
  text: '#0b0b0b',
  muted: '#52514e',
} as const;

export interface TextOptions {
  size: number;
  color: string;
  anchor?: 'start' | 'middle' | 'end';
  baseline?: 'alphabetic' | 'middle' | 'hanging';
  bold?: boolean;
}

export interface Canvas {
  rect(x: number, y: number, w: number, h: number, fill: string): void;
  roundedRect(x: number, y: number, w: number, h: number, r: number, fill: string): void;
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): void;
  circle(cx: number, cy: number, r: number, fill: string, stroke?: string, strokeWidth?: number): void;
  text(x: number, y: number, value: string, opts: TextOptions): void;
  textWidth(value: string, size: number, bold?: boolean): number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// SVG backend
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Approximate Helvetica advance widths; only used to place and truncate labels. */
function approxWidth(value: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of value) {
    if (/[iljtfI.,:;'|!]/.test(ch)) w += 0.28;
    else if (/[mwMW@]/.test(ch)) w += 0.85;
    else if (/[A-Z0-9$€£]/.test(ch)) w += 0.62;
    else if (ch === ' ') w += 0.28;
    else w += 0.52;
  }
  return w * size * (bold ? 1.06 : 1);
}

export class SvgCanvas implements Canvas {
  private parts: string[] = [];
  constructor(readonly width: number, readonly height: number) {}

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    if (w <= 0 || h <= 0) return;
    this.parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${fill}"/>`);
  }
  roundedRect(x: number, y: number, w: number, h: number, r: number, fill: string): void {
    if (w <= 0 || h <= 0) return;
    const rr = Math.min(r, w / 2, h / 2);
    this.parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rr)}" ry="${fmt(rr)}" fill="${fill}"/>`);
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): void {
    this.parts.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${stroke}" stroke-width="${fmt(width)}" stroke-linecap="round"/>`);
  }
  circle(cx: number, cy: number, r: number, fill: string, stroke?: string, strokeWidth?: number): void {
    this.parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${fmt(strokeWidth ?? 1)}"` : ''}/>`);
  }
  text(x: number, y: number, value: string, opts: TextOptions): void {
    const anchor = opts.anchor === 'end' ? 'end' : opts.anchor === 'middle' ? 'middle' : 'start';
    const baseline = opts.baseline === 'middle' ? 'central' : opts.baseline === 'hanging' ? 'hanging' : 'alphabetic';
    this.parts.push(
      `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(opts.size)}" fill="${opts.color}" text-anchor="${anchor}" dominant-baseline="${baseline}"${opts.bold ? ' font-weight="600"' : ''}>${esc(value)}</text>`,
    );
  }
  textWidth(value: string, size: number, bold?: boolean): number {
    return approxWidth(value, size, bold);
  }
  toString(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" width="100%" role="img" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${this.parts.join('')}</svg>`;
  }
}

// ---------------------------------------------------------------------------
// jsPDF backend
// ---------------------------------------------------------------------------

/** The subset of jsPDF this module touches, so it needs no import of the library's types. */
export interface PdfDoc {
  setFillColor(color: string): unknown;
  setDrawColor(color: string): unknown;
  setLineWidth(width: number): unknown;
  setFontSize(size: number): unknown;
  setFont(name: string, style: string): unknown;
  setTextColor(color: string): unknown;
  rect(x: number, y: number, w: number, h: number, style: string): unknown;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style: string): unknown;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  circle(x: number, y: number, r: number, style: string): unknown;
  text(text: string, x: number, y: number, options?: { align?: 'left' | 'center' | 'right'; baseline?: 'alphabetic' | 'middle' | 'hanging' | 'top' }): unknown;
  getTextWidth(text: string): number;
}

export class PdfCanvas implements Canvas {
  constructor(private readonly doc: PdfDoc) {}

  rect(x: number, y: number, w: number, h: number, fill: string): void {
    if (w <= 0 || h <= 0) return;
    this.doc.setFillColor(fill);
    this.doc.rect(x, y, w, h, 'F');
  }
  roundedRect(x: number, y: number, w: number, h: number, r: number, fill: string): void {
    if (w <= 0 || h <= 0) return;
    const rr = Math.min(r, w / 2, h / 2);
    this.doc.setFillColor(fill);
    this.doc.roundedRect(x, y, w, h, rr, rr, 'F');
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): void {
    this.doc.setDrawColor(stroke);
    this.doc.setLineWidth(width);
    this.doc.line(x1, y1, x2, y2);
  }
  circle(cx: number, cy: number, r: number, fill: string, stroke?: string, strokeWidth?: number): void {
    this.doc.setFillColor(fill);
    if (stroke) {
      this.doc.setDrawColor(stroke);
      this.doc.setLineWidth(strokeWidth ?? 1);
      this.doc.circle(cx, cy, r, 'FD');
    } else {
      this.doc.circle(cx, cy, r, 'F');
    }
  }
  text(x: number, y: number, value: string, opts: TextOptions): void {
    this.doc.setFontSize(opts.size);
    this.doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    this.doc.setTextColor(opts.color);
    this.doc.text(value, x, y, {
      align: opts.anchor === 'end' ? 'right' : opts.anchor === 'middle' ? 'center' : 'left',
      baseline: opts.baseline === 'middle' ? 'middle' : opts.baseline === 'hanging' ? 'top' : 'alphabetic',
    });
  }
  textWidth(value: string, size: number, bold?: boolean): number {
    this.doc.setFontSize(size);
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
    return this.doc.getTextWidth(value);
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const TITLE_SIZE = 9;
const LABEL_SIZE = 7;
const BAR_RADIUS = 3;

function units(amount: ExactAmount): number {
  return Number(toUnits(amount)) / 10_000;
}

/** Axis tick text: $1.2k, $35k, $1.1M. Display only. */
export function compactMoney(value: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  let body: string;
  if (v >= 1_000_000) body = `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  else if (v >= 1_000) body = `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  else body = v.toFixed(0);
  return `${sign}${symbol}${body}${symbol ? '' : ` ${currency}`}`;
}

/** A round step so an axis has 3 to 5 gridlines. */
function niceStep(range: number): number {
  if (range <= 0) return 1;
  const raw = range / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * power);
  return candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1];
}

function truncate(cv: Canvas, value: string, size: number, maxWidth: number): string {
  if (cv.textWidth(value, size) <= maxWidth) return value;
  let s = value;
  while (s.length > 1 && cv.textWidth(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** A bar with a rounded data end and a square baseline end. */
function bar(cv: Canvas, x: number, y: number, w: number, h: number, fill: string, roundEnd: 'top' | 'right' | 'left') {
  if (w <= 0 || h <= 0) return;
  cv.roundedRect(x, y, w, h, BAR_RADIUS, fill);
  const r = Math.min(BAR_RADIUS, w / 2, h / 2);
  if (roundEnd === 'top') cv.rect(x, y + h - r, w, r, fill);
  else if (roundEnd === 'right') cv.rect(x, y, r, h, fill);
  else cv.rect(x + w - r, y, r, h, fill);
}

function title(cv: Canvas, box: Box, text: string): number {
  cv.text(box.x, box.y + TITLE_SIZE, text, { size: TITLE_SIZE, color: CHART_COLORS.text, bold: true });
  return box.y + TITLE_SIZE + 6;
}

function legend(cv: Canvas, x: number, y: number, items: Array<{ label: string; color: string; hollow?: boolean }>): number {
  let cx = x;
  for (const item of items) {
    if (item.hollow) cv.circle(cx + 4, y, 3.5, CHART_COLORS.surface, item.color, 1.5);
    else cv.roundedRect(cx, y - 4, 8, 8, 2, item.color);
    cv.text(cx + 11, y, item.label, { size: LABEL_SIZE, color: CHART_COLORS.muted, baseline: 'middle' });
    cx += 11 + cv.textWidth(item.label, LABEL_SIZE) + 10;
  }
  return y + 10;
}

function empty(cv: Canvas, box: Box, text: string) {
  cv.text(box.x + box.w / 2, box.y + box.h / 2, text, { size: LABEL_SIZE + 1, color: CHART_COLORS.muted, anchor: 'middle', baseline: 'middle' });
}

// ---------------------------------------------------------------------------
// Chart 1: money in vs money out by month (grouped bars, estimate stacked as a tint)
// ---------------------------------------------------------------------------

export function drawMonthlyFlows(cv: Canvas, box: Box, months: SummaryMonth[], currency: string): void {
  let y = title(cv, box, 'Money in vs money out, by month');
  const hasEstimate = months.some((m) => m.estimatedDays > 0);
  y = legend(cv, box.x, y + 4, [
    { label: 'Money in', color: CHART_COLORS.income },
    { label: 'Money out', color: CHART_COLORS.spending },
    ...(hasEstimate ? [{ label: 'Estimated (lighter, marked est.)', color: CHART_COLORS.incomeEstimated }] : []),
  ]);
  if (months.length === 0) return empty(cv, box, 'No months in this period');

  const axisWidth = 34;
  const plot: Box = { x: box.x + axisWidth, y: y + 4, w: box.w - axisWidth, h: box.y + box.h - y - 4 - 16 };
  const max = Math.max(0, ...months.flatMap((m) => [units(m.incomeWithEstimate), units(m.spendingWithEstimate)]));
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const scale = plot.h / top;

  for (let v = 0; v <= top + 1e-9; v += step) {
    const gy = plot.y + plot.h - v * scale;
    cv.line(plot.x, gy, plot.x + plot.w, gy, v === 0 ? CHART_COLORS.axis : CHART_COLORS.grid, 1);
    cv.text(plot.x - 4, gy, compactMoney(v, currency), { size: LABEL_SIZE, color: CHART_COLORS.muted, anchor: 'end', baseline: 'middle' });
  }

  const slot = plot.w / months.length;
  const barWidth = Math.min(24, Math.max(3, (slot - 6) / 2 - 1));
  months.forEach((m, i) => {
    const cx = plot.x + slot * i + slot / 2;
    const draw = (observed: ExactAmount, estimated: ExactAmount | null, x: number, color: string, tint: string) => {
      const oh = units(observed) * scale;
      const eh = estimated ? units(estimated) * scale : 0;
      const baseline = plot.y + plot.h;
      if (eh > 0 && oh > 0) {
        bar(cv, x, baseline - oh, barWidth, oh, color, 'top');
        // 2px surface gap between the observed and estimated segments.
        bar(cv, x, baseline - oh - 2 - eh, barWidth, eh, tint, 'top');
      } else if (eh > 0) bar(cv, x, baseline - eh, barWidth, eh, tint, 'top');
      else bar(cv, x, baseline - oh, barWidth, oh, color, 'top');
    };
    draw(m.income, m.estimatedIncome, cx - barWidth - 1, CHART_COLORS.income, CHART_COLORS.incomeEstimated);
    draw(m.spending, m.estimatedSpending, cx + 1, CHART_COLORS.spending, CHART_COLORS.spendingEstimated);
    const label = months.length > 8 ? m.label.slice(0, 3) : m.label;
    cv.text(cx, plot.y + plot.h + 9, label, { size: LABEL_SIZE, color: CHART_COLORS.muted, anchor: 'middle' });
    if (m.estimatedDays > 0) cv.text(cx, plot.y + plot.h + 16, m.estimatedDays === m.days ? 'est.' : 'part est.', { size: LABEL_SIZE - 1, color: CHART_COLORS.muted, anchor: 'middle' });
  });
}

// ---------------------------------------------------------------------------
// Chart 2: cumulative net over the period (line; hollow markers for estimated months)
// ---------------------------------------------------------------------------

export function drawCumulativeNet(cv: Canvas, box: Box, months: SummaryMonth[], currency: string): void {
  let y = title(cv, box, 'Running total: money in minus money out');
  const hasEstimate = months.some((m) => m.estimatedDays > 0);
  y = legend(cv, box.x, y + 4, [
    { label: 'Cumulative net', color: CHART_COLORS.income },
    ...(hasEstimate ? [{ label: 'Month includes an estimate', color: CHART_COLORS.income, hollow: true }] : []),
  ]);
  if (months.length === 0) return empty(cv, box, 'No months in this period');

  const axisWidth = 38;
  const endLabelWidth = 44;
  const plot: Box = { x: box.x + axisWidth, y: y + 6, w: box.w - axisWidth - endLabelWidth, h: box.y + box.h - y - 6 - 16 };
  const values = months.map((m) => units(m.cumulativeNet));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const step = niceStep(hi - lo || 1);
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const range = top - bottom || step;
  const scale = plot.h / range;
  const yOf = (v: number) => plot.y + plot.h - (v - bottom) * scale;

  for (let v = bottom; v <= top + 1e-9; v += step) {
    const gy = yOf(v);
    cv.line(plot.x, gy, plot.x + plot.w, gy, Math.abs(v) < 1e-9 ? CHART_COLORS.axis : CHART_COLORS.grid, 1);
    cv.text(plot.x - 4, gy, compactMoney(v, currency), { size: LABEL_SIZE, color: CHART_COLORS.muted, anchor: 'end', baseline: 'middle' });
  }

  const slot = plot.w / months.length;
  const points = months.map((m, i) => ({ x: plot.x + slot * i + slot / 2, y: yOf(units(m.cumulativeNet)), m }));
  for (let i = 1; i < points.length; i += 1) {
    cv.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, CHART_COLORS.income, 2);
  }
  for (const p of points) {
    if (p.m.estimatedDays > 0) cv.circle(p.x, p.y, 4, CHART_COLORS.surface, CHART_COLORS.income, 2);
    else cv.circle(p.x, p.y, 4, CHART_COLORS.income, CHART_COLORS.surface, 2);
    const label = months.length > 8 ? p.m.label.slice(0, 3) : p.m.label;
    cv.text(p.x, plot.y + plot.h + 9, label, { size: LABEL_SIZE, color: CHART_COLORS.muted, anchor: 'middle' });
  }
  const last = points[points.length - 1];
  cv.text(last.x + 8, last.y, formatMoney(last.m.cumulativeNet, currency), { size: LABEL_SIZE, color: CHART_COLORS.text, baseline: 'middle', bold: true });
}

// ---------------------------------------------------------------------------
// Chart 3 and 4: ranked horizontal bars (spending by category, income by source)
// ---------------------------------------------------------------------------

export function drawRankedBars(cv: Canvas, box: Box, lines: SummaryBreakdownLine[], currency: string, heading: string, color: string): void {
  const y = title(cv, box, heading);
  if (lines.length === 0) return empty(cv, box, 'Nothing in this period');
  const labelWidth = Math.min(110, box.w * 0.36);
  const valueWidth = 54;
  const plotX = box.x + labelWidth + 6;
  const plotW = box.w - labelWidth - 6 - valueWidth;
  const rowH = Math.min(18, (box.y + box.h - y - 4) / lines.length);
  const barH = Math.min(12, rowH - 4);
  const max = Math.max(1e-9, ...lines.map((l) => units(l.total)));
  lines.forEach((l, i) => {
    const cy = y + 4 + rowH * i + rowH / 2;
    cv.text(box.x + labelWidth, cy, truncate(cv, l.label, LABEL_SIZE, labelWidth), { size: LABEL_SIZE, color: CHART_COLORS.text, anchor: 'end', baseline: 'middle' });
    const w = (units(l.total) / max) * plotW;
    bar(cv, plotX, cy - barH / 2, Math.max(1, w), barH, l.key === 'other' ? CHART_COLORS.axis : color, 'right');
    cv.text(plotX + Math.max(1, w) + 4, cy, formatMoney(l.total, currency), { size: LABEL_SIZE, color: CHART_COLORS.muted, baseline: 'middle' });
  });
}

// ---------------------------------------------------------------------------
// Chart 5: balances by account, diverging around zero (owed to the left, in red)
// ---------------------------------------------------------------------------

export function drawBalances(cv: Canvas, box: Box, balances: SummaryBalance[], currency: string): void {
  let y = title(cv, box, 'Current balances by account');
  const known = balances.filter((b) => b.balance !== null);
  if (known.length === 0) return empty(cv, box, 'No balances reported');
  y = legend(cv, box.x, y + 4, [
    { label: 'Money held', color: CHART_COLORS.magnitude },
    { label: 'Owed (cards, loans)', color: CHART_COLORS.owed },
  ]);
  const sorted = [...known].sort((a, b) => units(b.balance as ExactAmount) - units(a.balance as ExactAmount));
  const labelWidth = Math.min(120, box.w * 0.36);
  const valueWidth = 54;
  const plotX = box.x + labelWidth + 6;
  const plotW = box.w - labelWidth - 6 - valueWidth;
  const rowH = Math.min(16, (box.y + box.h - y - 4) / sorted.length);
  const barH = Math.min(10, rowH - 4);
  const magnitudes = sorted.map((b) => Math.abs(units(b.balance as ExactAmount)));
  const maxPos = Math.max(0, ...sorted.filter((b) => !isNegativeAmount(b.balance as ExactAmount)).map((b) => units(b.balance as ExactAmount)));
  const maxNeg = Math.max(0, ...sorted.filter((b) => isNegativeAmount(b.balance as ExactAmount)).map((b) => -units(b.balance as ExactAmount)));
  const total = maxPos + maxNeg || Math.max(1e-9, ...magnitudes);
  const zeroX = plotX + (maxNeg / total) * plotW;
  cv.line(zeroX, y, zeroX, y + 4 + rowH * sorted.length, CHART_COLORS.axis, 1);
  sorted.forEach((b, i) => {
    const cy = y + 4 + rowH * i + rowH / 2;
    const amount = b.balance as ExactAmount;
    const negative = isNegativeAmount(amount);
    const w = (Math.abs(units(amount)) / total) * plotW;
    const name = `${b.name}${b.orgName ? ` · ${b.orgName}` : ''}`;
    cv.text(box.x + labelWidth, cy, truncate(cv, name, LABEL_SIZE, labelWidth), { size: LABEL_SIZE, color: CHART_COLORS.text, anchor: 'end', baseline: 'middle' });
    if (negative) {
      bar(cv, zeroX - w, cy - barH / 2, Math.max(1, w), barH, CHART_COLORS.owed, 'left');
      cv.text(zeroX + 4, cy, `${formatMoney(negateAmount(amount), currency)} owed`, { size: LABEL_SIZE, color: CHART_COLORS.muted, baseline: 'middle' });
    } else {
      bar(cv, zeroX, cy - barH / 2, Math.max(1, w), barH, CHART_COLORS.magnitude, 'right');
      cv.text(zeroX + Math.max(1, w) + 4, cy, formatMoney(amount, currency), { size: LABEL_SIZE, color: CHART_COLORS.muted, baseline: 'middle' });
    }
  });
}

// ---------------------------------------------------------------------------
// Convenience: the four SVGs for one currency
// ---------------------------------------------------------------------------

export function summarySvgs(summary: ReportSummary): { monthly: string; cumulative: string; spending: string; income: string; balances: string } {
  const one = (draw: (cv: Canvas, box: Box) => void, height = 200) => {
    const cv = new SvgCanvas(520, height);
    draw(cv, { x: 8, y: 6, w: 504, h: height - 12 });
    return cv.toString();
  };
  return {
    monthly: one((cv, box) => drawMonthlyFlows(cv, box, summary.months, summary.currency)),
    cumulative: one((cv, box) => drawCumulativeNet(cv, box, summary.months, summary.currency)),
    spending: one((cv, box) => drawRankedBars(cv, box, summary.spendingByCategory, summary.currency, 'Where the money went', CHART_COLORS.spending), 40 + 18 * Math.max(3, summary.spendingByCategory.length)),
    income: one((cv, box) => drawRankedBars(cv, box, summary.incomeBySource, summary.currency, 'Where the money came from', CHART_COLORS.income), 40 + 18 * Math.max(3, summary.incomeBySource.length)),
    balances: one((cv, box) => drawBalances(cv, box, summary.balances, summary.currency), 52 + 16 * Math.max(3, summary.balances.length)),
  };
}
