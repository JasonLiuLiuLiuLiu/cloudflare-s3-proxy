/**
 * Type definitions for the Cloudflare Worker S3 Proxy.
 *
 * These types model the environment bindings and the bucket
 * routing configuration that drives the proxy's behavior.
 */

// ─── Environment Bindings ────────────────────────────────────

/**
 * Cloudflare Worker environment bindings.
 *
 * These values are injected at runtime from wrangler.toml / secrets.
 */
export interface Env {
  /**
   * The global passphrase that clients must present as their
   * S3 Access Key ID in order to pass authentication.
   */
  PROXY_ACCESS_KEY: string;

  /**
   * A JSON-encoded string containing the bucket routing table.
   * Parsed at request time into a `BucketConfigMap`.
   *
   * @example
   * '{"my-bucket":{"ak":"keyId","sk":"appKey","region":"us-west-004"}}'
   */
  BUCKET_CONFIG_JSON: string;
}

// ─── Bucket Configuration ────────────────────────────────────

/**
 * Credentials and region for a single Backblaze B2 bucket.
 */
export interface BucketCredentials {
  /** Backblaze B2 Application Key ID */
  ak: string;
  /** Backblaze B2 Application Key (secret) */
  sk: string;
  /** B2 S3-compatible region, e.g. "us-west-004" */
  region: string;
  /**
   * Optional custom S3-compatible endpoint URL.
   * If omitted, defaults to Backblaze B2: `https://s3.{region}.backblazeb2.com`
   *
   * Use this to proxy to other S3-compatible backends (MinIO, R2, Wasabi, etc.)
   *
   * @example "https://s3.us-east-005.backblazeb2.com"
   * @example "https://minio.internal:9000"
   */
  endpoint?: string;
}

/**
 * A map of bucket names to their real B2 credentials.
 * This is the parsed shape of `BUCKET_CONFIG_JSON`.
 */
export type BucketConfigMap = Record<string, BucketCredentials>;

// ─── Parsed Request ──────────────────────────────────────────

/**
 * The result of parsing an incoming S3 Path-Style request URL.
 */
export interface ParsedS3Path {
  /** The bucket name extracted from the first path segment */
  bucketName: string;
  /** The object key (everything after the bucket name), may be empty */
  objectKey: string;
}

// ─── S3 Error Codes ──────────────────────────────────────────

/**
 * Well-known S3 error codes used by the proxy for XML error responses.
 */
export type S3ErrorCode =
  | 'AccessDenied'
  | 'InvalidAccessKeyId'
  | 'MethodNotAllowed'
  | 'NoSuchBucket'
  | 'NoSuchKey'
  | 'InternalError'
  | 'InvalidRequest';
