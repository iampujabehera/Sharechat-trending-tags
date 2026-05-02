import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShareChat — ट्रेंडिंग टैग्स",
  description:
    "What's trending in India today, distilled by GPT. ShareChat APM assignment.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  // viewportFit:'cover' is what unlocks env(safe-area-inset-*) on iOS.
  // Without it, the insets stay 0 and the header tucks under the notch.
  viewportFit: "cover",
  // Don't lock zoom — accessibility requires users be able to pinch-zoom.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi">
      <body>{children}</body>
    </html>
  );
}
