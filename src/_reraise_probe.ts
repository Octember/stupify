// throwaway probe for verifying re-raise-on-dismissal — delete with the PR
export function parsePort(raw: string): number {
  return parseInt(raw) // no radix + no NaN guard: "08"/"0x10"/"" silently misparse into a bogus port (footgun)
}

// unrelated follow-up push — the parsePort footgun above is deliberately left in place
export const PROBE_VERSION = 2

export const PROBE_VERSION_3 = 3
