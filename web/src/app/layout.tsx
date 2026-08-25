import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Tarjetas", description: "Credit card statement analysis" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="max-w-5xl mx-auto px-4 antialiased">
        <Suspense><Nav /></Suspense>
        {children}
      </body>
    </html>
  );
}
