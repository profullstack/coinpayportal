import { NextRequest, NextResponse } from "next/server";
import { createCode, validateCode, applyReferral } from "@profullstack/referrals";
import { referralStore } from "@/lib/referrals";
import { verifyToken } from "@/lib/auth/jwt";
import { getJwtSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

function getUserId(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const secret = getJwtSecret();
    if (!secret) return null;
    const decoded = verifyToken(auth.slice(7), secret) as any;
    return decoded?.userId ?? decoded?.sub ?? null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");
  if (action === "validate") {
    const code = searchParams.get("ref");
    if (!code) return NextResponse.json({ error: "Missing ref" }, { status: 400 });
    const record = await validateCode(code, referralStore);
    return NextResponse.json({ valid: !!record, code: record ?? null });
  }
  if (action === "myusages") {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const usages = await referralStore.getUsagesByAffiliate(userId);
    return NextResponse.json({ usages });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const action = body["action"];
  if (action === "create") {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const code = await createCode(userId, referralStore);
    return NextResponse.json({ code });
  }
  if (action === "apply") {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const code = typeof body["code"] === "string" ? body["code"] : null;
    const amount = typeof body["amount"] === "number" ? body["amount"] : null;
    if (!code || !amount) return NextResponse.json({ error: "Missing code or amount" }, { status: 400 });
    const usage = await applyReferral({ code, newUserId: userId, amountCents: amount, store: referralStore });
    return NextResponse.json({ usage });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
