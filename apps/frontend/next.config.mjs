/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  eslint: {
    // No bloquear el build de produccion por warnings/errores de ESLint.
    // El linting se sigue corriendo en desarrollo; aqui solo evitamos que
    // reglas de estilo (ej. comillas sin escapar) tumben el deploy.
    ignoreDuringBuilds: true,
  },
  experimental: { optimizePackageImports: ["framer-motion"] },
  async rewrites() {
    const apiUrl = process.env.API_URL || "http://127.0.0.1:4100";
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      // En local, Next sirve /uploads reenviándolo a la API. En el VPS lo
      // resuelve nginx antes de llegar a Next, así que este rewrite es inocuo en prod.
      { source: "/uploads/:path*", destination: `${apiUrl}/uploads/:path*` }
    ];
  }
};
export default nextConfig;