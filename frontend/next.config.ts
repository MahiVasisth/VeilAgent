import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The SDK is a workspace package shipped as TypeScript source.
  transpilePackages: ["@veil8004/sdk"],
  // Monorepo root, so Turbopack resolves the hoisted node_modules and the linked sdk/ workspace.
  turbopack: { root: path.resolve(process.cwd(), "..") },
};

export default config;
