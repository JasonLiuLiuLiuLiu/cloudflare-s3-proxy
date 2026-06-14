import { describe, it, expect } from 'vitest';
import { buildS3ErrorResponse } from '../src/errors';

describe('buildS3ErrorResponse', () => {
  // ─── XML Structure ─────────────────────────────────────────

  it('should return a well-formed XML error response', async () => {
    const response = buildS3ErrorResponse('AccessDenied', '/bucket/key', 'req-123');
    const body = await response.text();

    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<Error>');
    expect(body).toContain('<Code>AccessDenied</Code>');
    expect(body).toContain('<Message>Access Denied</Message>');
    expect(body).toContain('<Resource>/bucket/key</Resource>');
    expect(body).toContain('<RequestId>req-123</RequestId>');
    expect(body).toContain('</Error>');
  });

  // ─── HTTP Status Codes ─────────────────────────────────────

  it('should return 403 for AccessDenied', () => {
    const response = buildS3ErrorResponse('AccessDenied');
    expect(response.status).toBe(403);
  });

  it('should return 403 for InvalidAccessKeyId', () => {
    const response = buildS3ErrorResponse('InvalidAccessKeyId');
    expect(response.status).toBe(403);
  });

  it('should return 405 for MethodNotAllowed', () => {
    const response = buildS3ErrorResponse('MethodNotAllowed');
    expect(response.status).toBe(405);
  });

  it('should return 404 for NoSuchBucket', () => {
    const response = buildS3ErrorResponse('NoSuchBucket');
    expect(response.status).toBe(404);
  });

  it('should return 404 for NoSuchKey', () => {
    const response = buildS3ErrorResponse('NoSuchKey');
    expect(response.status).toBe(404);
  });

  it('should return 500 for InternalError', () => {
    const response = buildS3ErrorResponse('InternalError');
    expect(response.status).toBe(500);
  });

  it('should return 400 for InvalidRequest', () => {
    const response = buildS3ErrorResponse('InvalidRequest');
    expect(response.status).toBe(400);
  });

  // ─── Headers ───────────────────────────────────────────────

  it('should set Content-Type to application/xml', () => {
    const response = buildS3ErrorResponse('AccessDenied');
    expect(response.headers.get('Content-Type')).toBe(
      'application/xml; charset=utf-8',
    );
  });

  it('should include x-amz-request-id header', () => {
    const response = buildS3ErrorResponse('AccessDenied', '/', 'test-req-id');
    expect(response.headers.get('x-amz-request-id')).toBe('test-req-id');
  });

  // ─── Custom Messages ──────────────────────────────────────

  it('should use a custom message when provided', async () => {
    const response = buildS3ErrorResponse(
      'MethodNotAllowed',
      '/test',
      'req-456',
      'PUT is not supported',
    );
    const body = await response.text();
    expect(body).toContain('<Message>PUT is not supported</Message>');
  });

  it('should use the default message when no custom message is given', async () => {
    const response = buildS3ErrorResponse('NoSuchBucket', '/missing-bucket');
    const body = await response.text();
    expect(body).toContain(
      '<Message>The specified bucket does not exist.</Message>',
    );
  });

  // ─── XML Escaping ─────────────────────────────────────────

  it('should escape XML special characters in resource path', async () => {
    const response = buildS3ErrorResponse(
      'NoSuchKey',
      '/bucket/<script>alert("xss")</script>',
      'req-789',
    );
    const body = await response.text();
    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>');
  });

  it('should escape ampersands in custom messages', async () => {
    const response = buildS3ErrorResponse(
      'InvalidRequest',
      '/',
      'req-000',
      'key1=val1&key2=val2',
    );
    const body = await response.text();
    expect(body).toContain('key1=val1&amp;key2=val2');
  });

  // ─── Default Parameters ───────────────────────────────────

  it('should generate a random requestId when none is provided', () => {
    const response = buildS3ErrorResponse('InternalError');
    const requestId = response.headers.get('x-amz-request-id');
    expect(requestId).toBeTruthy();
    // UUID format: 8-4-4-4-12 hex chars
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should default resource to "/" when not provided', async () => {
    const response = buildS3ErrorResponse('AccessDenied');
    const body = await response.text();
    expect(body).toContain('<Resource>/</Resource>');
  });
});
