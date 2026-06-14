/**
 * S3 XML Error Response Builder
 *
 * Generates well-formed XML error responses that conform to the
 * S3 REST API error format. This ensures that standard S3 clients
 * (aws-cli, rclone, SDKs) can parse error responses correctly.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
 */

import type { S3ErrorCode } from './types';

// ─── Error Metadata ──────────────────────────────────────────

interface S3ErrorMeta {
  /** HTTP status code */
  httpStatus: number;
  /** Human-readable error message */
  message: string;
}

/**
 * Mapping of S3 error codes to their HTTP status and default message.
 */
const ERROR_MAP: Record<S3ErrorCode, S3ErrorMeta> = {
  AccessDenied: {
    httpStatus: 403,
    message: 'Access Denied',
  },
  InvalidAccessKeyId: {
    httpStatus: 403,
    message: 'The AWS Access Key Id you provided does not exist in our records.',
  },
  MethodNotAllowed: {
    httpStatus: 405,
    message: 'The specified method is not allowed against this resource.',
  },
  NoSuchBucket: {
    httpStatus: 404,
    message: 'The specified bucket does not exist.',
  },
  NoSuchKey: {
    httpStatus: 404,
    message: 'The specified key does not exist.',
  },
  InternalError: {
    httpStatus: 500,
    message: 'We encountered an internal error. Please try again.',
  },
  InvalidRequest: {
    httpStatus: 400,
    message: 'Invalid Request.',
  },
};

// ─── XML Builder ─────────────────────────────────────────────

/**
 * Escapes special XML characters in a string.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a standard S3 XML error response.
 *
 * @param code     - One of the well-known S3ErrorCode values.
 * @param resource - The resource path that triggered the error (optional).
 * @param requestId - A unique identifier for this request (optional).
 * @param customMessage - Override the default error message (optional).
 * @returns A `Response` with the correct status, content-type, and XML body.
 *
 * @example
 * ```ts
 * return buildS3ErrorResponse('AccessDenied', '/my-bucket/my-key');
 * ```
 */
export function buildS3ErrorResponse(
  code: S3ErrorCode,
  resource: string = '/',
  requestId: string = crypto.randomUUID(),
  customMessage?: string,
): Response {
  const meta = ERROR_MAP[code];
  const message = customMessage ?? meta.message;

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Error>',
    `  <Code>${escapeXml(code)}</Code>`,
    `  <Message>${escapeXml(message)}</Message>`,
    `  <Resource>${escapeXml(resource)}</Resource>`,
    `  <RequestId>${escapeXml(requestId)}</RequestId>`,
    '</Error>',
  ].join('\n');

  return new Response(xml, {
    status: meta.httpStatus,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'x-amz-request-id': requestId,
    },
  });
}
