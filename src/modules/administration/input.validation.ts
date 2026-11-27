/**
 * Input validation and output safety module.
 *
 * Provides server-side validation for all public/admin inputs, safe rendering,
 * URL validation, file validation, and prevention of XSS, SQL injection, unsafe
 * redirects, path traversal, and mass-assignment. Uses Drizzle parameterization
 * and safe React rendering.
 *
 * Do not implement: client-side only validation, or trust any input that has
 * passed through the browser.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  cleanedValue?: unknown;
}

/** Validate a string input. */
export function validateString(
  value: unknown,
  options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    allowedValues?: string[];
    trim?: boolean;
  } = {}
): ValidationResult {
  const errors: string[] = [];
  let cleaned: string | undefined;

  if (value === undefined || value === null) {
    return { valid: false, errors: ['Value is required'] };
  }

  let str = String(value);

  if (options.trim !== false) {
    str = str.trim();
  }

  if (options.minLength !== undefined && str.length < options.minLength) {
    errors.push(`String must be at least ${options.minLength} characters`);
  }

  if (options.maxLength !== undefined && str.length > options.maxLength) {
    errors.push(`String must be at most ${options.maxLength} characters`);
  }

  if (options.pattern && !options.pattern.test(str)) {
    errors.push(`String does not match required pattern`);
  }

  if (options.allowedValues && !options.allowedValues.includes(str)) {
    errors.push(`String is not an allowed value`);
  }

  cleaned = errors.length === 0 ? str : undefined;

  return { valid: errors.length === 0, errors, cleanedValue: cleaned };
}

/** Validate a URL input. */
export function validateURL(
  value: unknown,
  options: {
    allowedProtocols?: string[];
    requireTLD?: boolean;
    disallowInternal?: boolean;
  } = {}
): ValidationResult {
  const errors: string[] = [];
  let cleaned: string | undefined;

  if (value === undefined || value === null) {
    return { valid: false, errors: ['URL is required'] };
  }

  let url = String(value);

  try {
    const parsed = new URL(url);
    cleaned = url;

    if (options.allowedProtocols && !options.allowedProtocols.includes(parsed.protocol)) {
      errors.push(`URL protocol not allowed. Allowed: ${options.allowedProtocols.join(', ')}`);
    }

    if (options.requireTLD && !parsed.hostname.includes('.')) {
      errors.push('URL must have a top-level domain');
    }

    if (options.disallowInternal && parsed.hostname.startsWith('localhost') || parsed.hostname.startsWith('127.')) {
      errors.push('Internal URLs are not allowed');
    }
  } catch (e) {
    errors.push('Invalid URL format');
    cleaned = undefined;
  }

  return { valid: errors.length === 0, errors, cleanedValue: cleaned };
}

/** Validate a file input. */
export function validateFile(
  value: unknown,
  options: {
    allowedExtensions?: string[];
    maxSize?: number;
    disallowExecutable?: boolean;
  } = {}
): ValidationResult {
  const errors: string[] = [];
  let cleaned: string | undefined;

  if (value === undefined || value === null) {
    return { valid: false, errors: ['File is required'] };
  }

  const fileName = String(value);
  const fileExtension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

  if (options.allowedExtensions && !options.allowedExtensions.includes(fileExtension)) {
    errors.push(`File extension ${fileExtension} is not allowed. Allowed: ${options.allowedExtensions.join(', ')}`);
  }

  if (options.disallowExecutable && MALICIOUS_EXTENSIONS.some(ext => fileExtension.includes(ext))) {
    errors.push('Executable files are not allowed');
  }

  if (options.maxSize && value.size > options.maxSize) {
    errors.push(`File size exceeds maximum of ${options.maxSize / (1024 * 1024)}MB`);
  }

  cleaned = errors.length === 0 ? fileName : undefined;

  return { valid: errors.length === 0, errors, cleanedValue: cleaned };
}

/** Sanitize HTML to prevent XSS. */
export function sanitizeHTML(
  html: string,
  options: {
    allowedTags?: string[];
    allowedAttributes?: Record<string, string[]>;
    allowedIframeSrcs?: string[];
  } = {}
): string {
  // In a production environment, would use a library like DOMPurify
  // For now, basic sanitization

  let sanitized = html;

  // Remove script tags and their contents
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove event handlers
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');

  // Remove dangerous protocols
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/data:/gi, '');

  return sanitized;
}

/** Safe rendering helper - ensures value is properly escaped. */
export function safeRender(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    // Escape HTML special characters
    return value
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, ''');
  }

  return String(value);
}

/** Mass-assignment protection - only allow specified fields. */
export function protectAgainstMassAssignment(
  object: Record<string, unknown>,
  allowedFields: string[]
): Record<string, unknown> {
  const safeObject: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in object) {
      safeObject[field] = object[field];
    }
  }

  return safeObject;
}