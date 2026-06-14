import { describe, it, expect } from 'vitest';
import { extractAccessKey, isQueryStringAuth, validateAccessKey } from '../src/auth';

// ─── extractAccessKey ────────────────────────────────────────

describe('extractAccessKey', () => {
  it('should extract AK from a standard AWS SigV4 Authorization header', () => {
    const request = new Request('https://proxy.example.com/bucket/key', {
      headers: {
        Authorization:
          'AWS4-HMAC-SHA256 Credential=my-proxy-key/20250614/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=abcdef1234567890',
      },
    });
    expect(extractAccessKey(request)).toBe('my-proxy-key');
  });

  it('should extract AK from X-Amz-Credential query parameter (Presigned URL)', () => {
    const request = new Request(
      'https://proxy.example.com/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=my-proxy-key%2F20250614%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=abc123',
    );
    expect(extractAccessKey(request)).toBe('my-proxy-key');
  });

  it('should prefer Authorization header over query string when both present', () => {
    const request = new Request(
      'https://proxy.example.com/bucket/key?X-Amz-Credential=query-key%2F20250614%2Fus-east-1%2Fs3%2Faws4_request',
      {
        headers: {
          Authorization:
            'AWS4-HMAC-SHA256 Credential=header-key/20250614/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=abc',
        },
      },
    );
    expect(extractAccessKey(request)).toBe('header-key');
  });

  it('should return null when no authentication is present', () => {
    const request = new Request('https://proxy.example.com/bucket/key');
    expect(extractAccessKey(request)).toBeNull();
  });

  it('should return null for an empty Authorization header', () => {
    const request = new Request('https://proxy.example.com/bucket/key', {
      headers: { Authorization: '' },
    });
    expect(extractAccessKey(request)).toBeNull();
  });

  it('should return null for a malformed Authorization header (no Credential=)', () => {
    const request = new Request('https://proxy.example.com/bucket/key', {
      headers: { Authorization: 'Bearer some-token' },
    });
    expect(extractAccessKey(request)).toBeNull();
  });
});

// ─── isQueryStringAuth ───────────────────────────────────────

describe('isQueryStringAuth', () => {
  it('should return true when X-Amz-Credential is in query string', () => {
    const request = new Request(
      'https://proxy.example.com/bucket/key?X-Amz-Credential=key%2F20250614%2Fus-east-1%2Fs3%2Faws4_request',
    );
    expect(isQueryStringAuth(request)).toBe(true);
  });

  it('should return false when there is no query string auth', () => {
    const request = new Request('https://proxy.example.com/bucket/key', {
      headers: {
        Authorization:
          'AWS4-HMAC-SHA256 Credential=key/20250614/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=abc',
      },
    });
    expect(isQueryStringAuth(request)).toBe(false);
  });

  it('should return false when query string is empty', () => {
    const request = new Request('https://proxy.example.com/bucket/key');
    expect(isQueryStringAuth(request)).toBe(false);
  });
});

// ─── validateAccessKey ───────────────────────────────────────

describe('validateAccessKey', () => {
  it('should return true for matching keys', () => {
    expect(validateAccessKey('my-secret-key', 'my-secret-key')).toBe(true);
  });

  it('should return false for non-matching keys of the same length', () => {
    expect(validateAccessKey('my-secret-key', 'my-secret-kex')).toBe(false);
  });

  it('should return false for keys of different lengths', () => {
    expect(validateAccessKey('short', 'much-longer-key')).toBe(false);
  });

  it('should return false when client key is longer than expected', () => {
    expect(validateAccessKey('much-longer-key', 'short')).toBe(false);
  });

  it('should return true for empty strings (edge case)', () => {
    expect(validateAccessKey('', '')).toBe(true);
  });

  it('should return false for empty vs non-empty', () => {
    expect(validateAccessKey('', 'non-empty')).toBe(false);
    expect(validateAccessKey('non-empty', '')).toBe(false);
  });

  it('should handle keys with special characters', () => {
    const key = 'ak+/=special!@#$%';
    expect(validateAccessKey(key, key)).toBe(true);
    expect(validateAccessKey(key, key + 'x')).toBe(false);
  });

  it('should handle unicode keys', () => {
    const key = '密钥-テスト-키';
    expect(validateAccessKey(key, key)).toBe(true);
  });
});
