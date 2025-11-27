interface CodeBlockProps {
  title?: string;
  language?: 'json' | 'curl' | 'javascript' | 'html' | 'bash';
  children: string;
}

const languageColors = {
  json: 'text-gray-300',
  curl: 'text-green-400',
  javascript: 'text-blue-400',
  html: 'text-orange-400',
  bash: 'text-green-400',
};

export function CodeBlock({ title, language = 'json', children }: CodeBlockProps) {
  return (
    <div className="mb-4">
      {title && (
        <h4 className="text-lg font-semibold text-white mb-2">{title}</h4>
      )}
      <div className="bg-slate-800/50 p-4 rounded-lg overflow-x-auto">
        <pre className={`text-sm ${languageColors[language]}`}>
          {children}
        </pre>
      </div>
    </div>
  );
}