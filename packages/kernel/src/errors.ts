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
