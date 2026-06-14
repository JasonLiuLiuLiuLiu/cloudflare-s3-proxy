import { describe, it, expect } from 'vitest';
import { handlePreflight, withCorsHeaders } from '../src/cors';

describe('handlePreflight', () => {
  it('should return 204 No Content', () => {
    const response = handlePreflight();
    expect(response.status).toBe(204);
  });

  it('should have a null body', async () => {
    const response = handlePreflight();
    expect(response.body).toBeNull();
  });

  it('should include Access-Control-Allow-Origin: *', () => {
    const response = handlePreflight();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should only allow GET, HEAD, OPTIONS methods', () => {
    const response = handlePreflight();
    const methods = response.headers.get('Access-Control-Allow-Methods');
    expect(methods).toContain('GET');
    expect(methods).toContain('HEAD');
    expect(methods).toContain('OPTIONS');
    // Must NOT contain write methods
    expect(methods).not.toContain('PUT');
    expect(methods).not.toContain('POST');
    expect(methods).not.toContain('DELETE');
  });

  it('should allow Authorization header in preflight', () => {
    const response = handlePreflight();
    const allowed = response.headers.get('Access-Control-Allow-Headers');
    expect(allowed).toContain('Authorization');
  });

  it('should allow Range header for partial downloads', () => {
    const response = handlePreflight();
    const allowed = response.headers.get('Access-Control-Allow-Headers');
    expect(allowed).toContain('Range');
  });

  it('should set a long max-age for preflight caching', () => {
    const response = handlePreflight();
    const maxAge = response.headers.get('Access-Control-Max-Age');
    expect(Number(maxAge)).toBeGreaterThanOrEqual(3600); // at least 1 hour
  });
});

describe('withCorsHeaders', () => {
  it('should preserve the original response status', () => {
    const original = new Response('test', { status: 206 });
    const decorated = withCorsHeaders(original);
    expect(decorated.status).toBe(206);
  });

  it('should preserve the original response body', async () => {
    const original = new Response('hello world', { status: 200 });
    const decorated = withCorsHeaders(original);
    expect(await decorated.text()).toBe('hello world');
  });

  it('should preserve original headers while adding CORS headers', () => {
    const original = new Response('test', {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'ETag': '"abc123"',
      },
    });
    const decorated = withCorsHeaders(original);

    // Original headers preserved
    expect(decorated.headers.get('ETag')).toBe('"abc123"');
    // CORS headers added
    expect(decorated.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should expose Accept-Ranges for Range request support', () => {
    const original = new Response('test', { status: 200 });
    const decorated = withCorsHeaders(original);
    const exposed = decorated.headers.get('Access-Control-Expose-Headers');
    expect(exposed).toContain('Accept-Ranges');
  });

  it('should expose Content-Range for partial content responses', () => {
    const original = new Response('test', { status: 200 });
    const decorated = withCorsHeaders(original);
    const exposed = decorated.headers.get('Access-Control-Expose-Headers');
    expect(exposed).toContain('Content-Range');
  });

  it('should expose Last-Modified header', () => {
    const original = new Response('test', { status: 200 });
    const decorated = withCorsHeaders(original);
    const exposed = decorated.headers.get('Access-Control-Expose-Headers');
    expect(exposed).toContain('Last-Modified');
  });

  it('should expose x-amz-request-id and x-amz-id-2', () => {
    const original = new Response('test', { status: 200 });
    const decorated = withCorsHeaders(original);
    const exposed = decorated.headers.get('Access-Control-Expose-Headers');
    expect(exposed).toContain('x-amz-request-id');
    expect(exposed).toContain('x-amz-id-2');
  });
});
