import { Banner, Button } from "@bettercad/ui";
import { applyUpdate, useUpdateWaiting } from "./register";

/** "BetterCad updated" (#94): the new version waits until you choose to reload, so nothing changes mid-edit. */
export function UpdateBanner() {
  const waiting = useUpdateWaiting();
  if (!waiting) return null;
  return (
    <div className="bc bc-update">
      <Banner tone="info" action={<Button size="dense" variant="primary" label="Reload" title="Reload into the new version" onClick={applyUpdate} />}>
        BetterCad updated. Reload to use the new version; your model is autosaved first.
      </Banner>
    </div>
  );
}
