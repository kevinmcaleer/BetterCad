import { Suspense, lazy, useEffect, useRef } from "react";
import { kernelStatus } from "@bettercad/kernel";
import { solverStatus } from "@bettercad/sketch";
import { Editor } from "./editor/Editor";
import { AccountProvider, useAccount } from "./cloud/account";
import { useRoute, type Route } from "./cloud/route";
import { useTheme } from "./state/useTheme";
import type { ThemeSetting } from "./state/theme";
import { UpdateBanner } from "./pwa/UpdateBanner";

/** The component gallery ships in development and in preview builds (VITE_GALLERY=1), never in the release image. */
export const GALLERY_ON = !!(import.meta.env.DEV || import.meta.env.VITE_GALLERY);
const Gallery = GALLERY_ON ? lazy(() => import("./gallery/Gallery").then((m) => ({ default: m.Gallery }))) : null;

// The account pages and the library load in their own chunk (#97), so the editor's first paint doesn't wait for them.
const pages = () => import("./pages/lazy");
const SignInPage = lazy(() => pages().then((m) => ({ default: m.SignInPage })));
const SignUpPage = lazy(() => pages().then((m) => ({ default: m.SignUpPage })));
const AccountPage = lazy(() => pages().then((m) => ({ default: m.AccountPage })));
const Library = lazy(() => pages().then((m) => ({ default: m.Library })));

// Proves the workspace packages resolve; the kernel and solver arrive in epics #4 and #5.
export const ENGINES = [kernelStatus(), solverStatus()];

const THEMES: readonly string[] = ["system", "light", "dark", "holodeck"];

/** The theme follows the account (#88): its choice applies on sign-in, and a change is saved to it. */
function ThemeSync() {
  const { api, account, setAccount } = useAccount();
  const { theme, setTheme } = useTheme();
  const synced = useRef<number | null>(null);
  useEffect(() => {
    if (!account) {
      synced.current = null;
      return;
    }
    if (synced.current !== account.id) {
      synced.current = account.id;
      if (account.theme && THEMES.includes(account.theme)) {
        if (account.theme !== theme) setTheme(account.theme as ThemeSetting);
        return;
      }
    }
    if (account.theme !== theme) api.updateMe({ theme }).then(setAccount, () => undefined);
  }, [account, theme, api, setAccount, setTheme]);
  return null;
}

function page(route: Route) {
  switch (route.page) {
    case "signin":
      return <SignInPage next={route.next} />;
    case "signup":
      return <SignUpPage next={route.next} />;
    case "account":
      return <AccountPage />;
    case "library":
      return <Library bin={route.bin} />;
    default:
      return null;
  }
}

/**
 * Hash routes keep the app working from any static host: "#/" is the editor, "#/edit/<id>" a saved model, and the
 * account pages sit over it. The editor stays mounted under a page, so nothing open is lost going to the library.
 */
export function App() {
  const route = useRoute();
  if (Gallery && route.page === "gallery") {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  const over = page(route);
  return (
    <AccountProvider>
      <ThemeSync />
      <UpdateBanner />
      <Suspense fallback={null}>{over}</Suspense>
      <div className="bc-editor-host" style={over ? { display: "none" } : undefined}>
        <Editor active={!over} model={route.page === "editor" ? route.model : undefined} share={route.page === "view" ? route.token : undefined} />
      </div>
    </AccountProvider>
  );
}
