import { useSyncExternalStore } from "react";
import { eui, type EUi } from "./ui";

/** The electronics view state, as a hook. */
export const useEui = (): EUi => useSyncExternalStore(eui.subscribe, eui.get, eui.get);
