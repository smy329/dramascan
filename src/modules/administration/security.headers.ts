/**
 * Security headers and browser protections module.
 *
 * Provides Content Security Policy, frame protections, content-type protections,
 * and referrer policy. Compatible with Google OAuth, Vidstack, and MP4 hosts.
 * Does not weaken security globally.
 *
 * Do not implement: aggressive CSP that breaks application functionality,
 * or security headers that conflict with required external services.
 */

import 'server-only';

/** Content Security Policy directives. */
export type CSPDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'connect-src'
  | 'font-src'
  | 'frame-src'
  | 'object-src'
  | 'base-uri'
  | 'form-action'
  | 'frame-ancestors';

/** Content Security Policy configuration. */
export interface CSPConfiguration {
  /** Default source for all resource types */
  defaultSrc: string[];
  /** Script source directives */
  scriptSrc: string[];
  /** Style source directives */
  styleSrc: string[];
  /** Image source directives */
  imgSrc: string[];
  /** Connect source directives (XHR, WebSockets, etc.) */
  connectSrc: string[];
  /** Font source directives */
  fontSrc: string[];
  /** Frame source directives */
  frameSrc: string[];
  /** Object source directives */
  objectSrc: string[];
  /** Base URI restrictions */
  baseUri: string[];
  /** Form action restrictions */
  formAction: string[];
  /** Frame ancestors (X-Frame-Options equivalent) */
  frameAncestors: string[];
}

/** Get default CSP configuration. */
export function getDefaultCSPConfiguration(): CSPConfiguration {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://*.google.com', 'https://*.vidstack.net'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://*.api.dramascan.local'],
    fontSrc: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
}

/** Get CSP configuration based on alert configuration. */
export function getCSPFromConfiguration(): CSPConfiguration {
  // In a production system, would derive CSP from alert config
  // For now, return default configuration
  return getDefaultCSPConfiguration();
}

/** Generate HTTP CSP header string. */
export function generateCSPHeader(configuration?: CSPConfiguration): string {
  const effectiveConfig = configuration || getDefaultCSPConfiguration();

  const directives: string[] = [];

  if (effectiveConfig) {
    if (effectiveConfig.defaultSrc) {
      directives.push(`default-src ${effectiveConfig.defaultSrc.join(' ')}`);
    }
    if (effectiveConfig.scriptSrc) {
      directives.push(`script-src ${effectiveConfig.scriptSrc.join(' ')}`);
    }
    if (effectiveConfig.styleSrc) {
      directives.push(`style-src ${effectiveConfig.styleSrc.join(' ')}`);
    }
    if (effectiveConfig.imgSrc) {
      directives.push(`img-src ${effectiveConfig.imgSrc.join(' ')}`);
    }
    if (effectiveConfig.connectSrc) {
      directives.push(`connect-src ${effectiveConfig.connectSrc.join(' ')}`);
    }
    if (effectiveConfig.fontSrc) {
      directives.push(`font-src ${effectiveConfig.fontSrc.join(' ')}`);
    }
    if (effectiveConfig.frameSrc) {
      directives.push(`frame-src ${effectiveConfig.frameSrc.join(' ')}`);
    }
    if (effectiveConfig.objectSrc) {
      directives.push(`object-src ${effectiveConfig.objectSrc.join(' ')}`);
    }
    if (effectiveConfig.baseUri) {
      directives.push(`base-uri ${effectiveConfig.baseUri.join(' ')}`);
    }
    if (effectiveConfig.formAction) {
      directives.push(`form-action ${effectiveConfig.formAction.join(' ')}`);
    }
    if (effectiveConfig.frameAncestors !== undefined) {
      directives.push(`frame-ancestors ${effectiveConfig.frameAncestors.join(' ')}`);
    }
  } else {
    // Default CSP
    directives.push("default-src 'self'");
    directives.push("script-src 'self' https://*.google.com https://*.vidstack.net");
    directives.push("style-src 'self' 'unsafe-inline'");
    directives.push("img-src 'self' data: https:");
    directives.push("connect-src 'self' https://*.api.dramascan.local");
    directives.push("font-src 'self'");
    directives.push("frame-src 'none'");
    directives.push("object-src 'none'");
    directives.push("base-uri 'self'");
    directives.push("form-action 'self'");
    directives.push("frame-ancestors 'none'");
  }

  return directives.join('; ');
}

/** Frame protection value (X-Frame-Options). */
export function getFrameProtection(): string {
  return 'DENY';
}

/** Content-Type protection value (X-Content-Type-Options). */
export function getContentTypeProtection(): string {
  return 'nosniff';
}

/** Referrer policy value. */
export function getReferrerPolicy(): string {
  return 'strict-origin-when-cross-origin';
}

/** HSTS header value. */
export function getHSTSHeader(maxAge: number = 31536000): string {
  return `max-age=${maxAge}; includeSubDomains; preload`;
}

/** Get all security headers. */
export function getAllSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': generateCSPHeader(),
    'X-Frame-Options': getFrameProtection(),
    'X-Content-Type-Options': getContentTypeProtection(),
    'Referrer-Policy': getReferrerPolicy(),
    'Strict-Transport-Security': getHSTSHeader(),
  };
}

/** Validate CSP is compatible with Vidstack. */
export function isCSPCompatibleWithVidstack(cspConfiguration: CSPConfiguration): boolean {
  // Vidstack requires script sources to include its domain
  const hasVidstackSource = cspConfiguration.scriptSrc.some(
    source => source.includes('vidstack') || source.includes('video.js')
  );

  // Vidstack requires img-src to allow image loading
  const allowsImages = cspConfiguration.imgSrc.some(
    source => source === '*' || source.includes('https:') || source === 'data:'
  );

  return hasVidstackSource && allowsImages;
}
