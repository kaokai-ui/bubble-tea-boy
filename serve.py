# Static server for the tea prototype: UTF-8 charset on text files and no caching (phones keep old copies otherwise).
import http.server, functools, sys
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".cjs": "text/javascript; charset=utf-8"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
http.server.ThreadingHTTPServer(("0.0.0.0", 8090), functools.partial(H, directory=sys.argv[1])).serve_forever()