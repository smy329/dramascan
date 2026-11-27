/**
 * Nginx reverse proxy and HTTPS configuration module.
 *
 * Provides Nginx as reverse proxy for Next.js, proxy headers, body limits for
 * image uploads, timeouts, compression, static asset handling, hosting-provider-
 * managed SSL, and does not proxy external video media.
 *
 * Do not implement: video proxying, relaying, or rehosting; or custom nginx
 * configuration beyond the approved settings.
 */

import 'server-only';

import { getDeploymentConfiguration } from './deployment.config';

/** Nginx proxy cache key. */
export type ProxyCacheKey = 'html' | 'json' | 'video' | 'static' | 'api';

/** Nginx proxy cache time. */
export type ProxyCacheTime = 'off' | '1m' | '5m' | '10m' | '30m' | '1h' | '1d';

/** Nginx configuration settings. */
export interface NginxConfiguration {
  /** Server name(s) */
  serverName: string[];
  /** Listen port */
  listenPort: number;
  /** SSL enabled */
  sslEnabled: boolean;
  /** SSL certificate path */
  sslCertPath: string;
  /** SSL key path */
  sslKeyPath: string;
  /** Proxy buffer size */
  proxyBufferSize: string;
  /** Proxy read timeout */
  proxyReadTimeout: string;
  /** Proxy send timeout */
  proxySendTimeout: string;
  /** Proxy connect timeout */
  proxyConnectTimeout: string;
  /** Client body timeout */
  clientBodyTimeout: string;
  /** Keepalive timeout */
  keepaliveTimeout: string;
  /** Gzip compression */
  gzip: boolean;
  /** Gzip minimum length */
  gzipMinLength: number;
  /** Gzip types */
  gzipTypes: string[];
  /** Rate limiting */
  rateLimitZone: string;
  /** Rate limit request count */
  rateLimitRequestCount: number;
  /** Rate limit burst */
  rateLimitBurst: number;
  /** Rate limit overflow */
  rateLimitOverflow: string;
}

