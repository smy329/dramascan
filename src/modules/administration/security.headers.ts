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

import { getAlertConfiguration } from './alert.severity';

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
  const config = getAlertConfiguration();

  // In a production system, would derive CSP from alert config
  // For now, return default configuration
  return getDefaultCSPConfiguration();
}

/** Generate HTTP CSP header string. */
export function generateCSPHeader(configuration?: CSPConfiguration): string {
  const csp = configuration || getDefaultCSPConfiguration();

  const directives: string[] = [];

  if (configuration) {
    if (configuration.defaultSrc) {
      directives.push(`default-src ${configuration.defaultSrc.join(' ')}`);
    }
    if (configuration.scriptSrc) {
      directives.push(`script-src ${configuration.scriptSrc.join(' ')}`);
    }
    if (configuration.styleSrc) {
      directives.push(`style-src ${configuration.styleSrc.join(' ')}`);
    }
    if (configuration.imgSrc) {
      directives.push(`img-src ${configuration.imgSrc.join(' ')}`);
    }
    if (configuration.connectSrc) {
      directives.push(`connect-src ${configuration.connectSrc.join(' ')}`);
    }
    if (configuration.fontSrc) {
      directives.push(`font-src ${configuration.fontSrc.join(' ')}`);
    }
    if (configuration.frameSrc) {
      directives.push(`frame-src ${configuration.frameSrc.join(' ')}`);
    }
    if (configuration.objectSrc) {
      directives.push(`object-src ${configuration.objectSrc.join(' ')}`);
    }
    if (configuration.baseUri) {
      directives.push(`base-uri ${configuration.baseUri.join(' ')}`);
    }
    if (configuration.formAction) {
      directives.push(`form-action ${configuration.formAction.join(' ')}`);
    }
    if (configuration.frameAncestors !== undefined) {
      directives.push(`frame-ancestors ${configuration.frameAncestors.join(' ')}`);
    }
  } else {
    // Default CSP
    directives.push "default-src 'self'";
    directives.push "script-src 'self' https://*.google.com https://*.vidstack.net";
    directives.push "style-src 'self' 'unsafe-inline'";
    directives.push "img-src 'self' data: https:";
    directives.push "connect-src 'self' https://*.api.dramascan.local";
    directives.push "font-src 'self'";
    directives.push "frame-src 'none'";
    directives.push "object-src 'none'";
    directives.push "base-uri 'self'";
    directives.push "form-action 'self'";
    directives.push "frame-ancestors 'none'";
  }

  return `Content-Security-Policy-${directives.length > 0 ? '' : ''}${directives.join('; ')}`;
}

/** Frame protection (X-Frame-Options). */
export function getFrameProtection(): string {
  return 'X-Frame-Options: DENY';
}

/** Content-Type protection (X-Content-Type-Options). */
export getContentTypeProtection(): string {
  return 'X-Content-Type-Options: nosniff';
}

/** Referrer policy. */
export function getReferrerPolicy(): string {
  return 'Referrer-Policy: strict-origin-when-cross-origin';
}

/** HSTS header. */
export function getHSTSHeader(maxAge: number = 31536000): string {
  return `Strict-Transport-Security: max-age=${maxAge}; includeSubDomains; preload`;
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
  const hasVidstackSource = configuration.scriptSrc.some(
    source => source.includes('vidstack') || source.includes('video.js')
  );

  // Vidstack requires img-src to allow image loading
  const allowsImages = configuration.imgSrc.some(
    source => source === '*' || source.includes('https:') || source === 'data:'
  );

  return hasVidstackSource && allowsImages;
}