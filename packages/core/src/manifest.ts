/**
 * Generate a unique package ID with the relay prefix format.
 */
export function generatePackageId(): string {
  return `pkg_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Generate a unique session ID with the relay prefix format.
 */
export function generateSessionId(): string {
  return `sess_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Generate a unique diff ID with the relay prefix format.
 */
export function generateDiffId(): string {
  return `cdiff_${crypto.randomUUID().replace(/-/g, '')}`;
}
