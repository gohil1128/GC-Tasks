import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";

/*
  The web app manifest. Besides "Add to Home Screen" niceness, this is
  what lets iPhone offer Web Push at all: iOS only delivers pushes to
  web apps installed to the Home Screen, which needs a manifest whose
  display is standalone.
*/
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: "The God's Chai team board — what everyone is working on.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4efe7",
    theme_color: "#f4efe7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
