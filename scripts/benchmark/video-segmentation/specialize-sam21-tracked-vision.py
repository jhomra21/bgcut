# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "onnx==1.23.0",
#   "onnxslim==0.1.96",
# ]
# ///

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import onnx
import onnxslim

SOURCE_URL = (
    "https://huggingface.co/diffusionstudio/"
    "sam2.1-tiny-video-onnx-fp16/resolve/"
    "66673b5db39371b7dd7847f4d3bc0d4f4179b79e/"
    "onnx/vision_encoder.onnx"
)

EXPECTED_SOURCE_BYTES = 58_385_353
TRACKING_OUTPUTS = {"feats0", "feats1", "feats2"}


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError(
            "Usage: uv run specialize-sam21-tracked-vision.py <output.onnx>"
        )

    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with urllib.request.urlopen(SOURCE_URL) as response:
        source = response.read()

    if len(source) != EXPECTED_SOURCE_BYTES:
        raise RuntimeError(
            f"Pinned SAM vision encoder was {len(source)} bytes; "
            f"expected {EXPECTED_SOURCE_BYTES}."
        )

    model = onnx.load_model_from_string(source)
    source_nodes = len(model.graph.node)

    kept = [
        value
        for value in model.graph.output
        if value.name in TRACKING_OUTPUTS
    ]

    if {value.name for value in kept} != TRACKING_OUTPUTS:
        raise RuntimeError(
            "SAM vision encoder does not expose the expected tracked features."
        )

    del model.graph.output[:]
    model.graph.output.extend(kept)

    model = onnxslim.slim(model)

    if {value.name for value in model.graph.output} != TRACKING_OUTPUTS:
        raise RuntimeError(
            "SAM tracked vision graph lost a required output during slimming."
        )

    onnx.checker.check_model(model)
    onnx.save_model(model, output)

    print(
        json.dumps(
            {
                "sourceBytes": len(source),
                "sourceNodes": source_nodes,
                "trackedBytes": output.stat().st_size,
                "trackedNodes": len(model.graph.node),
                "inputs": [value.name for value in model.graph.input],
                "outputs": [value.name for value in model.graph.output],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
