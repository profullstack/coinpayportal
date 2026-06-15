'use client';

import { TeamManager } from '@/components/team/TeamManager';

/**
 * Per-business team management. Business members get their role on this business only.
 */
export function MembersTab({ businessId }: { businessId: string }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Members</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          People here have access to this business only. To grant access across every business, use
          the organization team in account settings.
        </p>
      </div>
      <TeamManager scope="business" scopeId={businessId} />
    </div>
  );
}
