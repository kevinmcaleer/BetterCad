/**
 * The kernel's error model (#48): every failure has a code and one line in the brand book's voice that says what is
 * wrong and what to do. The document is left as it was.
 */
export type KernelErrorCode =
  | "fillet-too-large"
  | "boolean-failed"
  | "empty-result"
  | "self-intersecting-profile"
  | "open-profile"
  | "non-manifold"
  | "reference-missing"
  | "invalid-size"
  | "kernel-crashed"
  | "cancelled"
  | "failed";

export interface KernelErrorData {
  code: KernelErrorCode;
  message: string;
  /** What OCCT said, for bug reports. */
  detail?: string;
}

export class KernelError extends Error implements KernelErrorData {
  constructor(
    readonly code: KernelErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "KernelError";
  }
  toJSON(): KernelErrorData {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

/** Plain numbers for messages: "3 mm", "0.9 mm". */
export const mm = (n: number) => `${Math.round(n * 100) / 100} mm`;

export const isKernelError = (e: unknown): e is KernelErrorData => !!e && typeof e === "object" && "code" in e && "message" in e;

/**
 * What a thrown thing that isn't a KernelError says. OCCT throws C++ exceptions, which reach JavaScript as an opaque
 * WebAssembly.Exception ("[object WebAssembly.Exception]"); `read` (the module's getExceptionMessage) gives back the
 * C++ type and its message, such as "Standard_ConstructionError: gp_Dir() - input vector has zero norm".
 */
export function describeThrown(e: unknown, read?: (e: unknown) => unknown): string {
  if (
    read &&
    typeof WebAssembly !== "undefined" &&
    "Exception" in WebAssembly &&
    e instanceof (WebAssembly as unknown as { Exception: new () => object }).Exception
  ) {
    try {
      const got = read(e);
      const [type, message] = Array.isArray(got) ? got.map(String) : [String(got), ""];
      return message && message !== type ? `${type}: ${message}` : type || "an OCCT exception";
    } catch {
      return "an OCCT exception";
    }
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** A thrown thing that isn't a KernelError, as an error the app can show: what OCCT said goes in brackets after it. */
export function unexpected(e: unknown, read?: (e: unknown) => unknown): KernelErrorData {
  const detail = describeThrown(e, read);
  // Running out of WASM memory leaves the engine unsafe to use until the page reloads.
  if (/bad_alloc|out of memory|OOM|Cannot enlarge memory|Maximum memory|Aborted/i.test(detail)) {
    return { code: "kernel-crashed", message: "The geometry engine ran out of memory. Save your model, reload the page and try again.", detail };
  }
  return { code: "failed", message: `Something went wrong in the geometry engine (${detail}).`, detail };
}
