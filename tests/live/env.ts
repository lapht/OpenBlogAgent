/** Reads a live-test variable; blank counts as unset. Only `OPENBLOG_LIVE_*` names are used, so a
 * developer's real `.env` or shell credentials are never picked up by accident. */
export function liveEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function liveEnvAll(...names: string[]): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = liveEnv(name);
    if (!value) return undefined;
    values[name] = value;
  }
  return values;
}

/** A slug no real post uses, so cleanup can only ever delete what the test created. */
export function liveSlug(): string {
  return `openblog-live-test-${Date.now().toString(36)}`;
}
