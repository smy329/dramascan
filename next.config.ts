import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the project's authoritative AGENTS.md free of generated content.
  agentRules: false,
};

export default nextConfig;
