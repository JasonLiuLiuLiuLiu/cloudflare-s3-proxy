/**
 * Proxy Module — the core forwarding engine.
 *
 * Responsibilities:
 * 1. Strip ALL client authentication headers (including all x-amz-* headers).
 * 2. Construct the real backend target URL (B2 or custom endpoint).
 * 3. Re-sign the request using `aws4fetch` with real credentials.
 * 4. Forward the signed request and stream the response back.
 */

import { AwsClient } from 'aws4fetch';
import type { BucketCredentials } from './types';

// ─── AwsClient Instance Cache ────────────────────────────────

/**
 * Cache of AwsClient instances keyed by bucket name.
 *
 * Avoids re-creating the client on every request. The client is
 * stateless (it only holds the credentials), so sharing across
 * requests within the same isolate is safe.
 */
const clientCache = new Map<string, AwsClient>();

/**
 * Returns an AwsClient for the given bucket, creating one if needed.
 */
function getAwsClient(bucketName: string, credentials: BucketCredentials): AwsClient {
  let client = clientCache.get(bucketName);
  if (!client) {
    client = new AwsClient({
      accessKeyId: credentials.ak,
      secretAccessKey: credentials.sk,
      service: 's3',
      region: credentials.region,
    });
    clientCache.set(bucketName, client);
  }
  return client;
}

// ─── Query String Parameters to Strip ────────────────────────

/**
 * When a Presigned URL is used, the query string carries the client's
 * fake signature parameters. These MUST be stripped before we re-sign
 * the request with real credentials, otherwise B2 will detect a conflict.
 */
const AMZ_QUERY_PARAMS_TO_STRIP = [
  'X-Amz-Algorithm',
  'X-Amz-Credential',
  'X-Amz-Date',
  'X-Amz-Expires',
  'X-Amz-Security-Token',
  'X-Amz-Signature',
  'X-Amz-SignedHeaders',
] as const;

// ─── Core Forwarding Logic ───────────────────────────────────

/**
 * Forwards a request to the storage backend with a real AWS Signature V4.
 *
 * @param request           - The original incoming request.
 * @param bucketName        - The target bucket name.
 * @param objectKey         - The object key within the bucket.
 * @param queryString       - The raw query string from the original URL.
 * @param credentials       - The real credentials for this bucket.
 * @param isPresignedUrl    - Whether the original request used query-string auth.
 * @returns The upstream response, streamed transparently.
 */
export async function forwardToBackend(
  request: Request,
  bucketName: string,
  objectKey: string,
  queryString: string,
  credentials: BucketCredentials,
  isPresignedUrl: boolean,
): Promise<Response> {
  // ── Build the target URL ────────────────────────────────────
  const endpoint = credentials.endpoint
    ?? `https://s3.${credentials.region}.backblazeb2.com`;
  const targetPath = objectKey
    ? `/${bucketName}/${objectKey}`
    : `/${bucketName}`;

  // If the original request was a Presigned URL, strip all X-Amz-*
  // query parameters before constructing the target URL.
  const cleanQuery = isPresignedUrl
    ? stripAmzQueryParams(queryString)
    : queryString;

  const targetUrl = `${endpoint}${targetPath}${cleanQuery}`;

  // ── Prepare a clean set of headers ──────────────────────────
  // Copy everything EXCEPT host, authorization, x-amz-*, cf-*, x-real-ip,
  // and x-forwarded-* headers. Cloudflare-specific headers are stripped 
  // by Cloudflare's outbound fetch, which would cause signature mismatches
  // on the backend if they were signed.
  const cleanHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'authorization' ||
      lower.startsWith('x-amz-') ||
      lower.startsWith('cf-') ||
      lower === 'x-real-ip' ||
      lower.startsWith('x-forwarded-')
    ) {
      continue;
    }
    cleanHeaders.set(key, value);
  }

  // ── Sign and forward ────────────────────────────────────────
  const awsClient = getAwsClient(bucketName, credentials);

  const signedRequest = await awsClient.sign(targetUrl, {
    method: request.method,
    headers: cleanHeaders,
  });

  return fetch(signedRequest);
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Strips all `X-Amz-*` query parameters from a query string.
 *
 * @param queryString - The raw query string (including leading `?`).
 * @returns The cleaned query string, or empty string if nothing remains.
 */
function stripAmzQueryParams(queryString: string): string {
  if (!queryString) return '';

  const params = new URLSearchParams(queryString.replace(/^\?/, ''));
  for (const paramName of AMZ_QUERY_PARAMS_TO_STRIP) {
    params.delete(paramName);
  }

  const remaining = params.toString();
  return remaining ? `?${remaining}` : '';
}
