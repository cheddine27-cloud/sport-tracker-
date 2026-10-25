import type { Metadata } from "next";
import { Cairo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toaster } from "@/components/ui/sonner";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cairo",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "إدارة المحل الرياضي",
  description: "نظام إدارة محل المعدات الرياضية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={cn("h-full", cairo.variable, geistMono.variable, "font-sans")}>
      <body className="min-h-full flex bg-background text-foreground antialiased">
        <Sidebar />
        <main className="flex-1 me-72 px-8 py-6 min-h-screen">{children}</main>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
