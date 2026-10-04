import type { Metadata } from 'next';
import { GuideForm } from '@/components/field-guide/GuideForm';

export const metadata: Metadata = {
  title: 'Free Online S-Corp Field Guide | CoinPayPortal',
  description: 'A practical Los Gatos and Santa Clara County operating guide from the creators of CoinPayPortal, with accounting tips for humans and technical guidance for agents.',
  alternates: { canonical: '/get-guide' },
};

export default function GetGuidePage() {
  return (
    <section className="bg-[#f4f1e9] px-6 py-12 text-[#203b2f] sm:py-20">
      <div className="mx-auto grid max-w-6xl items-start gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9b4d2b]">CoinPayPortal / The founder's field guides</p>
          <h1 className="mt-7 font-serif text-5xl leading-[1.07] sm:text-6xl">The online<br />S-corp<br /><em className="text-[#9b4d2b]">field guide.</em></h1>
          <p className="mt-6 text-xl">Los Gatos &amp; surrounding cities</p>
          <p className="mt-4 max-w-lg leading-relaxed">Local approvals. Owner pay. Books. Digital sales. A practical handbook for Santa Clara County founders, created by Profullstack, Inc., the team behind CoinPayPortal.</p>
          <div className="mt-8 border-y border-[#b5bcae] py-6">
            <h2 className="font-serif text-2xl">A field guide, not another software pitch.</h2>
            <p className="mt-3 leading-relaxed">Fourteen chapters and eight worksheets, with plain-language accounting tips for humans and technical tips for agents. Includes CoinPay workflows, dated cost comparisons, Mercury banking, and moomoo investing considerations.</p>
          </div>
          <p className="mt-6 text-sm leading-relaxed">This is a vendor-authored, AI-assisted educational guide, not an independent product review or individualized legal, tax, accounting, or investment advice. CoinPayPortal, Mercury and moomoo perform different roles; no native integration or universal product ranking is promised.</p>
          <p className="mt-6 text-sm">Outside Santa Clara County? The download confirmation includes an optional regional setup call through our <a href="/contact" className="font-semibold underline">official contact page</a>.</p>
        </div>
        <GuideForm />
      </div>
    </section>
  );
}
