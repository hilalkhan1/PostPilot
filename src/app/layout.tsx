import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostPilot",
  description: "Write once, publish everywhere — now or on a schedule.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
