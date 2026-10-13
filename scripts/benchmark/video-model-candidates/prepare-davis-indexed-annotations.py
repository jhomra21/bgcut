#!/usr/bin/env python3
"""Fetch official DAVIS 2017 indexed masks from a ZIP using HTTP byte ranges.

The full DAVIS trainval archive is hundreds of MB. Refuse origins without
206 Partial Content instead of accidentally downloading that entire archive.
The original data is non-commercial research material, not application assets.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

OFFICIAL_ARCHIVE = (
    "https://data.vision.ee.ethz.ch/csergi/share/davis/"
    "DAVIS-2017-trainval-480p.zip"
)
CHUNK = 1 << 20
MAX_TRANSFER = 2 << 20


class HttpRangeFile(io.RawIOBase):
    def __init__(self, url: str) -> None:
        self.url = url
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=45) as response:
            length = response.headers.get("Content-Length")
            if length is None or not length.isdecimal():
                raise RuntimeError("DAVIS archive did not provide Content-Length.")
            self.size = int(length)

        self.position = 0
        self.blocks: dict[int, bytes] = {}
        # Verify the remote supports ranges before any large transfer.
        self._block(0)

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            new_position = offset
        elif whence == io.SEEK_CUR:
            new_position = self.position + offset
        elif whence == io.SEEK_END:
            new_position = self.size + offset
        else:
            raise ValueError(f"Unsupported seek origin {whence}.")
        if new_position < 0:
            raise ValueError("Cannot seek before the archive start.")
        self.position = new_position
        return new_position

    def _block(self, number: int) -> bytes:
        existing = self.blocks.get(number)
        if existing is not None:
            return existing

        first = number * CHUNK
        if first >= self.size:
            return b""
        last = min(first + CHUNK, self.size) - 1
        request = urllib.request.Request(
            self.url, headers={"Range": f"bytes={first}-{last}"}
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            status = response.status
            content_range = response.headers.get("Content-Range", "")
            expected = f"bytes {first}-{last}/{self.size}"
            # Inspect headers *before* reading a possible 800 MB 200 OK body.
            if status != 206 or content_range != expected:
                raise RuntimeError(
                    "DAVIS source lacks safe byte-range support: "
                    f"status={status}, Content-Range={content_range!r}, "
                    f"expected={expected!r}."
                )
            data = response.read((last - first + 1) + 1)

        if len(data) != last - first + 1:
            raise RuntimeError("DAVIS source returned truncated or oversized range.")
        self.blocks[number] = data
        return data

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = self.size - self.position
        if size > MAX_TRANSFER:
            raise RuntimeError("Oversized ZIP read; only small annotations are allowed.")
        size = min(size, max(0, self.size - self.position))
        output = bytearray()
        while size > 0:
            block = self.position // CHUNK
            offset = self.position % CHUNK
            data = self._block(block)
            chunk = data[offset:offset + size]
            if not chunk:
                raise RuntimeError("Could not read a DAVIS ZIP byte range.")
            output.extend(chunk)
            self.position += len(chunk)
            size -= len(chunk)
        return bytes(output)


def extract(url: str, output: Path, sequences: list[str], frames: int) -> dict:
    if not sequences or frames < 1 or frames > 24:
        raise ValueError("Specify at least one sequence and 1–24 frames.")
    if any(not re.fullmatch(r"[a-z][a-z0-9-]*", name) for name in sequences):
        raise ValueError("Invalid DAVIS sequence name.")

    source = HttpRangeFile(url)
    rows = []
    with zipfile.ZipFile(source) as archive:
        for sequence in sequences:
            for index in range(frames):
                member = f"DAVIS/Annotations/480p/{sequence}/{index:05d}.png"
                info = archive.getinfo(member)
                if info.file_size > MAX_TRANSFER:
                    raise RuntimeError(f"Oversized DAVIS annotation: {member}.")
                # ZipFile.open validates each PNG's CRC32.
                with archive.open(info) as file:
                    png = file.read(MAX_TRANSFER + 1)
                if len(png) != info.file_size or not png.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise RuntimeError(f"Invalid original DAVIS indexed PNG: {member}.")
                destination = output / sequence / f"{index:05d}.png"
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(png)
                rows.append({
                    "sequence": sequence,
                    "frame": index,
                    "bytes": len(png),
                    "sha256": hashlib.sha256(png).hexdigest(),
                })
    report = {
        "archive": url,
        "archiveBytes": source.size,
        "rangeBlocks": len(source.blocks),
        "rangeBytesFetched": sum(len(block) for block in source.blocks.values()),
        "masks": rows,
    }
    (output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", default=OFFICIAL_ARCHIVE)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sequences", nargs="+", required=True)
    parser.add_argument("--frames", type=int, default=12)
    args = parser.parse_args()
    report = extract(args.archive, args.output, args.sequences, args.frames)
    print(json.dumps({
        "archiveBytes": report["archiveBytes"],
        "rangeBytesFetched": report["rangeBytesFetched"],
        "masks": len(report["masks"]),
    }, indent=2))


if __name__ == "__main__":
    main()
