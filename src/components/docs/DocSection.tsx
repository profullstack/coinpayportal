interface DocSectionProps {
  title: string;
  children: React.ReactNode;
}

export function DocSection({ title, children }: DocSectionProps) {
  return (
    <section className="mb-12 p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
      <h2 className="text-3xl font-bold text-white mb-6">{title}</h2>
      {children}
    </section>
  );
}