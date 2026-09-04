import type { NextConfig } from "next";
// better-sqlite3 is native and mupdf ships WebAssembly; neither survives being bundled, so Next
// requires them from node_modules at runtime.
const nextConfig: NextConfig = { serverExternalPackages: ["better-sqlite3", "mupdf"] };
export default nextConfig;
