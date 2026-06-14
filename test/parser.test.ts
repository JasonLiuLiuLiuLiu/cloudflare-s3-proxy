import { describe, it, expect } from 'vitest';
import { parseS3Path } from '../src/parser';

describe('parseS3Path', () => {
  // ─── Basic Parsing ──────────────────────────────────────────

  it('should parse bucket and key from a standard path', () => {
    const result = parseS3Path('/my-bucket/path/to/object.txt');
    expect(result).toEqual({
      bucketName: 'my-bucket',
      objectKey: 'path/to/object.txt',
    });
  });

  it('should parse a path with only a bucket name (no key)', () => {
    const result = parseS3Path('/my-bucket');
    expect(result).toEqual({
      bucketName: 'my-bucket',
      objectKey: '',
    });
  });

  it('should parse a path with a trailing slash (bucket only)', () => {
    const result = parseS3Path('/my-bucket/');
    expect(result).toEqual({
      bucketName: 'my-bucket',
      objectKey: '',
    });
  });

  it('should return null for the root path', () => {
    expect(parseS3Path('/')).toBeNull();
  });

  it('should return null for an empty string', () => {
    expect(parseS3Path('')).toBeNull();
  });

  // ─── URL Decoding ──────────────────────────────────────────

  it('should decode percent-encoded spaces in object key', () => {
    const result = parseS3Path('/my-bucket/my%20file.txt');
    expect(result).toEqual({
      bucketName: 'my-bucket',
      objectKey: 'my file.txt',
    });
  });

  it('should decode CJK characters in object key', () => {
    const result = parseS3Path(
      '/my-bucket/%E5%A4%87%E4%BB%BD%E6%96%87%E4%BB%B6/data.zip',
    );
    expect(result).toEqual({
      bucketName: 'my-bucket',
      objectKey: '备份文件/data.zip',
    });
  });

  it('should decode the bucket name as well', () => {
    const result = parseS3Path('/%E6%B5%8B%E8%AF%95/file.txt');
    expect(result).toEqual({
      bucketName: '测试',
      objectKey: 'file.txt',
    });
  });

  it('should handle plus signs literally (not as spaces)', () => {
    // In URI encoding, + is not a space; %20 is.
    const result = parseS3Path('/bucket/file+name.txt');
    expect(result).toEqual({
      bucketName: 'bucket',
      objectKey: 'file+name.txt',
    });
  });

  it('should handle malformed percent-encoding gracefully', () => {
    // %ZZ is not valid percent-encoding; should be returned as-is
    const result = parseS3Path('/bucket/%ZZinvalid');
    expect(result).toEqual({
      bucketName: 'bucket',
      objectKey: '%ZZinvalid',
    });
  });

  // ─── Deep Keys ─────────────────────────────────────────────

  it('should handle deeply nested object keys', () => {
    const result = parseS3Path('/bucket/a/b/c/d/e/f/g.txt');
    expect(result).toEqual({
      bucketName: 'bucket',
      objectKey: 'a/b/c/d/e/f/g.txt',
    });
  });

  it('should handle keys that look like paths with extensions', () => {
    const result = parseS3Path('/backup/2025/06/14/db-dump.sql.gz');
    expect(result).toEqual({
      bucketName: 'backup',
      objectKey: '2025/06/14/db-dump.sql.gz',
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────

  it('should handle multiple consecutive slashes by filtering empty segments', () => {
    const result = parseS3Path('///bucket///key///');
    expect(result).toEqual({
      bucketName: 'bucket',
      objectKey: 'key',
    });
  });
});
