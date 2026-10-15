import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",            // plain static files; `rg serve` hosts them, no Node server needed for the UI
  trailingSlash: true,         // /approvals -> out/approvals/index.html
  images: { unoptimized: true },
  // next dev: proxy the API to `rg serve` (rewrites are ignored by the static export, which is fine: same origin there)
  ...(process.env.NODE_ENV === "development" ? { async rewrites() { return [{ source: "/api/:path*", destination: "http://127.0.0.1:4000/api/:path*" }]; } } : {}),
};
export default config;
