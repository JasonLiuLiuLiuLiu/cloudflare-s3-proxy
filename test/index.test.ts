/**
 * Integration tests for the Worker's main fetch handler.
 *
 * These tests exercise the full request pipeline end-to-end
 * within the Workers runtime, using the `cloudflare:test` helpers
 * provided by @cloudflare/vitest-pool-workers.
 *
 * Note: We do NOT test the actual forwarding to B2 here (that would
 * require network access). We test everything up to and including
 * the decision to forward, plus error paths.
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// ─── Test Helpers ────────────────────────────────────────────

const PROXY_KEY = 'test-proxy-key';

const TEST_ENV = {
  PROXY_ACCESS_KEY: PROXY_KEY,
  BUCKET_CONFIG_JSON: JSON.stringify({
    'my-bucket': {
      ak: 'fake-b2-key-id',
      sk: 'fake-b2-app-key',
      region: 'us-west-004',
    },
    'custom-endpoint-bucket': {
      ak: 'key-id',
      sk: 'app-key',
      region: 'us-east-1',
      endpoint: 'https://minio.internal:9000',
    },
  }),
};

/**
 * Creates a request with a valid Authorization header.
 */
function authedRequest(
  path: string,
  method: string = 'GET',
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(`https://proxy.test${path}`, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${PROXY_KEY}/20250614/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fakesig`,
      ...extraHeaders,
    },
  });
}

/**
 * Creates an unauthenticated request.
 */
function unauthRequest(path: string, method: string = 'GET'): Request {
  return new Request(`https://proxy.test${path}`, { method });
}

// ─── Method Gating ───────────────────────────────────────────

describe('Method Gating', () => {
  it('should reject PUT requests with 405', async () => {
    const request = authedRequest('/my-bucket/key', 'PUT');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.status).toBe(405);
    const body = await response.text();
    expect(body).toContain('<Code>MethodNotAllowed</Code>');
    expect(body).toContain('PUT');
  });

  it('should reject POST requests with 405', async () => {
    const request = authedRequest('/my-bucket/key', 'POST');
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(405);
  });

  it('should reject DELETE requests with 405', async () => {
    const request = authedRequest('/my-bucket/key', 'DELETE');
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(405);
  });

  it('should reject PATCH requests with 405', async () => {
    const request = authedRequest('/my-bucket/key', 'PATCH');
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(405);
  });

  it('should include CORS headers on 405 responses', async () => {
    const request = authedRequest('/my-bucket/key', 'PUT');
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ─── CORS Preflight ──────────────────────────────────────────

describe('CORS Preflight', () => {
  it('should handle OPTIONS with 204', async () => {
    const request = new Request('https://proxy.test/my-bucket/key', {
      method: 'OPTIONS',
    });
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

// ─── Authentication ──────────────────────────────────────────

describe('Authentication', () => {
  it('should reject requests without Authorization', async () => {
    const request = unauthRequest('/my-bucket/key');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('<Code>AccessDenied</Code>');
  });

  it('should reject requests with wrong access key', async () => {
    const request = new Request('https://proxy.test/my-bucket/key', {
      headers: {
        Authorization:
          'AWS4-HMAC-SHA256 Credential=wrong-key/20250614/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fakesig',
      },
    });
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(403);
  });

  it('should accept requests with correct access key via header', async () => {
    // This will try to forward to B2 (which will fail in tests), but
    // the important thing is that we pass the auth gate.
    // For a root request, we get an immediate 200 without forwarding.
    const request = authedRequest('/');
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(200);
  });

  it('should accept Presigned URL auth via query string', async () => {
    const request = new Request(
      `https://proxy.test/?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${PROXY_KEY}%2F20250614%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=fakesig`,
    );
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(200); // root request → ListBuckets
  });

  it('should reject Presigned URL with wrong key', async () => {
    const request = new Request(
      'https://proxy.test/my-bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=bad-key%2F20250614%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=fakesig',
    );
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.status).toBe(403);
  });
});

// ─── Root Path (ListBuckets) ─────────────────────────────────

describe('Root Path', () => {
  it('should return ListAllMyBucketsResult XML for root path', async () => {
    const request = authedRequest('/');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/xml');

    const body = await response.text();
    expect(body).toContain('<ListAllMyBucketsResult');
    expect(body).toContain('<Buckets/>');
  });
});

// ─── Bucket Config ───────────────────────────────────────────

describe('Bucket Config', () => {
  it('should return 404 NoSuchBucket for unconfigured bucket', async () => {
    const request = authedRequest('/nonexistent-bucket/key');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('<Code>NoSuchBucket</Code>');
  });

  it('should return 500 InternalError if BUCKET_CONFIG_JSON is malformed', async () => {
    const badEnv = { ...TEST_ENV, BUCKET_CONFIG_JSON: 'not-valid-json' };
    const request = authedRequest('/my-bucket/key');
    const response = await worker.fetch(request, badEnv);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('<Code>InternalError</Code>');
  });
});

// ─── HEAD /bucket Shortcut ───────────────────────────────────

describe('HEAD /bucket shortcut', () => {
  it('should return 200 for HEAD on a configured bucket (no key)', async () => {
    const request = authedRequest('/my-bucket', 'HEAD');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-amz-bucket-region')).toBe('us-west-004');
  });

  it('should return 200 for HEAD /bucket/ (trailing slash)', async () => {
    const request = authedRequest('/my-bucket/', 'HEAD');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.status).toBe(200);
  });

  it('should include CORS headers on HEAD /bucket response', async () => {
    const request = authedRequest('/my-bucket', 'HEAD');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ─── Response Headers ────────────────────────────────────────

describe('Response Headers', () => {
  it('should always include CORS headers on error responses', async () => {
    const request = unauthRequest('/my-bucket/key');
    const response = await worker.fetch(request, TEST_ENV);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('should include XML content-type on error responses', async () => {
    const request = unauthRequest('/my-bucket/key');
    const response = await worker.fetch(request, TEST_ENV);
    expect(response.headers.get('Content-Type')).toContain('application/xml');
  });
});
