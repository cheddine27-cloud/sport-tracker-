"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Truck,
  Wallet,
  BarChart3,
  Users,
  Settings,
  Dumbbell,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/products", label: "المنتجات", icon: Package },
  { href: "/inventory", label: "المخزون", icon: Boxes },
  { href: "/pos", label: "البيع في المحل", icon: ShoppingCart },
  { href: "/exports", label: "الصادرات", icon: Truck },
  { href: "/expenses", label: "المصاريف", icon: Wallet },
  { href: "/statistics", label: "الإحصائيات", icon: BarChart3 },
  { href: "/distributors", label: "الموزعون", icon: Users },
  { href: "/settings", label: "الإعدادات", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [lowCount, setLowCount] = useState(0);

  // Badge next to "المخزون": count of low + out-of-stock products.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { appDb } = await import("@/lib/db");
        const { getInventorySummary } = await import("@/services/stock");
        const s = await getInventorySummary(appDb);
        if (!cancelled) setLowCount(s.lowStockCount + s.outOfStockCount);
      } catch {
        /* not inside Tauri yet / db unavailable: keep badge hidden */
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pathname]);

  return (
    <aside className="fixed inset-y-0 end-0 z-50 w-72 border-s border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
      {/* App title */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-sidebar-border">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shrink-0">
          <Dumbbell className="size-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight">إدارة المحل الرياضي</h1>
          <p className="text-xs text-muted-foreground">نظام إدارة المعدات الرياضية</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  <span>{item.label}</span>
                  {item.href === "/inventory" && lowCount > 0 && (
                    <span className="ms-auto inline-flex min-w-6 h-6 px-1.5 items-center justify-center rounded-full bg-orange-500 text-white text-xs font-bold">
                      {lowCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-6 py-4">
        <p className="text-xs text-muted-foreground">يعمل دون اتصال بالإنترنت</p>
      </div>
    </aside>
  );
}
