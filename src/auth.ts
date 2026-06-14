/**
 * Authentication Module
 *
 * Validates that the incoming request carries a valid proxy access key
 * by extracting the Credential field from the AWS Signature V4
 * Authorization header OR from the query-string (Presigned URL).
 *
 * NOTE: We are NOT verifying the full AWS signature — that's intentional.
 * The client uses a fake Secret Key, so the signature itself is meaningless.
 * We only check the Access Key ID portion as a lightweight passphrase.
 */

/**
 * Extracts the Access Key ID from an incoming S3 request.
 *
 * Supports two authentication transport methods:
 *
 * 1. **Authorization Header** (standard):
 *    `AWS4-HMAC-SHA256 Credential=<AK>/<date>/<region>/s3/aws4_request, ...`
 *
 * 2. **Query String** (Presigned URL):
 *    `?X-Amz-Credential=<AK>/<date>/<region>/s3/aws4_request&...`
 *
 * The header method takes priority if both are present.
 *
 * @param request - The incoming HTTP request.
 * @returns The Access Key ID, or `null` if extraction fails.
 */
export function extractAccessKey(request: Request): string | null {
  // ── Method 1: Authorization Header ──────────────────────────
  const authHeader = request.headers.get('Authorization') ?? '';
  const headerMatch = authHeader.match(/Credential=([^/]+)/);
  if (headerMatch?.[1]) {
    return headerMatch[1];
  }

  // ── Method 2: Query String (Presigned URL) ──────────────────
  const url = new URL(request.url);
  const credential = url.searchParams.get('X-Amz-Credential');
  if (credential) {
    const ak = credential.split('/')[0];
    if (ak) return ak;
  }

  return null;
}

/**
 * Checks whether the request was authenticated via query string
 * (i.e. a Presigned URL) rather than the Authorization header.
 *
 * This is needed downstream so that the proxy knows to strip
 * `X-Amz-*` query parameters before re-signing.
 *
 * @param request - The incoming HTTP request.
 * @returns `true` if authentication was carried in the query string.
 */
export function isQueryStringAuth(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.has('X-Amz-Credential');
}

/**
 * Validates the client's access key against the configured proxy key.
 *
 * Uses a constant-time comparison to prevent timing attacks.
 * Critically, the comparison always runs for `max(len(a), len(b))`
 * iterations to avoid leaking the expected key's length.
 *
 * @param clientKey   - The key extracted from the client's request.
 * @param expectedKey - The configured `PROXY_ACCESS_KEY`.
 * @returns `true` if the keys match.
 */
export function validateAccessKey(clientKey: string, expectedKey: string): boolean {
  // XOR the lengths first — if they differ, this is already non-zero,
  // but we still run through the full loop to avoid leaking length info.
  let mismatch = clientKey.length ^ expectedKey.length;

  const len = Math.max(clientKey.length, expectedKey.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (clientKey.charCodeAt(i) || 0) ^ (expectedKey.charCodeAt(i) || 0);
  }

  return mismatch === 0;
}
