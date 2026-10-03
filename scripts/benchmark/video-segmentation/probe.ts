import * as ort from "onnxruntime-web/webgpu";

import { resolveOrtWebGpuWasmUrl } from "../../../src/browser/ort-webgpu-runtime";

import {
  browserVideoModelUrl,
} from "./model-delivery";

import type {
  VideoModelArtifact,
  VideoModelGraphRole,
  VideoSegmentationCandidate,
} from "./types";

export type VideoModelProbeValueMetadata = {
  readonly name: string;
  readonly isTensor: boolean;
  readonly type: string | null;
  readonly tensorDimensions: readonly (number | string)[] | null;
};

export type VideoModelProbeGraphReport = {
  readonly role: VideoModelGraphRole;
  readonly filename: string;
  readonly compatible: boolean;
  readonly resolvedUrl: string | null;
  readonly bytes: number | null;
  readonly etag: string | null;
  readonly downloadMs: number | null;
  readonly sessionMs: number | null;
  readonly inputs: readonly VideoModelProbeValueMetadata[];
  readonly outputs: readonly VideoModelProbeValueMetadata[];
  readonly error: string | null;
};

export type VideoModelProbeReport = {
  readonly schemaVersion: 2;
  readonly candidate: VideoSegmentationCandidate["id"];
  readonly compatible: boolean;
  readonly userAgent: string;
  readonly generatedAt: string;
  readonly totalBytes: number;
  readonly totalDownloadMs: number;
  readonly totalSessionMs: number;
  readonly graphs: readonly VideoModelProbeGraphReport[];
};

type GraphArtifact = VideoModelArtifact & {
  readonly role: VideoModelGraphRole;
};

type LoadedGraph = {
  readonly artifact: GraphArtifact;
  readonly bytes: Uint8Array;
  readonly externalData:
    readonly {
      readonly path: string;
      readonly data: Uint8Array;
    }[];
  readonly totalBytes: number;
  readonly response: Response;
  readonly downloadMs: number;
};

const isGraphArtifact = (
  artifact: VideoModelArtifact,
): artifact is GraphArtifact =>
  artifact.role !==
    "constants" &&
  artifact.role !==
    "parameters";

const graphArtifacts = (
  candidate: VideoSegmentationCandidate,
): readonly GraphArtifact[] =>
  candidate.artifacts.filter(
    isGraphArtifact,
  );

