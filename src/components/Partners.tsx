'use client';

import { useEffect, useState } from 'react';

interface Partner {
  name: string;
  url: string;
  description: string | null;
}

export function Partners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/partners')
      .then((res) => res.json())
      .then((data) => setPartners(data.partners || []))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading || partners.length === 0) return null;

  return (
    <section className="relative py-20 bg-slate-900/50">
      {/* Top divider */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-sm uppercase tracking-widest text-gray-500 mb-3">
            Trusted by Innovative Businesses
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Our Partners
          </h2>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-10 sm:gap-14 lg:gap-20">
          {partners.map((partner) => (
            <a
              key={partner.url}
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              title={partner.description || partner.name}
              className="group flex items-center justify-center px-4 py-3 rounded-xl transition-all duration-300 hover:bg-white/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${partner.url}/logo.svg`}
                alt={partner.name}
                className="h-8 sm:h-10 w-auto opacity-40 group-hover:opacity-90 transition-all duration-300 brightness-0 invert"
                onError={(e) => {
                  // Fallback to text if logo fails to load
                  const el = e.target as HTMLImageElement;
                  el.style.display = 'none';
                  const span = document.createElement('span');
                  span.className = 'text-2xl sm:text-3xl font-bold text-white/40 group-hover:text-white/90 tracking-tight';
                  span.textContent = partner.name;
                  el.parentElement?.appendChild(span);
                }}
              />
            </a>
          ))}
        </div>

        <p className="text-center text-gray-600 text-sm mt-10">
          Powered by CoinPayPortal
        </p>
      </div>

      {/* Bottom divider */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </section>
  );
}
