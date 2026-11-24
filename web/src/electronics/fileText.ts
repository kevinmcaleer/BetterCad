/** A file's text. Older browsers have no `File.text`. */
export const textOf = (f: Blob): Promise<string> =>
  typeof f.text === "function"
    ? f.text()
    : new Promise((done, fail) => {
        const r = new FileReader();
        r.onload = () => done(String(r.result));
        r.onerror = () => fail(r.error ?? new Error("The file could not be read"));
        r.readAsText(f);
      });

/** A file's bytes. Older browsers have no `File.arrayBuffer`. */
export const bytesOf = (f: Blob): Promise<Uint8Array> =>
  typeof f.arrayBuffer === "function"
    ? f.arrayBuffer().then((b) => new Uint8Array(b))
    : new Promise((done, fail) => {
        const r = new FileReader();
        r.onload = () => done(new Uint8Array(r.result as ArrayBuffer));
        r.onerror = () => fail(r.error ?? new Error("The file could not be read"));
        r.readAsArrayBuffer(f);
      });