const fetchGraph = async (
  artifact: GraphArtifact,
): Promise<LoadedGraph> => {
  const startedAt = performance.now();

  const response = await fetch(
    browserVideoModelUrl(
      artifact.url,
    ),
    {
      cache: "force-cache",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not download ${artifact.filename}: HTTP ${response.status}.`,
    );
  }

  const bytes = new Uint8Array(
    await response.arrayBuffer(),
  );

  const externalData:
    {
      readonly path: string;
      readonly data: Uint8Array;
    }[] = [];

  let totalBytes =
    bytes.byteLength;

  for (
    const external of
    artifact.externalData ??
    []
  ) {
    const externalResponse =
      await fetch(
        browserVideoModelUrl(
          external.url,
        ),
        {
          cache:
            "force-cache",
        },
      );

    if (
      !externalResponse.ok
    ) {
      throw new Error(
        `Could not download ${external.filename}: HTTP ${externalResponse.status}.`,
      );
    }

    const data =
      new Uint8Array(
        await externalResponse.arrayBuffer(),
      );

    totalBytes +=
      data.byteLength;

    externalData.push({
      path:
        external.filename,
      data,
    });
  }

  return {
    artifact,
    bytes,
    externalData,
    totalBytes,
    response,
    downloadMs:
      performance.now() -
      startedAt,
  };
};

const metadataOf = (
  metadata: readonly ort.InferenceSession.ValueMetadata[],
): readonly VideoModelProbeValueMetadata[] =>
  metadata.map(
    (value) =>
      value.isTensor
        ? {
            name: value.name,
            isTensor: true,
            type: value.type,
            tensorDimensions: [
              ...value.shape,
            ],
          }
        : {
            name: value.name,
            isTensor: false,
            type: null,
            tensorDimensions: null,
          },
  );

const failedGraphReport = (
  artifact: GraphArtifact,
  message: string,
  loaded?: LoadedGraph,
): VideoModelProbeGraphReport => ({
  role: artifact.role,
  filename: artifact.filename,
  compatible: false,
  resolvedUrl:
    loaded?.response.url ??
    null,
  bytes:
    loaded?.totalBytes ??
    null,
  etag:
    loaded?.response.headers.get(
      "etag",
    ) ??
    null,
  downloadMs:
    loaded?.downloadMs ??
    null,
  sessionMs: null,
  inputs: [],
  outputs: [],
  error: message,
});

export const probeVideoSegmentationCandidate = async (
  candidate: VideoSegmentationCandidate,
  onProgress?: (
    message: string,
  ) => void,
): Promise<VideoModelProbeReport> => {
  ort.env.wasm.wasmPaths = {
    wasm: resolveOrtWebGpuWasmUrl(
      globalThis.location.href,
    ),
  };

  ort.env.webgpu.powerPreference =
    "high-performance";

  const sessions:
    ort.InferenceSession[] = [];

  const graphs:
    VideoModelProbeGraphReport[] = [];

  try {
    for (
      const artifact of
      graphArtifacts(candidate)
    ) {
      onProgress?.(
        `Downloading ${candidate.label} ${artifact.role}.`,
      );

      let loaded:
        LoadedGraph;

      try {
        loaded =
          await fetchGraph(
            artifact,
          );
      } catch (error) {
        graphs.push(
          failedGraphReport(
            artifact,
            error instanceof Error
              ? error.message
              : String(error),
          ),
        );

        continue;
      }

      onProgress?.(
        `Compiling ${candidate.label} ${artifact.role}.`,
      );

      const sessionStartedAt =
        performance.now();

      try {
        const sessionOptions:
          ort.InferenceSession.SessionOptions = {
            executionProviders: [
              {
                name: "webgpu",
              },
            ],
            graphOptimizationLevel:
              "all",
          };

        if (
          loaded.externalData.length >
          0
        ) {
          sessionOptions.externalData =
            loaded.externalData;
        }

        const session =
          await ort.InferenceSession.create(
            loaded.bytes,
            sessionOptions,
          );

        const sessionMs =
          performance.now() -
          sessionStartedAt;

        sessions.push(
          session,
        );

        graphs.push({
          role:
            artifact.role,
          filename:
            artifact.filename,
          compatible: true,
          resolvedUrl:
            loaded.response.url,
          bytes:
            loaded.totalBytes,
          etag:
            loaded.response.headers.get(
              "etag",
            ),
          downloadMs:
            loaded.downloadMs,
          sessionMs,
          inputs:
            metadataOf(
              session.inputMetadata,
            ),
          outputs:
            metadataOf(
              session.outputMetadata,
            ),
          error: null,
        });
      } catch (error) {
        graphs.push(
          failedGraphReport(
            artifact,
            `${candidate.label} ${artifact.role} could not create an ONNX Runtime WebGPU session. ${error instanceof Error ? error.message : String(error)}`,
            loaded,
          ),
        );
      }
    }

    return {
      schemaVersion: 2,
      candidate:
        candidate.id,
      compatible:
        graphs.every(
          (graph) =>
            graph.compatible,
        ),
      userAgent:
        navigator.userAgent,
      generatedAt:
        new Date().toISOString(),
      totalBytes:
        graphs.reduce(
          (sum, graph) =>
            sum +
            (graph.bytes ?? 0),
          0,
        ),
      totalDownloadMs:
        graphs.reduce(
          (sum, graph) =>
            sum +
            (graph.downloadMs ?? 0),
          0,
        ),
      totalSessionMs:
        graphs.reduce(
          (sum, graph) =>
            sum +
            (graph.sessionMs ?? 0),
          0,
        ),
      graphs,
    };
  } finally {
    await Promise.all(
      sessions.map(
        async (session) => {
          try {
            await session.release();
          } catch {
            // The probe is already ending. A release failure must not hide
            // a graph compatibility result.
          }
        },
      ),
    );
  }
};
