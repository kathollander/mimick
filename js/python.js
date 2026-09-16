/* The desktop's reading code, running under Pyodide.
 *
 * py/ holds document.py, layout.py, citations.py and speech.py, copied from the
 * desktop repo by tools/port.sh and never edited here. document.py imports the
 * others relatively, as the package `mimick`, so that is what they are written
 * into Pyodide's file system as -- with an empty __init__.py, since the
 * desktop's own pulls in nothing the reading needs. reading.py (for the checks)
 * and reader.py (for the page) sit beside it.
 *
 * Shared by the browser and tools/check_reading.mjs, so what the check proves
 * is what the page loads.
 */
(function (root) {
  "use strict";

  // Pinned to the PyMuPDF the desktop app uses; see "PyMuPDF versions must
  // match" in the desktop handoff. Pyodide's own 1.26.3 reads text differently.
  const PYMUPDF_WHEEL = "pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl";
  const PACKAGE = ["document.py", "layout.py", "citations.py", "speech.py"];
  const HOME = "/home/pyodide";

  /* `loadPyodide` from vendor/pyodide; `readText(path)` gives the text of a
   * file relative to the repository root; `pyodideDir` is vendor/pyodide/ as a
   * path or URL. Returns the Pyodide instance with `mimick` importable. */
  async function loadReadingPython({ loadPyodide, readText, pyodideDir }) {
    const py = await loadPyodide({ indexURL: pyodideDir });
    await py.loadPackage(pyodideDir + PYMUPDF_WHEEL);
    py.FS.mkdirTree(HOME + "/mimick");
    py.FS.writeFile(HOME + "/mimick/__init__.py", "");
    const sources = await Promise.all(PACKAGE.map((name) => readText("py/" + name)));
    PACKAGE.forEach((name, i) => py.FS.writeFile(`${HOME}/mimick/${name}`, sources[i]));
    for (const name of ["reading.py", "reader.py"]) py.FS.writeFile(`${HOME}/${name}`, await readText(name));
    py.runPython(`import sys\nif "${HOME}" not in sys.path: sys.path.insert(0, "${HOME}")`);
    return py;
  }

  const api = { PYMUPDF_WHEEL, loadReadingPython };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MimickPython = api;
})(typeof self !== "undefined" ? self : globalThis);
