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
  { href: "/", label: "لوحة التحكم", sub: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "نقطة البيع", sub: "POS", icon: ShoppingCart },
  { href: "/products", label: "المنتجات", sub: "Products", icon: Package },
  { href: "/inventory", label: "المخزون", sub: "Inventory", icon: Boxes },
  { href: "/exports", label: "الصادرات والطلبات", sub: "Orders", icon: Truck },
  { href: "/expenses", label: "المصاريف والأرباح", sub: "Expenses", icon: Wallet },
  { href: "/statistics", label: "التقارير والإحصائيات", sub: "Reports", icon: BarChart3 },
  { href: "/distributors", label: "الموزعون والموردون", sub: "Suppliers", icon: Users },
  { href: "/settings", label: "الإعدادات والنسخ", sub: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const lowCount = 3;

  return (
    <aside className="fixed inset-y-0 end-0 z-50 w-72 border-s border-border bg-sidebar/95 backdrop-blur-md text-sidebar-foreground flex flex-col shadow-2xl">
      {/* Top Window Controls / Brand Decor */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded-full bg-red-500/80" />
          <div className="size-3 rounded-full bg-amber-500/80" />
          <div className="size-3 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/50">PRO EDITION</span>
      </div>

      {/* App title */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50">
        <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 font-bold shadow-lg shadow-emerald-500/20 shrink-0">
          <Dumbbell className="size-6 stroke-[2.2]" />
        </div>
        <div>
          <h1 className="text-base font-bold leading-tight tracking-wide text-foreground">المتجر الرياضي</h1>
          <p className="text-xs text-emerald-400/90 font-medium">Sports Store OS</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 border",
                isActive
                  ? "bg-gradient-to-r from-emerald-500/15 to-teal-500/10 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-950"
                  : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "p-1.5 rounded-lg transition-colors",
                    isActive ? "bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/30" : "bg-muted/60 text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold leading-tight">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground/70 font-mono">{item.sub}</div>
                </div>
              </div>

              {item.href === "/inventory" && lowCount > 0 && (
                <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-[10px] font-bold">
                  {lowCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/50 p-4 bg-muted/20">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            نظام غير متصل
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/60">v1.2.0</span>
        </div>
      </div>
    </aside>
  );
}
