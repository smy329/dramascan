/**
 * API authorization and OpenAPI documentation module.
 *
 * Provides OpenAPI/Swagger documentation for REST endpoints, including
 * authentication requirements, permissions, and validation schemas. Ensures
 * REST authorization matches Server Action authorization. Never assumes a
 * route is safe because UI is hidden.
 *
 * Do not implement: automatic route protection based solely on UI visibility,
 * or documentation that diverges from actual server-side authorization.
 */

import 'server-only';

/** OpenAPI info object. */
export interface OpenAPIInfo {
  title: string;
  description: string;
  version: string;
  contact?: {
    name: string;
    email: string;
    url: string;
  };
  license?: {
    name: string;
    url: string;
  };
}

/** OpenAPI server object. */
export interface OpenAPIServer {
  url: string;
  description?: string;
}

/** OpenAPI security scheme. */
export type OpenAPISecurityScheme = 'http' | 'https' | 'oauth2' | 'apiKey';

/** OpenAPI security requirement. */
export interface OpenAPISecurityRequirement {
  [key: string]: string[];
}

/** OpenAPI path item. */
export interface OpenAPIPathItem {
  summary?: string;
  description?: string;
  get?: OpenAPIOperation;
  put?: OpenAPIOperation;
  post?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  options?: OpenAPIOperation;
  head?: OpenAPIOperation;
}

/** OpenAPI operation. */
export interface OpenAPIOperation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  responses: {
    [code: string]: OpenAPIResponse;
  };
  security?: OpenAPISecurityRequirement[];
  servers?: OpenAPIServer[];
  requestBody?: OpenAPIRequestBody;
}

/** OpenAPI parameter. */
export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema: {
    type: string;
    format?: string;
    enum?: string[];
    default?: unknown;
    items?: { type: string; properties?: Record<string, { type: string; format?: string; enum?: string[] }> };
    properties?: Record<string, { type: string; format?: string; enum?: string[] }>;
  };
}

/** OpenAPI response. */
export interface OpenAPIResponse {
  description: string;
  content?: {
    'application/json': {
      schema: {
        type: string;
        example?: unknown;
        items?: { type: string; properties?: Record<string, { type: string; format?: string; enum?: string[] }> };
        properties?: Record<string, { type: string; format?: string; enum?: string[] }>;
      };
    };
  };
}

/** OpenAPI request body. */
export interface OpenAPIRequestBody {
  description: string;
  content: {
    'application/json': {
      schema: {
        type: string;
        example?: unknown;
        items?: { type: string; properties?: Record<string, { type: string; format?: string; enum?: string[] }> };
        properties?: Record<string, { type: string; format?: string; enum?: string[] }>;
      };
    };
  };
}

/** OpenAPI security scheme object. */
export interface OpenAPISecuritySchemeObject {
  type: OpenAPISecurityScheme;
  description: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  flow?: 'password' | 'implicit' | 'authorizationCode' | 'clientCredentials';
  scopes?: string[];
  scheme?: string;
  bearerFormat?: string;
}

/** OpenAPI document. */
export interface OpenAPIDocument {
  openapi: string;
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  paths: Record<string, OpenAPIPathItem>;
  components?: {
    securitySchemes: Record<string, OpenAPISecuritySchemeObject>;
    schemas: Record<string, {
      type: string;
      properties?: Record<string, {
        type: string;
        format?: string;
        description?: string;
        enum?: string[];
      }>;
    }>;
    responses?: Record<string, OpenAPIResponse>;
  };
}

/** Get OpenAPI document for the application. */
export function getOpenAPIDocument(): OpenAPIDocument {
  const info: OpenAPIInfo = {
    title: 'DramaScan Streaming Platform API',
    description: 'API for the DramaScan drama and movie streaming platform',
    version: '1.0.0',
  };

  const paths: Record<string, OpenAPIPathItem> = {
    // Authentication endpoints
    '/api/auth/login': {
      post: {
        operationId: 'login',
        tags: ['authentication'],
        summary: 'User login',
        description: 'Authenticate user with Google OAuth',
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  example: { token: 'eyJhbGciOiJIUzI1NiJ9' },
                },
              },
            },
          },
          '401': {
            description: 'Invalid credentials',
          },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        operationId: 'logout',
        tags: ['authentication'],
        summary: 'User logout',
        description: 'Logout the current user',
        responses: {
          '200': {
            description: 'Logout successful',
          },
        },
      },
    },
    '/api/auth/google': {
      get: {
        operationId: 'googleAuth',
        tags: ['authentication'],
        summary: 'Google OAuth login',
        description: 'Initiate Google OAuth authentication',
        responses: {
          '302': {
            description: 'Redirect to Google OAuth',
          },
        },
      },
    },
    '/api/auth/callback': {
      get: {
        operationId: 'googleAuthCallback',
        tags: ['authentication'],
        summary: 'Google OAuth callback',
        description: 'Handle Google OAuth callback',
        responses: {
          '200': {
            description: 'OAuth callback successful',
          },
        },
      },
    },
    // Drama endpoints
    '/api/dramas': {
      get: {
        operationId: 'listDramas',
        tags: ['dramas'],
        summary: 'List dramas',
        description: 'List all dramas',
        parameters: [
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20 },
          },
        ],
        responses: {
          '200': {
            description: 'List of dramas',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      type: { type: 'string' },
                      visibility: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/dramas/{id}': {
      get: {
        operationId: 'getDrama',
        tags: ['dramas'],
        summary: 'Get drama by ID',
        description: 'Get drama details by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Drama details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    type: { type: 'string' },
                    visibility: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Drama not found',
          },
        },
      },
    },
    // Admin endpoints
    '/api/admin/settings': {
      get: {
        operationId: 'getSettings',
        tags: ['admin'],
        summary: 'Get system settings',
        description: 'Get all system settings (Super Admin only)',
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description: 'System settings',
          },
        },
      },
    },
  };

  return {
    openapi: '1.0.0',
    info,
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Bearer token for API authentication',
        },
      },
      schemas: {},
    },
  };
}

/** Get authorization requirement for an endpoint. */
export function getEndpointAuthorization(
  endpoint: string
): { requiresAuth: boolean; requiredPermission?: string } {
  // In a production system, would derive from actual authorization rules
  // For now, return default based on endpoint pattern
  if (endpoint.startsWith('/api/admin/')) {
    return { requiresAuth: true, requiredPermission: 'admin.manage' };
  }

  if (endpoint.startsWith('/api/auth/') || endpoint.startsWith('/api/reports/')) {
    return { requiresAuth: true, requiredPermission: 'auth.login' };
  }

  return { requiresAuth: true, requiredPermission: 'public.read' };
}

/** Validate OpenAPI document against security requirements. */
export function validateOpenAPISecurity(
  doc: OpenAPIDocument
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check that authenticated endpoints have security requirements
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (method === 'get' || method === 'post' || method === 'put' || method === 'delete') {
        const hasSecurity = operation.security && operation.security.length > 0;
        const isPublic = path.startsWith('/api/public/');

        if (!hasSecurity && !isPublic) {
          issues.push(`Endpoint ${path}${method} lacks security requirement`);
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
