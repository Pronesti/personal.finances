import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Tarjetas", description: "Credit card statement analysis" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-5xl bg-canvas px-4 text-ink antialiased">
        <Suspense><Nav /></Suspense>
        {children}
      </body>
    </html>
  );
}
