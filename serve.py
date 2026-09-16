"""Serve this folder for testing: python3 serve.py [port], default 8731.

`python3 -m http.server` sends no caching headers, so Chrome guesses, and kept
running scripts from before an edit -- even after Ctrl+Shift+R, because
coi-serviceworker.js reloads the page once more as it starts. This asks the
browser to check every file each time.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
handler = partial(NoCache, directory=str(Path(__file__).parent))
print(f"http://localhost:{port}/reader.html")
ThreadingHTTPServer(("", port), handler).serve_forever()
