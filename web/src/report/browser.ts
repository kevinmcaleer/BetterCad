/** The browser and platform, from the user agent, without the rest of it. */
export function browserName(ua = navigator.userAgent): string {
  const m = ua.match(/(Firefox|Edg|OPR|Chrome|Version)\/([\d.]+)/);
  const name = m ? (({ Edg: "Edge", OPR: "Opera", Version: "Safari" } as Record<string, string>)[m[1]!] ?? m[1]!) : "Unknown browser";
  // iPhones say "like Mac OS X" and Android says "Linux", so the specific ones go first.
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return `${name} ${m?.[2]?.split(".")[0] ?? ""}${os ? ` on ${os}` : ""}`.replace(/\s+/g, " ").trim();
}
