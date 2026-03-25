import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Point Turbopack at this app folder so it does not walk up to unrelated
    // lockfiles outside the project and fail the build on Windows permissions.
    root: path.join(__dirname),
  },
};

export default nextConfig;
