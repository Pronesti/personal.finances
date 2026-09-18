import type { NextConfig } from "next";
// better-sqlite3 is native and mupdf ships WebAssembly; neither survives being bundled, so Next
// requires them from node_modules at runtime.
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "mupdf"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "web.test", "gastos.test"],
};
export default nextConfig;
