import type { MetadataRoute } from "next";
import { getSetting } from "@/server/services/settings";

export const dynamic = "force-dynamic";

/** The installed app (Ana ekrana ekle): its name follows Ayarlar, the icon is in public/icons. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "[uygulama]";
  try {
    name = (await getSetting("profile")).appName || name;
  } catch {
    // No database yet (first setup): keep the placeholder.
  }
  return {
    id: "/",
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: "Proje çalışma alanı",
    lang: "tr",
    dir: "ltr",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Hızlı ekle", short_name: "Ekle", url: "/today?quick=1" },
      { name: "Görevler", url: "/tasks" },
      { name: "Bugün", url: "/today" },
      { name: "Ara", url: "/search" },
    ],
  };
}