/** Get default Nginx configuration. */
export function getDefaultNginxConfiguration(): NginxConfiguration {
  return {
    serverName: ['dramascan.local', 'www.dramascan.local'],
    listenPort: 443,
    sslEnabled: true,
    sslCertPath: '/etc/letsencrypt/live/dramascan.fullchain.pem',
    sslKeyPath: '/etc/letsencrypt/live/dramascan.privkey.pem',
    proxyBufferSize: '128k',
    proxyReadTimeout: '300s',
    proxySendTimeout: '300s',
    proxyConnectTimeout: '90s',
    clientBodyTimeout: '300s',
    keepaliveTimeout: '75s',
    gzip: true,
    gzipMinLength: 1024,
    gzipTypes: ['text/plain', 'text/css', 'application/json', 'application/javascript', 'application/xml', 'application/xml+rss', 'font/truetype', 'font/opentype', 'image/svg+xml', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    rateLimitZone: 'dramascan_limit',
    rateLimitRequestCount: 100,
    rateLimitBurst: 150,
    rateLimitOverflow: 'error',
  };
}

/** Get Nginx configuration from environment. */
export function getNginxConfiguration(): NginxConfiguration {
  const deployConfig = getDeploymentConfiguration();

  const certPath = deployConfig.enableHTTPS
    ? '/etc/letsencrypt/live/' + deployConfig.platform + '.fullchain.pem'
    : '';

  const keyPath = deployConfig.enableHTTPS
    ? '/etc/letsencrypt/live/' + deployConfig.platform + '.privkey.pem'
    : '';

  return {
    serverName: [deployConfig.platform + '.com', 'www.' + deployConfig.platform + '.com'],
    listenPort: 443,
    sslEnabled: deployConfig.enableHTTPS,
    sslCertPath: certPath,
    sslKeyPath: keyPath,
    proxyBufferSize: '128k',
    proxyReadTimeout: '300s',
    proxySendTimeout: '300s',
    proxyConnectTimeout: '90s',
    clientBodyTimeout: '300s',
    keepaliveTimeout: '75s',
    gzip: true,
    gzipMinLength: 1024,
    gzipTypes: [
      'text/plain',
      'text/css',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/xml+rss',
      'font/truetype',
      'font/opentype',
      'image/svg+xml',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ],
    rateLimitZone: 'dramascan_limit',
    rateLimitRequestCount: 100,
    rateLimitBurst: 150,
    rateLimitOverflow: 'error',
  };
}

/** Get nginx location block for Next.js application. */
export function getNextJsLocationBlock(): string {
  return (
    'location / {\n' +
    '  proxy_pass http://localhost:3000;\n' +
    '  proxy_http_version 1.1;\n' +
    '  proxy_set_header Upgrade $http_upgrade;\n' +
    '  proxy_set_header Connection "upgrade";\n' +
    '  proxy_set_header Host $host;\n' +
    '  proxy_cache_bypass $http_upgrade;\n' +
    '  add_header Cache-Control "no-cache";\n' +
    '}'
  );
}

/** Get nginx location block for static assets. */
export function getStaticAssetsLocationBlock(): string {
  return (
    'location ~* \\.(?:jpg|jpeg|png|gif|svg|ico|webp|webm|mp4|mov|avi|mp3|wav|pdf|txt|doc|docx|odt|xls|xlsx|ppt|pptx)$ {\n' +
    '  expires 30d;\n' +
    '  add_header Cache-Control "public, max-age=2592000";\n' +
    '  proxy_pass http://localhost:3000;\n' +
    '  access_log off;\n' +
    '}'
  );
}

/** Get nginx location block for API requests. */
export function getApiLocationBlock(): string {
  return (
    'location /api/ {\n' +
    '  proxy_pass http://localhost:3000/api/;\n' +
    '  proxy_set_header Host $host;\n' +
    '  proxy_set_header X-Real-IP $remote_addr;\n' +
    '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n' +
    '  proxy_set_header X-Forwarded-Proto $scheme;\n' +
    '  proxy_intercept_errors on;\n' +
    '}'
  );
}

/** Get nginx configuration file content. */
export function getNginxConfigContent(): string {
  const config = getDefaultNginxConfiguration();

  return (
    '# Generated Nginx Configuration\n\n' +
    'user www-data;\n\n' +
    'worker_processes auto;\n\n' +
    'pid /run/nginx.pid;\n\n' +
    'events {\n' +
    '  worker_connections 768;\n' +
    '  multi_accept on;\n' +
    '}\n\n' +
    'http {\n' +
    '  ##\n' +
    '  ## Basic Settings\n' +
    '  ##\n\n' +
    '  sendfile on;\n' +
    '  tcp_nopush on;\n' +
    '  tcp_nodelay on;\n' +
    '  keepalive_timeout '" + String(config.keepaliveTimeout) + ';\n' +
    '  types {\n' +
    '    include /etc/nginx/mime.types;\n' +
    '  }\n\n' +
    '  gzip on;\n' +
    '  gzip_disable "msie";\n' +
    '  '" + config.gzipTypes.map(t => '  gzip_' + t.replace(/\//g, '_').replace(/\./g, '')).join('\n') + '\n\n' +
    '  limit_req_zone $binary_remote_addr zone='" + config.rateLimitZone + '" rate='" + String(config.rateLimitRequestCount) + 'r/s;\n\n' +
    '  server {\n' +
    '    listen ' + String(config.listenPort) + ' ssl;\n' +
    '    server_name ' + config.serverName.join(' ') + ';\n\n' +
    '    ' + (config.sslEnabled ? 'ssl_certificate ' + config.sslCertPath + ';\n' : '') +
    '    ' + (config.sslEnabled ? 'ssl_certificate_key ' + config.sslKeyPath + ';\n' : '') + '\n\n' +
    '    ' + getNextJsLocationBlock() + '\n\n' +
    '    ' + getStaticAssetsLocationBlock() + '\n\n' +
    '    ' + getApiLocationBlock() + '\n\n' +
    '    ##\n' +
    '    ## Logging\n' +
    '    ##\n\n' +
    '    access_log /var/log/nginx/access.log;\n' +
    '    error_log /var/log/nginx/error.log;\n\n' +
    '  }\n' +
    '}\n'
  );
}