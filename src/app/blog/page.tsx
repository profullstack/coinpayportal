import type { Metadata } from 'next';
import Link from 'next/link';
import { listPosts, formatBlogDate, SITE_URL } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog — CoinPay',
  description:
    'Crypto payments, Lightning, and merchant-side updates from the CoinPay team.',
  alternates: { canonical: `${SITE_URL}/blog` },
  openGraph: {
    title: 'Blog — CoinPay',
    description: 'Crypto payments, Lightning, and merchant-side updates from the CoinPay team.',
    url: `${SITE_URL}/blog`,
    type: 'website',
  },
};

export const dynamic = 'force-dynamic';

export default async function BlogIndexPage() {
  const posts = await listPosts(100);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <header className="mb-10 border-b border-slate-700/60 pb-6">
        <h1 className="text-4xl font-bold text-white sm:text-5xl">Blog</h1>
        <p className="mt-3 text-gray-400">
          Crypto payments, Lightning, and merchant-side updates from the CoinPay team.
        </p>
        <div className="mt-3 text-xs text-gray-500">
          <a href="/blog/rss.xml" className="hover:text-purple-300">RSS feed →</a>
        </div>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-8 text-center text-gray-400">
          No posts yet. Check back soon.
        </div>
      ) : (
        <ul className="space-y-6">
          {posts.map((post) => (
            <li
              key={post.id}
              className="group rounded-lg border border-slate-700/60 bg-slate-900/40 p-6 transition-colors hover:border-purple-500/50"
            >
              <Link href={`/blog/${post.slug}`} className="block">
                <div className="flex flex-col gap-4 sm:flex-row">
                  {post.image_url && (
                    <div className="sm:w-48 sm:flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.image_url}
                        alt=""
                        className="h-32 w-full rounded object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-semibold text-white transition-colors group-hover:text-purple-300 sm:text-2xl">
                      {post.title}
                    </h2>
                    {post.meta_description && (
                      <p className="mt-2 text-sm text-gray-400 line-clamp-3">
                        {post.meta_description}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <time dateTime={post.published_at}>{formatBlogDate(post.published_at)}</time>
                      {post.tags.length > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <div className="flex flex-wrap gap-1.5">
                            {post.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="rounded bg-purple-600/15 px-2 py-0.5 text-purple-300">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
