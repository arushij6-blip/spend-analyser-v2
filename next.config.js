/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native CommonJS dep — let Next.js leave it alone in server bundles.
  // pdf-parse wraps pdfjs-dist which has worker/asset path lookups that break when bundled.
  serverExternalPackages: ['better-sqlite3', 'googleapis', 'pdf-parse'],
};

export default nextConfig;
