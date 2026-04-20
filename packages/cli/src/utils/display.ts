/**
 * Format a package status for terminal display.
 */
export function formatStatus(status: string): string {
  const statusColors: Record<string, string> = {
    draft: '\x1b[90m',          // gray
    in_progress: '\x1b[33m',    // yellow
    pending_review: '\x1b[35m', // magenta
    approved: '\x1b[32m',       // green
    rejected: '\x1b[31m',       // red
    complete: '\x1b[32m',       // green
    blocked: '\x1b[31m',        // red
  };
  const reset = '\x1b[0m';
  const color = statusColors[status] || '';
  return `${color}${status}${reset}`;
}

/**
 * Format a timestamp for display.
 */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
