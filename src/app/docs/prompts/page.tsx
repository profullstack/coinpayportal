import Link from 'next/link';
import { listPrompts } from './prompts';

export const metadata = {
  title: 'Integration Prompts — CoinPay',
  description: 'Copy-paste prompts for integrating CoinPay features with an AI coding assistant.',
};

export default function PromptsIndexPage() {
  const prompts = listPrompts();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href="/docs" className="inline-flex items-center text-purple-400 hover:text-purple-300 mb-6">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Docs
        </Link>

        <h1 className="text-5xl font-bold text-white mb-4">Integration Prompts</h1>
        <p className="text-xl text-gray-300 mb-10">
          Pick a feature, copy the prompt, paste it into your AI coding assistant. Each prompt is a self-contained
          spec for integrating one CoinPay capability.
        </p>

        <ul className="space-y-3">
          {prompts.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/docs/prompts/${p.slug}`}
                className="block p-5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-purple-500 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white">{p.title}</div>
                    <div className="text-sm text-gray-400 font-mono mt-1">/docs/prompts/{p.slug}.md</div>
                  </div>
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
