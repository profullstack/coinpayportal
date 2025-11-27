interface ApiEndpointProps {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  children?: React.ReactNode;
}

const methodColors = {
  GET: 'bg-blue-500/20 text-blue-400',
  POST: 'bg-green-500/20 text-green-400',
  PUT: 'bg-yellow-500/20 text-yellow-400',
  PATCH: 'bg-yellow-500/20 text-yellow-400',
  DELETE: 'bg-red-500/20 text-red-400',
};

export function ApiEndpoint({ method, path, description, children }: ApiEndpointProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <span className={`px-3 py-1 ${methodColors[method]} rounded-lg font-mono text-sm`}>
          {method}
        </span>
        <code className="text-purple-400 font-mono">{path}</code>
      </div>
      <p className="text-gray-300 mb-4">{description}</p>
      {children}
    </div>
  );
}