# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy==2.3.4",
#   "onnx==1.23.0",
#   "onnxslim==0.1.96",
# ]
# ///

from __future__ import annotations

import copy
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxslim
from onnx import compose, helper, numpy_helper

BASE = (
    "https://huggingface.co/diffusionstudio/"
    "sam2.1-tiny-video-onnx-fp16/resolve/"
    "66673b5db39371b7dd7847f4d3bc0d4f4179b79e/onnx"
)

DECODER_URL = f"{BASE}/mask_decoder.onnx"
MEMORY_ENCODER_URL = f"{BASE}/memory_encoder.onnx"

EXPECTED_DECODER_BYTES = 8_898_805
EXPECTED_MEMORY_ENCODER_BYTES = 2_807_753


def download(url: str, expected_bytes: int) -> bytes:
    with urllib.request.urlopen(url) as response:
        data = response.read()

    if len(data) != expected_bytes:
        raise RuntimeError(
            f"Pinned artifact {url} was {len(data)} bytes; "
            f"expected {expected_bytes}."
        )

    return data


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


def output_info(
    model: onnx.ModelProto,
    name: str,
) -> onnx.ValueInfoProto:
    for value in model.graph.output:
        if value.name == name:
            return value

    raise RuntimeError(f'ONNX output "{name}" was not found.')


def keep_outputs(
    model: onnx.ModelProto,
    names: set[str],
) -> None:
    kept = [
        value
        for value in model.graph.output
        if value.name in names
    ]

    if {value.name for value in kept} != names:
        missing = names - {value.name for value in kept}
        raise RuntimeError(
            f"Missing ONNX outputs: {sorted(missing)}."
        )

    del model.graph.output[:]
    model.graph.output.extend(kept)


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError(
            "Usage: uv run specialize-sam21-tracked-step.py <output.onnx>"
        )

    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    decoder_source = download(
        DECODER_URL,
        EXPECTED_DECODER_BYTES,
    )
    memory_source = download(
        MEMORY_ENCODER_URL,
        EXPECTED_MEMORY_ENCODER_BYTES,
    )

    decoder = onnx.load_model_from_string(
        decoder_source
    )

    freeze_input(
        decoder,
        "input_points",
        np.zeros(
            (1, 1, 1, 2),
            dtype=np.float32,
        ),
    )

    freeze_input(
        decoder,
        "input_labels",
        np.full(
            (1, 1, 1),
            -1,
            dtype=np.int32,
        ),
    )

    object_score = copy.deepcopy(
        output_info(
            decoder,
            "object_score_logits",
        )
    )
    object_score.name = (
        "tracked_object_score_logits"
    )

    decoder.graph.node.append(
        helper.make_node(
            "Identity",
            ["object_score_logits"],
            [object_score.name],
            name="tracked_object_score_alias",
        )
    )
    decoder.graph.output.append(
        object_score
    )

    memory = onnx.load_model_from_string(
        memory_source
    )

    freeze_input(
        memory,
        "binarize",
        np.asarray(
            0,
            dtype=np.float32,
        ),
    )

    keep_outputs(
        memory,
        {"memory_tokens"},
    )

    memory = compose.add_prefix(
        memory,
        "memory_",
    )

    merged = compose.merge_models(
        decoder,
        memory,
        io_map=[
            (
                "high_res_mask",
                "memory_high_res_mask",
            ),
            (
                "object_score_logits",
                "memory_object_score_logits",
            ),
        ],
        name="sam21_tracked_step",
    )

    keep_outputs(
        merged,
        {
            "low_res_mask",
            "iou",
            "tracked_object_score_logits",
            "object_pointer",
            "memory_memory_tokens",
        },
    )

    source_nodes = (
        len(decoder.graph.node)
        + len(memory.graph.node)
    )

    merged = onnxslim.slim(
        merged
    )

    onnx.checker.check_model(
        merged
    )

    onnx.save_model(
        merged,
        output,
    )

    print(
        json.dumps(
            {
                "decoderSourceBytes":
                    len(decoder_source),
                "memorySourceBytes":
                    len(memory_source),
                "sourceNodes":
                    source_nodes,
                "trackedBytes":
                    output.stat().st_size,
                "trackedNodes":
                    len(merged.graph.node),
                "inputs": [
                    value.name
                    for value in merged.graph.input
                ],
                "outputs": [
                    value.name
                    for value in merged.graph.output
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
