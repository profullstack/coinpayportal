/**
 * The single cutoff switch for legacy user-secret migration paths.
 *
 * Unlock-on-use (2026-10-28): user secrets that a server-held key (or nothing)
 * protects are migrated once, per row, to a form no server key can open. While
 * LEGACY_KEY_MIGRATION is anything but `off`, those one-shot paths run. Setting
 * it to `off` is the dated cutoff Anthony decides: after that the legacy paths
 * refuse and the legacy master key is never used for user secrets again.
 */
export function legacyKeyMigrationEnabled(): boolean {
  return (process.env.LEGACY_KEY_MIGRATION ?? '').trim().toLowerCase() !== 'off';
}
