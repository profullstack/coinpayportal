import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPostBySlug, sanitizeBlogHtml, formatBlogDate, SITE_URL } from '@/lib/blog';

type RouteParams = { params: Promise<{ slug: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: 'Not found — CoinPay' };
  const url = `${SITE_URL}/blog/${post.slug}`;
  const images = post.image_url ? [post.image_url] : ['/logo.svg'];
  return {
    title: `${post.title} — CoinPay`,
    description: post.meta_description || undefined,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.meta_description || undefined,
      url,
      type: 'article',
      publishedTime: post.published_at,
      images,
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.meta_description || undefined,
      images,
    },
  };
}

export default async function BlogPostPage({ params }: RouteParams) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const html = post.content_html ? sanitizeBlogHtml(post.content_html) : null;

  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.meta_description || undefined,
    image: post.image_url || undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    author: { '@type': 'Organization', name: 'CoinPay' },
    publisher: {
      '@type': 'Organization',
      name: 'CoinPay',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.svg` },
    },
    keywords: post.tags.join(', '),
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <article>
        <nav className="mb-6 text-sm">
          <Link href="/blog" className="text-gray-400 hover:text-purple-300">← All posts</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">{post.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-400">
            <time dateTime={post.published_at}>{formatBlogDate(post.published_at)}</time>
            {post.tags.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <div className="flex flex-wrap gap-1.5">
                  {post.tags.map((tag) => (
                    <span key={tag} className="rounded bg-purple-600/15 px-2 py-0.5 text-xs text-purple-300">
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          {post.image_url && (
            <div className="mt-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.image_url}
                alt={post.title}
                className="w-full rounded-lg border border-slate-700/60"
              />
            </div>
          )}
        </header>

        {html ? (
          <div className="blog-content" dangerouslySetInnerHTML={{ __html: html }} />
        ) : post.content_markdown ? (
          <pre className="whitespace-pre-wrap text-gray-300">{post.content_markdown}</pre>
        ) : (
          <p className="text-gray-400">No content.</p>
        )}

        <hr className="my-12 border-slate-700/60" />

        <div className="rounded-lg border border-purple-500/30 bg-purple-600/5 p-6">
          <h3 className="text-lg font-semibold text-white">Try CoinPay</h3>
          <p className="mt-2 text-sm text-gray-300">
            Non-custodial crypto payments — multi-chain, Lightning-ready, and fast to integrate.
          </p>
          <Link
            href="/register"
            className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700"
          >
            Get started →
          </Link>
        </div>
      </article>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }}
      />
    </div>
  );
}
