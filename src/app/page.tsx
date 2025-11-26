export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold text-center mb-8">
          CoinPayPortal
        </h1>
        <p className="text-center text-lg mb-4">
          Non-Custodial Cryptocurrency Payment Gateway
        </p>
        <p className="text-center text-gray-600">
          Accept crypto payments with automatic fee handling and real-time processing
        </p>
      </div>
    </main>
  );
}