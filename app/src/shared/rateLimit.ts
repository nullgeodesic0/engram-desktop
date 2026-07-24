/**
 * `rate_limit_event.status` has at least two distinct severities observed live
 * (spike/FINDINGS.md Finding 5.4): "allowed_warning" (session kept running fine
 * underneath it — informational only) and "rejected" (new session start genuinely
 * failed). Anything prefixed "allowed" is not a real block; everything else is,
 * until proven otherwise by a status we haven't seen yet.
 */
export function isBlockingRateLimitStatus(status: string): boolean {
  return status !== 'allowed' && !status.startsWith('allowed')
}
