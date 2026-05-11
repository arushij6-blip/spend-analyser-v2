/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native CommonJS dep — let Next.js leave it alone in server bundles.
  serverExternalPackages: ['better-sqlite3', 'googleapis'],
};

export default nextConfig;
