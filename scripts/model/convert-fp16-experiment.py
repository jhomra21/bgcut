from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto
from onnxruntime.transformers.float16 import convert_float_to_float16

SOURCE_SHA256 = "4461109672dda07a054892aef076b5fcc5fc40bbc91f51a357a7593c7f45ad9c"
SOURCE_SIZE_BYTES = 195_872_736


def fingerprint(path: Path) -> tuple[int, str]:
    hasher = hashlib.sha256()

    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)

    return path.stat().st_size, hasher.hexdigest()


def tensor_type(value_info: onnx.ValueInfoProto) -> int:
    return value_info.type.tensor_type.elem_type


def operator_counts(model: onnx.ModelProto) -> dict[str, int]:
    return dict(sorted(Counter(node.op_type for node in model.graph.node).items()))


def initializer_counts(model: onnx.ModelProto) -> dict[str, int]:
    names = {
        TensorProto.FLOAT: "float32",
        TensorProto.FLOAT16: "float16",
        TensorProto.INT64: "int64",
        TensorProto.INT32: "int32",
        TensorProto.BOOL: "bool",
    }

    counts = Counter(
        names.get(initializer.data_type, str(initializer.data_type))
        for initializer in model.graph.initializer
    )

    return dict(sorted(counts.items()))


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-values))


def run_cpu(model_path: Path, sample: np.ndarray) -> np.ndarray:
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL

    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )

    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    return session.run([output_name], {input_name: sample})[0]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert the validated bgcut production graph to internal FP16 while preserving FP32 model I/O."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()

    source_size, source_sha = fingerprint(args.source)

    if source_size != SOURCE_SIZE_BYTES or source_sha != SOURCE_SHA256:
        raise RuntimeError(
            "Source model fingerprint does not match the validated production artifact: "
            f"{source_size} bytes, SHA-256 {source_sha}."
        )

    source_model = onnx.load_model(args.source, load_external_data=True)

    if len(source_model.graph.input) != 1 or len(source_model.graph.output) != 1:
        raise RuntimeError("Expected exactly one model input and one model output.")

    if tensor_type(source_model.graph.input[0]) != TensorProto.FLOAT:
        raise RuntimeError("Production model input is not FLOAT.")

    if tensor_type(source_model.graph.output[0]) != TensorProto.FLOAT:
        raise RuntimeError("Production model output is not FLOAT.")

    converted = convert_float_to_float16(
        source_model,
        keep_io_types=True,
        disable_shape_infer=False,
    )

    onnx.checker.check_model(converted)

    if tensor_type(converted.graph.input[0]) != TensorProto.FLOAT:
        raise RuntimeError("FP16 candidate changed the public input away from FLOAT.")

    if tensor_type(converted.graph.output[0]) != TensorProto.FLOAT:
        raise RuntimeError("FP16 candidate changed the public output away from FLOAT.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(converted, args.output)

    candidate_size, candidate_sha = fingerprint(args.output)

    rng = np.random.default_rng(0)
    sample = rng.standard_normal((1, 3, 512, 512), dtype=np.float32)

    source_output = run_cpu(args.source, sample)
    candidate_output = run_cpu(args.output, sample)

    if source_output.shape != candidate_output.shape:
        raise RuntimeError(
            f"Output shape changed from {source_output.shape} to {candidate_output.shape}."
        )

    absolute = np.abs(
        source_output.astype(np.float64) - candidate_output.astype(np.float64)
    )

    sigmoid_absolute = np.abs(
        sigmoid(source_output.astype(np.float64))
        - sigmoid(candidate_output.astype(np.float64))
    )

    report = {
        "schemaVersion": 1,
        "source": {
            "sizeBytes": source_size,
            "sha256": source_sha,
            "operatorCounts": operator_counts(source_model),
            "initializerTypes": initializer_counts(source_model),
        },
        "candidate": {
            "sizeBytes": candidate_size,
            "sha256": candidate_sha,
            "operatorCounts": operator_counts(converted),
            "initializerTypes": initializer_counts(converted),
            "inputType": "float32",
            "outputType": "float32",
        },
        "deterministicCpuComparison": {
            "values": int(absolute.size),
            "maxAbsoluteLogitDifference": float(absolute.max()),
            "meanAbsoluteLogitDifference": float(absolute.mean()),
            "maxAbsoluteSigmoidDifference": float(sigmoid_absolute.max()),
            "meanAbsoluteSigmoidDifference": float(sigmoid_absolute.mean()),
        },
        "toolchain": {
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "converter": "onnxruntime.transformers.float16.convert_float_to_float16",
            "keepIoTypes": True,
            "disableShapeInfer": False,
        },
    }

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
