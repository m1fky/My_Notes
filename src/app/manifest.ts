import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Liquid Notes",
    short_name: "Notes",
    description: "PWA заметок с синхронизацией, оффлайном и напоминаниями.",
    start_url: "/",
    display: "standalone",
    background_color: "#091019",
    theme_color: "#091019",
    orientation: "portrait",
    lang: "ru-RU",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
