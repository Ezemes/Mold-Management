import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server actions carry uploads (documents, handover and work-order photos, assessment photos and video).
    // The default 1 MB would reject ordinary phone photos. Per-file limits are enforced in src/lib/attachments.ts.
    serverActions: { bodySizeLimit: "160mb" },
  },
};

export default nextConfig;
