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
