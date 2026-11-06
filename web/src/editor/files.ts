import { parseDoc, type ModelDoc } from "../state/document";

/** Downloads the model as a .bettercad.json file. (Proper files, STL and 3MF arrive with epic #8.) */
export function saveToDisk(doc: ModelDoc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name.replace(/[^\w\- ]+/g, "").trim() || "model"}.bettercad.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks for a file and parses it. Resolves undefined if the person cancels. */
export function openFromDisk(): Promise<ModelDoc | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      try {
        resolve(parseDoc(await file.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
