import QRCode from 'qrcode';

// In-memory cache for rendered QR data URLs
const qrMemoryCache = new Map<string, string>();
const pendingGenerations = new Map<string, Promise<string | null>>();

/**
 * Returns a cached QR Data URL if already pre-generated.
 */
export function getCachedQrUri(text: string): string | null {
  return qrMemoryCache.get(text) || null;
}

/**
 * Pre-generates and caches a QR Data URL in memory so it renders with 0ms delay.
 */
export async function pregenerateQrUri(
  text: string,
  options?: { dark?: string; light?: string; width?: number }
): Promise<string | null> {
  if (!text) return null;

  if (qrMemoryCache.has(text)) {
    return qrMemoryCache.get(text)!;
  }

  if (pendingGenerations.has(text)) {
    return pendingGenerations.get(text)!;
  }

  const promise = (async () => {
    try {
      const uri = await QRCode.toDataURL(text, {
        margin: 1,
        width: options?.width || 220,
        color: {
          dark: options?.dark || '#000000',
          light: options?.light || '#FFFFFF',
        },
      });
      qrMemoryCache.set(text, uri);
      return uri;
    } catch {
      return null;
    } finally {
      pendingGenerations.delete(text);
    }
  })();

  pendingGenerations.set(text, promise);
  return promise;
}
