import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DMS",
  description: "Distribution Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full font-sans">
        <Suspense fallback={<aside className="w-60 shrink-0 bg-slate-900" />}>
          <Sidebar />
        </Suspense>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-8">{children}</main>
      </body>
    </html>
  );
}
