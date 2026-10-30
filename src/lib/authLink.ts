/** Parsed auth payload from a Supabase recovery deep link. */
export type RecoveryLink =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

/**
 * Reads the tokens Supabase appends to a recovery redirect. Implicit links put
 * them in the fragment (`#access_token=...`); PKCE links use `?code=...`.
 */
export function parseRecoveryUrl(url: string | null | undefined): RecoveryLink {
  if (!url) return { kind: 'none' };

  const hashIndex = url.indexOf('#');
  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';

  const hashParams = new URLSearchParams(fragment);
  const queryParams = new URLSearchParams(query);

  const error =
    hashParams.get('error_description') ??
    queryParams.get('error_description') ??
    hashParams.get('error') ??
    queryParams.get('error');
  if (error) return { kind: 'error', message: error };

  const accessToken = hashParams.get('access_token') ?? queryParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') ?? queryParams.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken };
  }

  const code = queryParams.get('code') ?? hashParams.get('code');
  if (code) return { kind: 'code', code };

  return { kind: 'none' };
}
