import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carousel Studio",
  description: "Generate and edit Instagram carousel slides with Claude.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
