import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listPrompts, loadPrompt } from '../prompts';
import { markdownToHtml } from '../markdown';
import { CopyMarkdownButton } from '../CopyMarkdownButton';

export function generateStaticParams() {
  return listPrompts().map((p) => ({ slug: p.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PromptPage({ params }: PageProps) {
  const { slug } = await params;
  const markdown = loadPrompt(slug);
  if (!markdown) notFound();

  const html = markdownToHtml(markdown);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <Link href="/docs/prompts" className="inline-flex items-center text-purple-400 hover:text-purple-300">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            All prompts
          </Link>
          <CopyMarkdownButton markdown={markdown} />
        </div>

        <article
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
