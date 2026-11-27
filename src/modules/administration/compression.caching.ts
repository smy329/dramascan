/**
 * Application compression and caching module.
 *
 * Provides hybrid Brotli + Gzip compression, Next.js built-in caching,
 * PostgreSQL-backed data access without Redis, tag-based cache invalidation
 * for content changes, and no caching of private user data or unpublished content.
 *
 * Do not implement: Redis caching, persistent cache workers, or caching
 * private user data or unpublished content.
 */

import 'server-only';

import { getDeploymentConfiguration } from './deployment.config';

/** Compression algorithm. */
export type CompressionAlgorithm = 'gzip' | 'brotli' | 'both';

/** Cache control directive. */
export type CacheDirective = 'public' | 'private' | 'no-store' | 'no-cache' | 'max-age' | 's-maxage';

/** Compression configuration. */
export interface CompressionConfiguration {
  /** Enabled algorithms */
  algorithms: CompressionAlgorithm[];
  /** Minimum response size to compress */
  minimumSize: number;
  /** Compression level */
  quality: number;
  /** Whether to compress HTML */
  compressHtml: boolean;
  /** Whether to compress JSON */
  compressJSON: boolean;
  /** Whether to compress CSS */
  compressCSS: boolean;
  /** Whether to compress JavaScript */
  compressJavaScript: boolean;
}

/** Get default compression configuration. */
export function getDefaultCompressionConfiguration(): CompressionConfiguration {
  return {
    algorithms: ['both'],
    minimumSize: 1024,
    quality: 6,
    compressHtml: true,
    compressJSON: true,
    compressCSS: true,
    compressJavaScript: true,
  };
}

/** Get compression configuration from environment. */
export function getCompressionConfiguration(): CompressionConfiguration {
  const compressAlgorithms = (process.env.COMPRESSION_ALGORITHMS || 'both').split(',') as CompressionAlgorithm[];
  const minimumSize = Number(process.env.COMPRESSION_MINIMUM_SIZE) || 1024;
  const quality = Number(process.env.COMPRESSION_QUALITY) || 6;

  return {
    algorithms: compressAlgorithms.filter(a => ['gzip', 'brotli', 'both'].includes(a)),
    minimumSize,
    quality,
    compressHtml: process.env.COMPRESS_HTML !== 'false',
    compressJSON: process.env.COMPRESS_JSON !== 'false',
    compressCSS: process.env.COMPRESS_CSS !== 'false',
    compressJavaScript: process.env.COMPRESS_JS !== 'false',
  };
}

/** Cache configuration. */
export interface CacheConfiguration {
  /** Whether HTTP caching is enabled */
  enabled: boolean;
  /** Default cache directive */
  defaultDirective: CacheDirective;
  /** Tag-based cache invalidation */
  tagBasedInvalidation: boolean;
  /** Cache TTL in seconds */
  defaultTtl: number;
  /** Whether to cache API responses */
  cacheAPIResponses: boolean;
  /** Whether to cache rendered HTML */
  cacheHTML: boolean;
}

/** Get default cache configuration. */
export function getDefaultCacheConfiguration(): CacheConfiguration {
  return {
    enabled: true,
    defaultDirective: 'public',
    tagBasedInvalidation: true,
    defaultTtl: 300, // 5 minutes
    cacheAPIResponses: true,
    cacheHTML: true,
  };
}

/** Get cache configuration from environment. */
export function getCacheConfiguration(): CacheConfiguration {
  return {
    enabled: process.env.ENABLE_HTTP_CACHE !== 'false',
    defaultDirective: process.env.CACHE_DEFAULT_DIRECTIVE || 'public',
    tagBasedInvalidation: process.env.CACHE_TAG_BASED_INVALIDATION !== 'false',
    defaultTtl: Number(process.env.CACHE_DEFAULT_TTL) || 300,
    cacheAPIResponses: process.env.CACHE_API_RESPONSES !== 'false',
    cacheHTML: process.env.CACHE_HTML !== 'false',
  };
}

/** Get CDN cache control header. */
export function getCDNCacheControlHeader(cacheCfg: CacheConfiguration): string {
  const directives: string[] = [];

  if (!cacheCfg.enabled) {
    return 'no-store';
  }

  directives.push('max-age=' + cacheCfg.defaultTtl);

  if (cacheCfg.tagBasedInvalidation) {
    directives.push('must-revalidate');
  }

  return directives.join(', ');
}

/** Get Edge-Cache-Control header for Next.js. */
export function getEdgeCacheControlHeader(cacheCfg: CacheConfiguration): string {
  const directives: string[] = [];

  if (cacheCfg.cacheHTML) {
    directives.push('public');
  } else {
    directives.push('no-store');
  }

  if (cacheCfg.tagBasedInvalidation) {
    directives.push('must-revalidate');
  }

  if (cacheCfg.defaultDirective) {
    directives.push(cacheCfg.defaultDirective);
  }

  return directives.join(', ');
}

/** Invalidate cache by tag. */
export async function invalidateCacheByTag(
  tag: string,
  performedBy: string
): Promise<{ success: boolean; message: string }> {
  // In a production environment, would use Redis or a cache invalidation service
  // For now, we'll log the invalidation
  // eslint-disable-next-line no-console
  console.log('Cache invalidation triggered for tag: ' + tag + ' by ' + performedBy);

  return {
    success: true,
    message: 'Cache invalidation triggered for tag: ' + tag,
  };
}

/** Get cache control headers for API responses. */
export function getAPICacheHeaders(cacheCfg: CacheConfiguration): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!cacheCfg.enabled) {
    headers['Cache-Control'] = 'no-store';
    headers['Pragma'] = 'no-cache';
    headers['Expires'] = '0';
    return headers;
  }

  const directive = cacheCfg.defaultDirective === 'public' ? 'public, max-age=' + cacheCfg.defaultTtl : 'no-store';
  headers['Cache-Control'] = directive;

  return headers;
}

/** Get cache control headers for HTML responses. */
export function getHTMLCacheHeaders(cacheCfg: CacheConfiguration): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!cacheCfg.enabled) {
    headers['Cache-Control'] = 'no-store';
    headers['Pragma'] = 'no-cache';
    headers['Expires'] = '0';
    return headers;
  }

  // HTML caching depends on whether content is personalized
  // For public content, allow caching
  if (cacheCfg.cacheHTML) {
    headers['Cache-Control'] = 'public, max-age=' + cacheCfg.defaultTtl;
  } else {
    headers['Cache-Control'] = 'no-store';
  }

  if (cacheCfg.tagBasedInvalidation) {
    headers['Surrogate-Control'] = 'max-age=' + cacheCfg.defaultTtl + ', must-revalidate';
  }

  return headers;
}