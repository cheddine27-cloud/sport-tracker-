import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "إدارة المحل الرياضي (Sports Store)",
  description: "نظام إدارة محل المعدات والألبسة الرياضية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark h-full font-sans">
      <body className="min-h-full flex bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
        <Sidebar />
        <main className="flex-1 me-72 px-8 py-6 min-h-screen overflow-x-hidden">{children}</main>
        <Toaster position="top-center" richColors closeButton theme="dark" />
      </body>
    </html>
  );
}
