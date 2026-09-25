/* The desktop's reading code, running under Pyodide.
 *
 * py/ holds document.py, layout.py, citations.py, speech.py and annotations.py, copied from the
 * desktop repo by tools/port.sh and never edited here. document.py imports the
 * others relatively, as the package `mimick`, so that is what they are written
 * into Pyodide's file system as -- with an empty __init__.py, since the
 * desktop's own pulls in nothing the reading needs. reading.py (for the checks),
 * reader.py (for the document worker) and pages.py (for the page workers) sit
 * beside it.
 *
 * Shared by the browser and tools/check_reading.mjs, so what the check proves
 * is what the page loads.
 */
(function (root) {
  "use strict";

  // Pinned to the PyMuPDF the desktop app uses; see "PyMuPDF versions must
  // match" in the desktop handoff. Pyodide's own 1.26.3 reads text differently.
  const PYMUPDF_WHEEL = "pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl";
  // Every file tools/port.sh brings over. A file added there and forgotten
  // here leaves the workers unable to import it, and the page never gets past
  // "Starting Mimick".
  const PACKAGE = ["document.py", "layout.py", "citations.py", "speech.py",
                   "annotations.py", "convert.py", "slides.py", "notes_export.py",
                   "themes.py"];
  const HOME = "/home/pyodide";

  /* `loadPyodide` from vendor/pyodide; `readText(path)` gives the text of a
   * file relative to the repository root; `pyodideDir` is vendor/pyodide/ as a
   * path or URL. `onStep(name)`, if given, hears "python" and then "pdf" as each
   * large part is loaded, for the page's progress bar. Returns the Pyodide
   * instance with `mimick` importable. */
  async function loadReadingPython({ loadPyodide, readText, pyodideDir, onStep = () => {} }) {
    const py = await loadPyodide({ indexURL: pyodideDir });
    onStep("python");
    await py.loadPackage(pyodideDir + PYMUPDF_WHEEL);
    onStep("pdf");
    py.FS.mkdirTree(HOME + "/mimick");
    py.FS.writeFile(HOME + "/mimick/__init__.py", "");
    const sources = await Promise.all(PACKAGE.map((name) => readText("py/" + name)));
    PACKAGE.forEach((name, i) => py.FS.writeFile(`${HOME}/mimick/${name}`, sources[i]));
    for (const name of ["reading.py", "reader.py", "pages.py"]) py.FS.writeFile(`${HOME}/${name}`, await readText(name));
    py.runPython(`import sys\nif "${HOME}" not in sys.path: sys.path.insert(0, "${HOME}")`);
    return py;
  }

  const api = { PYMUPDF_WHEEL, loadReadingPython };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickPython = api;
})(typeof self !== "undefined" ? self : globalThis);
