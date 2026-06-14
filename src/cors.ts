/**
 * CORS (Cross-Origin Resource Sharing) Helper
 *
 * Provides permissive CORS headers to facilitate future web-based
 * debugging or browser-based access to the proxy.
 */

/**
 * Standard CORS headers applied to all responses.
 *
 * - Allow-Headers covers all headers that S3 clients may send.
 * - Expose-Headers ensures browsers can read key S3 response
 *   headers including Range-related ones for streaming / resumable downloads.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Authorization',
    'Content-Type',
    'Range',
    'x-amz-content-sha256',
    'x-amz-date',
    'x-amz-user-agent',
  ].join(', '),
  'Access-Control-Expose-Headers': [
    'Accept-Ranges',
    'Content-Length',
    'Content-Range',
    'Content-Type',
    'ETag',
    'Last-Modified',
    'x-amz-request-id',
    'x-amz-id-2',
  ].join(', '),
  'Access-Control-Max-Age': '86400', // 24 hours
};

/**
 * Handles an OPTIONS preflight request.
 *
 * @returns A 204 No Content response with CORS headers.
 */
export function handlePreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Appends CORS headers to an existing Response.
 *
 * Since `Response.headers` from `fetch()` may be immutable,
 * this creates a new Response wrapping the original body and headers.
 *
 * @param response - The upstream response to decorate.
 * @returns A new Response with CORS headers merged in.
 */
export function withCorsHeaders(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
