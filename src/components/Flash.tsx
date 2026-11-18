"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const TONE = {
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "text-emerald-600", path: "m5 12 4.5 4.5L19 7" },
  warning: { box: "border-amber-300 bg-amber-50 text-amber-900", icon: "text-amber-600", path: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
  error: { box: "border-red-200 bg-red-50 text-red-800", icon: "text-red-600", path: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
} as const;

/** Builds a URL that shows a banner after navigating: flashHref("/docs/grn", "GRN deleted"). */
export function flashHref(href: string, msg: string, tone: keyof typeof TONE = "success") {
  const u = new URL(href, "http://x");
  u.searchParams.set("msg", msg);
  if (tone !== "success") u.searchParams.set("tone", tone);
  return `${u.pathname}${u.search}`;
}

/**
 * Banner driven by `?msg=` (plus optional `?tone=` and the legacy `?err=`).
 * Closing it (or the 8s success timeout) removes the params so a refresh doesn't show it again.
 */
export function Flash() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const err = params.get("err");
  const msg = err ?? params.get("msg");
  const tone: keyof typeof TONE = err ? "warning" : ((params.get("tone") as keyof typeof TONE | null) ?? "success");
  const [hidden, setHidden] = useState<string | null>(null);

  const dismiss = () => {
    setHidden(msg);
    const next = new URLSearchParams(params);
    ["msg", "tone", "err"].forEach((k) => next.delete(k));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!msg || tone !== "success") return;
    const t = setTimeout(dismiss, 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg, tone]);

  if (!msg || hidden === msg || !(tone in TONE)) return null;
  const t = TONE[tone];
  return (
    <div role="status" className={`no-print mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-sm ${t.box}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`mt-0.5 shrink-0 ${t.icon}`} aria-hidden>
        <path d={t.path} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded px-1 opacity-60 hover:bg-black/5 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
