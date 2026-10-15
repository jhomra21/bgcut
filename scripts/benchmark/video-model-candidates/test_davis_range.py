"""No-network tests for original DAVIS indexed-mask byte-range ZIP extraction."""

from __future__ import annotations

import importlib.util
import io
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("prepare-davis-indexed-annotations.py")
spec = importlib.util.spec_from_file_location("davis_range", MODULE_PATH)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ZipServer(BaseHTTPRequestHandler):
    content = b""
    honor_ranges = True

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.content)))
        self.end_headers()

    def do_GET(self):
        interval = self.headers.get("Range", "")
        if not self.honor_ranges or not interval.startswith("bytes="):
            self.send_response(200)
            self.send_header("Content-Length", str(len(self.content)))
            self.end_headers()
            self.wfile.write(self.content)
            return

        start, end = map(int, interval[len("bytes="):].split("-"))
        part = self.content[start:end + 1]
        self.send_response(206)
        self.send_header("Content-Length", str(len(part)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{len(self.content)}")
        self.end_headers()
        self.wfile.write(part)

    def log_message(self, *args):
        return


class RangeZipTests(unittest.TestCase):
    def setUp(self) -> None:
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("DAVIS/Annotations/480p/cows/00000.png", b"\x89PNG\r\n\x1a\nFIRST")
            zf.writestr("DAVIS/Annotations/480p/cows/00001.png", b"\x89PNG\r\n\x1a\nSECOND")
            zf.writestr("DAVIS/Annotations/480p/judo/00000.png", b"\x89PNG\r\n\x1a\nTHIRD")

        self.server_type = type("TestZipServer", (ZipServer,), {
            "content": content.getvalue(),
            "honor_ranges": True,
        })
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.server_type)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/archive.zip"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def test_extracts_indexed_pngs_and_verifies_crc(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            report = module.extract(self.url, Path(directory), ["cows"], 2)
            self.assertEqual(len(report["masks"]), 2)
            self.assertEqual(
                (Path(directory) / "cows" / "00001.png").read_bytes(),
                b"\x89PNG\r\n\x1a\nSECOND",
            )
            self.assertEqual(report["archiveBytes"], len(self.server_type.content))
            self.assertTrue((Path(directory) / "manifest.json").exists())

    def test_refuses_server_that_ignores_http_ranges(self) -> None:
        self.server_type.honor_ranges = False
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "range support"):
                module.extract(self.url, Path(directory), ["cows"], 1)

    def test_rejects_missing_masks_and_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(KeyError):
                module.extract(self.url, Path(directory), ["nonexistent"], 1)
            with self.assertRaises(ValueError):
                module.extract(self.url, Path(directory), ["../evil"], 1)


if __name__ == "__main__":
    unittest.main()
