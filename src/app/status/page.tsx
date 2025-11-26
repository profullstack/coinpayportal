export default function StatusPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-white">System Status</h1>
      
      <div className="space-y-6">
        <div className="bg-green-900/30 border border-green-500/50 rounded-lg p-6">
          <div className="flex items-center space-x-3">
            <div className="h-3 w-3 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-semibold text-green-400">All Systems Operational</h2>
          </div>
          <p className="text-green-300 mt-2">
            All services are running normally.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6">
          <div className="border border-gray-700 rounded-lg p-6 bg-gray-800/50">
            <h3 className="font-semibold mb-2 text-white">API</h3>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Operational</span>
            </div>
          </div>
          
          <div className="border border-gray-700 rounded-lg p-6 bg-gray-800/50">
            <h3 className="font-semibold mb-2 text-white">Payment Processing</h3>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Operational</span>
            </div>
          </div>
          
          <div className="border border-gray-700 rounded-lg p-6 bg-gray-800/50">
            <h3 className="font-semibold mb-2 text-white">Blockchain Monitoring</h3>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Operational</span>
            </div>
          </div>
          
          <div className="border border-gray-700 rounded-lg p-6 bg-gray-800/50">
            <h3 className="font-semibold mb-2 text-white">Webhooks</h3>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-300">Operational</span>
            </div>
          </div>
        </div>
        
        <p className="text-sm text-gray-400">
          Last updated: {new Date().toLocaleString()}
        </p>
      </div>
    </div>
  );
}