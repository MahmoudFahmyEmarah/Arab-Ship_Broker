import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.101"],
  // the stored Fixture recap PDF (lib/fixture-room/pdf-unicode.ts): HarfBuzz is an ES module that loads its own
  // WebAssembly, so it stays an external server package; the embedded fonts are read from disk at run time, so the
  // server functions that render the recap must carry them (and the .wasm) in their traced output.
  serverExternalPackages: ["harfbuzzjs"],
  outputFileTracingIncludes: {
    "/dashboard/fixture-room/**": ["./assets/fonts/**", "./node_modules/harfbuzzjs/dist/*.wasm"],
  },
};

export default nextConfig;
