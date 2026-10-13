import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetTrace — AI Meeting Intelligence",
  description:
    "Turn unstructured meeting text into traceable decisions, actions and evidence — running 100% locally with Ollama.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
