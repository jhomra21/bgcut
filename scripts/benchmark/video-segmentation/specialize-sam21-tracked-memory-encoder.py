# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy==2.3.4",
#   "onnx==1.23.0",
#   "onnxslim==0.1.96",
# ]
# ///

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxslim
from onnx import numpy_helper

SOURCE_URL = (
    "https://huggingface.co/diffusionstudio/"
    "sam2.1-tiny-video-onnx-fp16/resolve/"
    "66673b5db39371b7dd7847f4d3bc0d4f4179b79e/"
    "onnx/memory_encoder.onnx"
)
EXPECTED_SOURCE_BYTES = 2_807_753


def freeze_input(
    model: onnx.ModelProto,
    name: str,
    value: np.ndarray,
) -> None:
    kept = [
        input_value
        for input_value in model.graph.input
        if input_value.name != name
    ]

    if len(kept) == len(model.graph.input):
        raise RuntimeError(f'ONNX input "{name}" was not found.')

    del model.graph.input[:]
    model.graph.input.extend(kept)

    model.graph.initializer.append(
        numpy_helper.from_array(
            value,
            name,
        )
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError(
            "Usage: uv run specialize-sam21-tracked-memory-encoder.py <output.onnx>"
        )

    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with urllib.request.urlopen(SOURCE_URL) as response:
        source = response.read()

    if len(source) != EXPECTED_SOURCE_BYTES:
        raise RuntimeError(
            f"Pinning check failed: memory encoder was {len(source)} bytes; "
            f"expected {EXPECTED_SOURCE_BYTES}."
        )

    model = onnx.load_model_from_string(source)

    freeze_input(
        model,
        "binarize",
        np.asarray(
            0,
            dtype=np.float32,
        ),
    )

    source_nodes = len(model.graph.node)

    model = onnxslim.slim(model)
    onnx.checker.check_model(model)
    onnx.save_model(model, output)

    print(
        json.dumps(
            {
                "sourceBytes": len(source),
                "sourceNodes": source_nodes,
                "trackedBytes": output.stat().st_size,
                "trackedNodes": len(model.graph.node),
                "inputs": [
                    value.name
                    for value in model.graph.input
                ],
                "outputs": [
                    value.name
                    for value in model.graph.output
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
