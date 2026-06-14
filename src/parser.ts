/**
 * S3 Path Parser
 *
 * Parses incoming Path-Style S3 URLs into their constituent parts:
 * bucket name and object key.
 *
 * Path-Style format:  https://proxy.example.com/<bucket>/<key>
 *
 * All path segments are URI-decoded so that object keys containing
 * spaces, CJK characters, or other special characters are handled
 * correctly. `aws4fetch` will re-encode them when signing the
 * outbound request to B2.
 */

import type { ParsedS3Path } from './types';

/**
 * Parses the URL pathname into bucket name and object key.
 *
 * Each segment is individually `decodeURIComponent`'d to correctly
 * handle keys like `备份文件/2025 Q1.tar.gz` which arrive as
 * `%E5%A4%87%E4%BB%BD%E6%96%87%E4%BB%B6/2025%20Q1.tar.gz`.
 *
 * @param pathname - The URL pathname, e.g. "/my-bucket/path/to/object.txt"
 * @returns Parsed bucket + key, or `null` if the path is empty (root request).
 *
 * @example
 * ```ts
 * parseS3Path('/my-bucket/folder/file.zip')
 * // => { bucketName: 'my-bucket', objectKey: 'folder/file.zip' }
 *
 * parseS3Path('/my-bucket/%E4%B8%AD%E6%96%87.txt')
 * // => { bucketName: 'my-bucket', objectKey: '中文.txt' }
 *
 * parseS3Path('/my-bucket')
 * // => { bucketName: 'my-bucket', objectKey: '' }
 *
 * parseS3Path('/')
 * // => null  (root-level, no bucket specified)
 * ```
 */
export function parseS3Path(pathname: string): ParsedS3Path | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) {
    return null;
  }

  // Decode each segment individually so that encoded slashes (%2F)
  // within a segment are NOT treated as path separators.
  const bucketName = safeDecodeURIComponent(segments[0]!);
  const objectKey = segments
    .slice(1)
    .map(safeDecodeURIComponent)
    .join('/');

  return { bucketName, objectKey };
}

/**
 * Safely decodes a URI component, returning the original string
 * if decoding fails (e.g. malformed percent-encoding like `%ZZ`).
 */
function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}
