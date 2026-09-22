#!/usr/bin/env python3

import argparse
import re
from pathlib import Path
from typing import Any

try:
    import onnx
    from onnx import TensorProto, helper, numpy_helper, shape_inference
except ModuleNotFoundError as error:
    raise SystemExit(
        "rewrite-webgpu-shape-ops.py requires the Python package 'onnx'. "
        "Install it in the disposable benchmark environment before running this command."
    ) from error


ATROUS_SLICE_PATTERN = re.compile(r"/atrous_conv/Slice(?:_1)?$")
ATROUS_SUM_PATTERN = re.compile(r"/atrous_conv/Sum$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rewrite the repeated int64 Slice/Sum ASPP pattern that ONNX Runtime "
            "1.30 cannot place on WebGPU."
        )
    )
    parser.add_argument("input", type=Path, help="Source ONNX model.")
    parser.add_argument("output", type=Path, help="Rewritten ONNX model.")
    parser.add_argument(
        "--expected-slices",
        type=int,
        default=40,
        help="Expected number of int64 one-element Slice nodes. Default: 40.",
    )
    parser.add_argument(
        "--expected-sums",
        type=int,
        default=20,
        help="Expected number of four-input Sum nodes. Default: 20.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print matching rewrites without writing a model.",
    )
    return parser.parse_args()


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")

    return cleaned or "webgpu_shape"


def unique_name(base: str, used: set[str]) -> str:
    candidate = base
    suffix = 1

    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1

    used.add(candidate)

    return candidate


def collect_value_infos(
    model: onnx.ModelProto,
) -> dict[str, onnx.ValueInfoProto]:
    inferred = shape_inference.infer_shapes(model)
    graph = inferred.graph
    infos: dict[str, onnx.ValueInfoProto] = {}

    for value_info in [*graph.input, *graph.value_info, *graph.output]:
        infos[value_info.name] = value_info

    return infos


def tensor_type(
    value_name: str,
    value_infos: dict[str, onnx.ValueInfoProto],
) -> int:
    value_info = value_infos.get(value_name)

    if value_info is None or not value_info.type.HasField("tensor_type"):
        raise ValueError(f'No tensor type is available for "{value_name}".')

    return value_info.type.tensor_type.elem_type


def tensor_dims(
    value_name: str,
    value_infos: dict[str, onnx.ValueInfoProto],
) -> list[int | None]:
    value_info = value_infos.get(value_name)

    if value_info is None or not value_info.type.HasField("tensor_type"):
        raise ValueError(f'No tensor shape is available for "{value_name}".')

    dims: list[int | None] = []

    for dim in value_info.type.tensor_type.shape.dim:
        if dim.HasField("dim_value"):
            dims.append(dim.dim_value)
        else:
            dims.append(None)

    return dims


def collect_constants(model: onnx.ModelProto) -> dict[str, list[int]]:
    constants: dict[str, list[int]] = {}

    for initializer in model.graph.initializer:
        values = numpy_helper.to_array(initializer)

        if values.dtype.kind not in ("i", "u"):
            continue

        constants[initializer.name] = [
            int(value)
            for value in values.reshape(-1)
        ]

    for node in model.graph.node:
        if node.op_type != "Constant" or len(node.output) != 1:
            continue

        value_attribute = next(
            (attribute for attribute in node.attribute if attribute.name == "value"),
            None,
        )

        if value_attribute is None:
            continue

        tensor = helper.get_attribute_value(value_attribute)
        values = numpy_helper.to_array(tensor)

        if values.dtype.kind not in ("i", "u"):
            continue

        constants[node.output[0]] = [
            int(value)
            for value in values.reshape(-1)
        ]

    return constants


def resolve_static_input(
    node: onnx.NodeProto,
    input_index: int,
    constants: dict[str, list[int]],
    default: list[int] | None = None,
) -> list[int]:
    if input_index >= len(node.input) or not node.input[input_index]:
        if default is None:
            raise ValueError(
                f'Node "{node.name}" is missing required static input {input_index}.'
            )

        return default

    input_name = node.input[input_index]
    values = constants.get(input_name)

    if values is None:
        raise ValueError(
            f'Node "{node.name}" input {input_index} ("{input_name}") is not static.'
        )

    return values


def normalized_axis(axis: int, rank: int) -> int:
    resolved = axis + rank if axis < 0 else axis

    if resolved < 0 or resolved >= rank:
        raise ValueError(f"Axis {axis} is invalid for rank {rank}.")

    return resolved


def make_int64_initializer(
    name: str,
    values: list[int],
) -> onnx.TensorProto:
    return helper.make_tensor(
        name=name,
        data_type=TensorProto.INT64,
        dims=[len(values)],
        vals=values,
    )


