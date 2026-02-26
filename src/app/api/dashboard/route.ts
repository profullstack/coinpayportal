import { GET as getDashboardStats } from './stats/route';

/**
 * GET /api/dashboard
 * Backward-compatible alias for /api/dashboard/stats
 */
export const GET = getDashboardStats;
