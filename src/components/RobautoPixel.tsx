"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PID = "c363139a-4644-408a-8df0-0d873f9ec641";
const ENDPOINT = "https://hkeytqaukllckucnhzey.supabase.co/functions/v1/track";

export default function RobautoPixel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const body = JSON.stringify({
      path: window.location.pathname,
      url: window.location.href,
      referer: document.referrer,
    });
    const url = `${ENDPOINT}?pid=${PID}`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, body);
    } else {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body);
    }
  }, [pathname, searchParams]);

  return null;
}
