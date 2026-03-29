/**
 * Extract the market slug from a polymarket.com URL.
 * URL pattern: https://polymarket.com/event/{event-slug}/{market-slug}
 * Returns null if input is not a valid Polymarket URL.
 */
export function extractPolymarketSlug(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (!url.hostname.includes('polymarket.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    // pathname: /event/{event-slug}/{market-slug}
    return parts.length >= 3 ? parts[2] : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the input string looks like a polymarket.com market URL.
 */
export function isPolymarketUrl(input: string): boolean {
  return extractPolymarketSlug(input) !== null;
}
