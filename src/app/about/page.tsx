export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold mb-8">About CoinPayPortal</h1>
      <div className="prose max-w-none">
        <p className="text-lg text-gray-600 mb-6">
          CoinPayPortal is a non-custodial cryptocurrency payment gateway that enables e-commerce merchants 
          to accept crypto payments with automatic fee handling and real-time transaction monitoring.
        </p>
        <p className="text-gray-600">
          Built by <a href="https://profullstack.com" className="text-purple-600 hover:text-purple-700">Profullstack, Inc.</a>
        </p>
      </div>
    </div>
  );
}