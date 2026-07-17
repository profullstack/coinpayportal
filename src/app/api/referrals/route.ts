import { type NextRequest } from "next/server";
import {
  createReferralsRouteHandler,
  type ReferralsRouteRequest,
} from "@profullstack/stack/referrals";
import { referralStore } from "@/lib/referrals";
import { verifyToken } from "@/lib/auth/jwt";
import { getJwtSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

function getUserId(req: ReferralsRouteRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const secret = getJwtSecret();
    if (!secret) return null;
    const decoded = verifyToken(auth.slice(7), secret) as any;
    return decoded?.userId ?? decoded?.sub ?? null;
  } catch { return null; }
}

const handlers = createReferralsRouteHandler({
  store: referralStore,
  getUserId,
});

// Next 16's generated route-type check requires the exported handlers to be
// typed against NextRequest; the factory's structural request type accepts it
// at runtime, so these wrappers are type-only.
export function GET(req: NextRequest) {
  return handlers.GET(req);
}

export function POST(req: NextRequest) {
  return handlers.POST(req);
}
