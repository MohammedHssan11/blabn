"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/** Navigation links in the current language. Receives plain strings only; it does no calculation. */
export function MainNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label={label}>
      {items.map((item) => {
        const active = pathname === item.href || (item.href.split("/").length > 2 && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