def rewrite_slice(
    node: onnx.NodeProto,
    value_infos: dict[str, onnx.ValueInfoProto],
    constants: dict[str, list[int]],
    used_names: set[str],
) -> tuple[onnx.NodeProto, onnx.TensorProto, int, int]:
    if len(node.input) < 3 or len(node.output) != 1:
        raise ValueError(
            f'Expected one-output Slice with starts/ends inputs at "{node.name}".'
        )

    data_name = node.input[0]

    if tensor_type(data_name, value_infos) != TensorProto.INT64:
        raise ValueError(
            f'Expected int64 Slice data at "{node.name}".'
        )

    input_dims = tensor_dims(data_name, value_infos)
    output_dims = tensor_dims(node.output[0], value_infos)
    starts = resolve_static_input(node, 1, constants)
    ends = resolve_static_input(node, 2, constants)
    axes = resolve_static_input(
        node,
        3,
        constants,
        list(range(len(starts))),
    )
    steps = resolve_static_input(
        node,
        4,
        constants,
        [1] * len(starts),
    )

    if not (
        len(starts)
        == len(ends)
        == len(axes)
        == len(steps)
        == 1
    ):
        raise ValueError(
            f'Expected a single-axis Slice at "{node.name}".'
        )

    rank = len(input_dims)
    axis = normalized_axis(axes[0], rank)
    start = starts[0]
    step = steps[0]

    if axis != 3:
        raise ValueError(
            f'Expected axis 3 Slice at "{node.name}", found axis {axis}.'
        )

    if step != 1:
        raise ValueError(
            f'Expected step 1 Slice at "{node.name}", found {step}.'
        )

    if len(output_dims) != rank or output_dims[axis] != 1:
        raise ValueError(
            f'Expected one-element Slice output at "{node.name}", '
            f"found shape {output_dims}."
        )

    prefix = safe_name(node.name)
    indices_name = unique_name(
        f"{prefix}__gather_indices",
        used_names,
    )
    gather_name = unique_name(
        f"{prefix}__webgpu_gather",
        used_names,
    )
    indices = make_int64_initializer(indices_name, [start])
    gather = helper.make_node(
        "Gather",
        inputs=[data_name, indices_name],
        outputs=list(node.output),
        name=gather_name,
        axis=axis,
    )

    return gather, indices, axis, start


def rewrite_sum(
    node: onnx.NodeProto,
    value_infos: dict[str, onnx.ValueInfoProto],
    used_names: set[str],
) -> list[onnx.NodeProto]:
    if len(node.input) != 4 or len(node.output) != 1:
        raise ValueError(
            f'Expected four-input, one-output Sum at "{node.name}".'
        )

    output_dims = tensor_dims(node.output[0], value_infos)

    for input_name in node.input:
        if tensor_dims(input_name, value_infos) != output_dims:
            raise ValueError(
                f'Sum "{node.name}" input "{input_name}" does not match '
                f"output shape {output_dims}."
            )

    prefix = safe_name(node.name)
    first_output = unique_name(
        f"{prefix}__add_0_output",
        used_names,
    )
    second_output = unique_name(
        f"{prefix}__add_1_output",
        used_names,
    )

    return [
        helper.make_node(
            "Add",
            inputs=[node.input[0], node.input[1]],
            outputs=[first_output],
            name=unique_name(f"{prefix}__add_0", used_names),
        ),
        helper.make_node(
            "Add",
            inputs=[first_output, node.input[2]],
            outputs=[second_output],
            name=unique_name(f"{prefix}__add_1", used_names),
        ),
        helper.make_node(
            "Add",
            inputs=[second_output, node.input[3]],
            outputs=list(node.output),
            name=unique_name(f"{prefix}__add_2", used_names),
        ),
    ]


def main() -> None:
    args = parse_args()
    model = onnx.load_model(args.input, load_external_data=True)
    value_infos = collect_value_infos(model)
    constants = collect_constants(model)
    used_names = {
        initializer.name
        for initializer in model.graph.initializer
    }

    for node in model.graph.node:
        if node.name:
            used_names.add(node.name)

        used_names.update(
            output
            for output in node.output
            if output
        )

    replacements: dict[
        int,
        tuple[list[onnx.NodeProto], list[onnx.TensorProto]],
    ] = {}
    slice_count = 0
    sum_count = 0

    for node_index, node in enumerate(model.graph.node):
        if node.op_type == "Slice" and ATROUS_SLICE_PATTERN.search(node.name):
            gather, indices, axis, start = rewrite_slice(
                node,
                value_infos,
                constants,
                used_names,
            )
            replacements[node_index] = ([gather], [indices])
            slice_count += 1
            print(
                f"Rewrite {node.name}: int64 Slice -> Gather "
                f"(axis {axis}, index {start})"
            )
            continue

        if node.op_type == "Sum" and ATROUS_SUM_PATTERN.search(node.name):
            adds = rewrite_sum(
                node,
                value_infos,
                used_names,
            )
            replacements[node_index] = (adds, [])
            sum_count += 1
            print(
                f"Rewrite {node.name}: four-input Sum -> three chained Add nodes"
            )

    if slice_count != args.expected_slices:
        raise ValueError(
            f"Expected {args.expected_slices} ASPP Slice rewrites, "
            f"found {slice_count}."
        )

    if sum_count != args.expected_sums:
        raise ValueError(
            f"Expected {args.expected_sums} ASPP Sum rewrites, "
            f"found {sum_count}."
        )

    print(
        f"Matched {slice_count} int64 Slice nodes and "
        f"{sum_count} four-input Sum nodes."
    )

    if args.dry_run:
        return

    rewritten_nodes: list[onnx.NodeProto] = []
    new_initializers: list[onnx.TensorProto] = []

    for node_index, node in enumerate(model.graph.node):
        replacement = replacements.get(node_index)

        if replacement is None:
            rewritten_nodes.append(node)
            continue

        nodes, initializers = replacement
        rewritten_nodes.extend(nodes)
        new_initializers.extend(initializers)

    del model.graph.node[:]
    model.graph.node.extend(rewritten_nodes)
    model.graph.initializer.extend(new_initializers)

    metadata = model.metadata_props.add()
    metadata.key = "bgcut.webgpu.shape_rewrite"
    metadata.value = (
        f"slice-to-gather={slice_count};"
        f"sum-to-add={sum_count}"
    )

    onnx.checker.check_model(model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(model, args.output)

    print(
        f"Wrote {args.output} with {slice_count} Slice -> Gather rewrites "
        f"and {sum_count} Sum -> Add rewrites."
    )


if __name__ == "__main__":
    main()
