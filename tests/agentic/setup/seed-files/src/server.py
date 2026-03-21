"""Simple HTTP server with routing and middleware support."""

from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Callable, Dict, List, Tuple
import json
import time


class Router:
    def __init__(self):
        self.routes: Dict[str, Dict[str, Callable]] = {}

    def add_route(self, method: str, path: str, handler: Callable):
        if path not in self.routes:
            self.routes[path] = {}
        self.routes[path][method.upper()] = handler

    def resolve(self, method: str, path: str) -> Callable | None:
        route = self.routes.get(path)
        if route is None:
            return None
        return route.get(method.upper())


router = Router()


def handle_health(request) -> dict:
    return {"status": "ok", "uptime": time.time()}


def handle_version(request) -> dict:
    return {"version": "1.0.0", "python": "3.12"}


router.add_route("GET", "/health", handle_health)
router.add_route("GET", "/version", handle_version)


if __name__ == "__main__":
    print("Starting server on port 8080...")
    server = HTTPServer(("127.0.0.1", 8080), BaseHTTPRequestHandler)
    server.serve_forever()
