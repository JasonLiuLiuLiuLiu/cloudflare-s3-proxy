/**
 * Cloudflare Worker S3 Proxy — Entry Point
 *
 * A lightweight, read-only S3 gateway that leverages the Cloudflare ×
 * Backblaze B2 Bandwidth Alliance for egress-free downloads.
 *
 * ┌──────────┐   fake AK   ┌────────────────┐  real sig   ┌──────────┐
 * │  Client  │ ──────────► │  CF Worker     │ ──────────► │   B2 S3  │
 * │ (rclone) │ ◄────────── │  (this proxy)  │ ◄────────── │ endpoint │
 * └──────────┘   stream    └────────────────┘   stream    └──────────┘
 *
 * @module
 */

import type { Env, BucketConfigMap } from './types';
import { extractAccessKey, isQueryStringAuth, validateAccessKey } from './auth';
import { parseS3Path } from './parser';
import { buildS3ErrorResponse } from './errors';
import { handlePreflight, withCorsHeaders } from './cors';
import { forwardToBackend } from './proxy';

// ─── Allowed HTTP Methods ────────────────────────────────────

/** Only read operations are permitted through the proxy. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ─── Bucket Config Cache ─────────────────────────────────────

/**
 * Module-level cache for parsed BUCKET_CONFIG_JSON.
 *
 * Avoids re-parsing the JSON string on every request within the
 * same Worker isolate. The cache is invalidated automatically if
 * the raw JSON string changes (e.g. after a secret rotation + redeploy).
 */
let cachedBucketConfigs: BucketConfigMap | null = null;
let cachedBucketConfigJson = '';

/**
 * Returns the parsed bucket configuration map, using a cache to
 * avoid repeated JSON.parse calls.
 *
 * @throws {SyntaxError} if the JSON is malformed.
 */
function getBucketConfigs(rawJson: string): BucketConfigMap {
  if (rawJson !== cachedBucketConfigJson) {
    cachedBucketConfigs = JSON.parse(rawJson) as BucketConfigMap;
    cachedBucketConfigJson = rawJson;
  }
  return cachedBucketConfigs!;
}

// ─── Worker Entry Point ──────────────────────────────────────

export default {
  /**
   * Main request handler for the Cloudflare Worker.
   *
   * Processing pipeline:
   *   1. Method gating (reject writes)
   *   2. CORS preflight handling
   *   3. Client authentication (AK passphrase check — header or query string)
   *   4. S3 path parsing (with URI decoding)
   *   5. Bucket config lookup (cached)
   *   6. HEAD /bucket shortcut
   *   7. Re-sign & forward to backend
   *   8. Structured request logging
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now();
    const { method } = request;
    const url = new URL(request.url);

    // ── Step 1: Method gating ───────────────────────────────
    // Strictly reject any write operations. This proxy is read-only
    // by design (CF Workers have payload size limits anyway).
    if (!ALLOWED_METHODS.has(method)) {
      return withCorsHeaders(
        buildS3ErrorResponse(
          'MethodNotAllowed',
          url.pathname,
          undefined,
          `The ${method} method is not allowed. This proxy only supports GET and HEAD.`,
        ),
      );
    }

    // ── Step 2: CORS preflight ──────────────────────────────
    if (method === 'OPTIONS') {
      return handlePreflight();
    }

    // ── Step 3: Client authentication ───────────────────────
    // Supports both Authorization header and Presigned URL query string.
    const clientAk = extractAccessKey(request);

    if (!clientAk || !validateAccessKey(clientAk, env.PROXY_ACCESS_KEY)) {
      return withCorsHeaders(
        buildS3ErrorResponse('AccessDenied', url.pathname),
      );
    }

    // ── Step 4: Parse the S3 path ───────────────────────────
    const parsed = parseS3Path(url.pathname);

    if (!parsed) {
      // Root-level request (no bucket specified).
      // Return a simple health-check style response.
      // This mimics S3's ListBuckets, but we don't actually list anything.
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
        '  <Owner>',
        '    <ID>s3-proxy</ID>',
        '    <DisplayName>Cloudflare S3 Proxy</DisplayName>',
        '  </Owner>',
        '  <Buckets/>',
        '</ListAllMyBucketsResult>',
      ].join('\n');

      return withCorsHeaders(
        new Response(xml, {
          status: 200,
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        }),
      );
    }

    const { bucketName, objectKey } = parsed;

    // ── Step 5: Load & validate bucket config ───────────────
    let bucketConfigs: BucketConfigMap;
    try {
      bucketConfigs = getBucketConfigs(env.BUCKET_CONFIG_JSON);
    } catch {
      console.error('[s3-proxy] Failed to parse BUCKET_CONFIG_JSON');
      return withCorsHeaders(
        buildS3ErrorResponse(
          'InternalError',
          url.pathname,
          undefined,
          'Server configuration error. BUCKET_CONFIG_JSON is malformed.',
        ),
      );
    }

    const targetConfig = bucketConfigs[bucketName];
    if (!targetConfig) {
      return withCorsHeaders(
        buildS3ErrorResponse('NoSuchBucket', `/${bucketName}`),
      );
    }

    // ── Step 6: HEAD /bucket shortcut ───────────────────────
    // Some S3 clients (e.g. aws-cli, boto3) issue `HEAD /{bucket}`
    // to verify bucket existence before proceeding. B2 may return
    // a non-standard response for this. Since we've already confirmed
    // the bucket exists in our whitelist, return 200 directly.
    if (method === 'HEAD' && !objectKey) {
      return withCorsHeaders(
        new Response(null, {
          status: 200,
          headers: {
            'x-amz-bucket-region': targetConfig.region,
          },
        }),
      );
    }

    // ── Step 7: Forward to storage backend ──────────────────
    const presigned = isQueryStringAuth(request);

    try {
      const backendResponse = await forwardToBackend(
        request,
        bucketName,
        objectKey,
        url.search,
        targetConfig,
        presigned,
      );

      // ── Step 8: Structured request log ────────────────────
      const durationMs = Date.now() - startTime;
      console.log(
        JSON.stringify({
          level: 'info',
          method,
          bucket: bucketName,
          key: objectKey || '(none)',
          status: backendResponse.status,
          durationMs,
          presigned,
        }),
      );

      return withCorsHeaders(backendResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;
      console.error(
        JSON.stringify({
          level: 'error',
          method,
          bucket: bucketName,
          key: objectKey || '(none)',
          error: message,
          durationMs,
          presigned,
        }),
      );
      return withCorsHeaders(
        buildS3ErrorResponse(
          'InternalError',
          url.pathname,
          undefined,
          'An error occurred while forwarding the request to the storage backend.',
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
