/** @type {import('next').NextConfig} */
const nextConfig = {
  // serverExternalPackages replaces experimental.serverComponentsExternalPackages in Next 14.2+
  serverExternalPackages: ['@anthropic-ai/sdk'],
}

module.exports = nextConfig
