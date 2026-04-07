import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = path.join(process.cwd(), 'docs', 'prompts');

export interface PromptMeta {
  slug: string;
  title: string;
}

function titleFromSlug(slug: string): string {
  return slug
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function listPrompts(): PromptMeta[] {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      return { slug, title: titleFromSlug(slug) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function loadPrompt(slug: string): string | null {
  // Slug must be uppercase letters/digits/underscore only — prevents traversal.
  if (!/^[A-Z0-9_]+$/.test(slug)) return null;
  const file = path.join(PROMPTS_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}
