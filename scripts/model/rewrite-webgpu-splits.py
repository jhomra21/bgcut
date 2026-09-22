#!/usr/bin/env python3

import argparse
import re
from pathlib import Path

try:
    import onnx
    from onnx import TensorProto, helper, shape_inference
except ModuleNotFoundError as error:
    raise SystemExit(
        "rewrite-webgpu-splits.py requires the Python package 'onnx'. "
        "Install it in the disposable benchmark environment before running this command."
    ) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Rewrite ONNX Split nodes that exceed a WebGPU storage-buffer limit "
            "into equivalent Slice nodes."
        )
    )
    parser.add_argument("input", type=Path, help="Source ONNX model.")
    parser.add_argument("output", type=Path, help="Rewritten ONNX model.")
    parser.add_argument(
        "--max-storage-buffers-per-stage",
        type=int,
        default=10,
        help=(
            "Device storage-buffer limit. Split binds one input plus one buffer "
            "per non-empty output. Default: 10."
        ),
    )
    parser.add_argument(
        "--node",
        action="append",
        default=[],
        help=(
            "Rewrite only this Split node name. Repeat for more than one node. "
            "Without --node, every Split that exceeds the limit is rewritten."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print matching rewrites without writing a model.",
    )
    return parser.parse_args()


def onnx_opset(model: onnx.ModelProto) -> int:
    for opset in model.opset_import:
        if opset.domain in ("", "ai.onnx"):
            return opset.version

    raise ValueError("The model has no ai.onnx opset import.")


def tensor_rank_and_dims(
    value_name: str,
    value_infos: dict[str, onnx.ValueInfoProto],
) -> tuple[int, list[int | None]]:
    value_info = value_infos.get(value_name)

    if value_info is None or not value_info.type.HasField("tensor_type"):
        raise ValueError(f'No tensor shape is available for "{value_name}".')

    shape = value_info.type.tensor_type.shape
    dims: list[int | None] = []

    for dim in shape.dim:
        if dim.HasField("dim_value"):
            dims.append(dim.dim_value)
        else:
            dims.append(None)

    return len(dims), dims


def normalized_axis(axis: int, rank: int) -> int:
    resolved = axis + rank if axis < 0 else axis

    if resolved < 0 or resolved >= rank:
        raise ValueError(f"Split axis {axis} is invalid for rank {rank}.")

    return resolved


def static_output_sizes(
    node: onnx.NodeProto,
    axis: int,
    value_infos: dict[str, onnx.ValueInfoProto],
) -> list[int]:
    sizes: list[int] = []

    for output in node.output:
        _, dims = tensor_rank_and_dims(output, value_infos)
        size = dims[axis]

        if size is None:
            raise ValueError(
                f'Split node "{node.name}" has a dynamic output dimension for "{output}".'
            )

        sizes.append(size)

    return sizes


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")

    return cleaned or "split"


def unique_name(base: str, used: set[str]) -> str:
    candidate = base
    suffix = 1

    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1

    used.add(candidate)

    return candidate


def make_int64_initializer(name: str, values: list[int]) -> onnx.TensorProto:
    return helper.make_tensor(
        name=name,
        data_type=TensorProto.INT64,
        dims=[len(values)],
        vals=values,
    )


def rewrite_split(
    node: onnx.NodeProto,
    node_index: int,
    value_infos: dict[str, onnx.ValueInfoProto],
    used_names: set[str],
) -> tuple[list[onnx.NodeProto], list[onnx.TensorProto], int, list[int]]:
    if not node.input:
        raise ValueError(f'Split node "{node.name}" has no input.')

    input_name = node.input[0]
    rank, _ = tensor_rank_and_dims(input_name, value_infos)
    axis_attribute = next(
        (attribute for attribute in node.attribute if attribute.name == "axis"),
        None,
    )
    axis = normalized_axis(
        helper.get_attribute_value(axis_attribute) if axis_attribute is not None else 0,
        rank,
    )
    output_sizes = static_output_sizes(node, axis, value_infos)
    prefix = safe_name(node.name or f"split_{node_index}")
    axes_name = unique_name(f"{prefix}__slice_axes", used_names)
    steps_name = unique_name(f"{prefix}__slice_steps", used_names)
    initializers = [
        make_int64_initializer(axes_name, [axis]),
        make_int64_initializer(steps_name, [1]),
    ]
    replacements: list[onnx.NodeProto] = []
    start = 0

    for output_index, (output_name, size) in enumerate(zip(node.output, output_sizes)):
        end = start + size
        starts_name = unique_name(
            f"{prefix}__slice_{output_index}_starts",
            used_names,
        )
        ends_name = unique_name(
            f"{prefix}__slice_{output_index}_ends",
            used_names,
        )

        initializers.append(make_int64_initializer(starts_name, [start]))
        initializers.append(make_int64_initializer(ends_name, [end]))
        replacements.append(
            helper.make_node(
                "Slice",
                inputs=[
                    input_name,
                    starts_name,
                    ends_name,
                    axes_name,
                    steps_name,
                ],
                outputs=[output_name],
                name=unique_name(
                    f"{prefix}__slice_{output_index}",
                    used_names,
                ),
            )
        )
        start = end

    return replacements, initializers, axis, output_sizes


def collect_value_infos(model: onnx.ModelProto) -> dict[str, onnx.ValueInfoProto]:
    inferred = shape_inference.infer_shapes(model)
    graph = inferred.graph
    infos = {}

    for value_info in [*graph.input, *graph.value_info, *graph.output]:
        infos[value_info.name] = value_info

    return infos


def main() -> None:
    args = parse_args()

    if args.max_storage_buffers_per_stage < 2:
        raise ValueError("--max-storage-buffers-per-stage must be at least 2.")

    model = onnx.load_model(args.input, load_external_data=True)
    opset = onnx_opset(model)

    if opset < 10:
        raise ValueError(
            f"Slice input tensors require ai.onnx opset 10 or newer; model uses {opset}."
        )

    value_infos = collect_value_infos(model)
    requested_nodes = set(args.node)
    used_names = {
        initializer.name
        for initializer in model.graph.initializer
    }

    for node in model.graph.node:
        if node.name:
            used_names.add(node.name)

    replacements_by_index: dict[
        int,
        tuple[list[onnx.NodeProto], list[onnx.TensorProto], int, list[int]],
    ] = []

    for node_index, node in enumerate(model.graph.node):
        if node.op_type != "Split":
            continue

        if requested_nodes and node.name not in requested_nodes:
            continue

        storage_buffers = 1 + len(node.output)

        if not requested_nodes and storage_buffers <= args.max_storage_buffers_per_stage:
            continue

        replacement = rewrite_split(
            node,
            node_index,
            value_infos,
            used_names,
        )
        replacements_by_index[node_index] = replacement

        _, _, axis, output_sizes = replacement
        label = node.name or f"Split[{node_index}]"

        print(
            f"Rewrite {label}: "
            f"{len(node.output)} outputs, {storage_buffers} storage buffers, "
            f"axis {axis}, split sizes {output_sizes}"
        )

    if requested_nodes:
        found_names = {
            model.graph.node[index].name
            for index in replacements_by_index
        }
        missing = requested_nodes - found_names

        if missing:
            missing_list = ", ".join(sorted(missing))
            raise ValueError(f"Requested Split node(s) not found: {missing_list}")

    if not replacements_by_index:
        raise ValueError(
            "No Split nodes matched the rewrite criteria. "
            "Use --node to target a specific Split."
        )

    if args.dry_run:
        return

    rewritten_nodes: list[onnx.NodeProto] = []
    new_initializers: list[onnx.TensorProto] = []

    for node_index, node in enumerate(model.graph.node):
        replacement = replacements_by_index.get(node_index)

        if replacement is None:
            rewritten_nodes.append(node)
            continue

        nodes, initializers, _, _ = replacement
        rewritten_nodes.extend(nodes)
        new_initializers.extend(initializers)

    del model.graph.node[:]
    model.graph.node.extend(rewritten_nodes)
    model.graph.initializer.extend(new_initializers)

    metadata = model.metadata_props.add()
    metadata.key = "bgcut.webgpu.split_rewrite"
    metadata.value = (
        f"split-to-slice;max-storage-buffers-per-stage="
        f"{args.max_storage_buffers_per_stage}"
    )

    onnx.checker.check_model(model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(model, args.output)

    print(
        f"Wrote {args.output} with {len(replacements_by_index)} Split node(s) rewritten."
    )


if __name__ == "__main__":
    main()
