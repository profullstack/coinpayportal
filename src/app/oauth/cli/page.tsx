// Out-of-band callback for the `coinpay` CLI. The OAuth authorize flow redirects
// here with ?code=...; we display it for the user to paste back into the CLI,
// which then exchanges it with its PKCE verifier. No loopback server required —
// works over SSH / remote shells.

export const dynamic = "force-dynamic";

export default async function CliCallback({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string; error_description?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? sp.error_description || sp.error : null;
  const code = sp.code || null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0a0b0d",
        color: "#e8e3d6",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
        <h1 style={{ color: "#9ef01a", fontSize: 22, margin: "0 0 8px" }}>CoinPay CLI login</h1>
        {error ? (
          <p style={{ color: "#ff5c5c" }}>Login failed: {error}</p>
        ) : code ? (
          <>
            <p style={{ color: "#8b938a", margin: "0 0 18px", lineHeight: 1.5 }}>
              Copy this code and paste it back into your terminal:
            </p>
            <code
              style={{
                display: "block",
                background: "#101317",
                border: "1px solid #1b2026",
                borderRadius: 8,
                padding: "16px 18px",
                fontSize: 14,
                wordBreak: "break-all",
                color: "#9ef01a",
                userSelect: "all",
              }}
            >
              {code}
            </code>
            <p style={{ color: "#566150", fontSize: 12, marginTop: 16 }}>
              You can close this tab once the CLI says you&apos;re logged in.
            </p>
          </>
        ) : (
          <p style={{ color: "#8b938a" }}>No authorization code present.</p>
        )}
      </div>
    </main>
  );
}
