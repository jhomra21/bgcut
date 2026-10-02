import * as ort from "onnxruntime-web/webgpu";

import { resolveOrtWebGpuWasmUrl } from "../../../src/browser/ort-webgpu-runtime";

import type {
  VideoModelArtifact,
  VideoModelGraphRole,
  VideoSegmentationCandidate,
} from "./types";

export type VideoModelProbeGraphReport = {
  readonly role: VideoModelGraphRole;
  readonly filename: string;
  readonly resolvedUrl: string;
  readonly bytes: number;
  readonly etag: string | null;
  readonly downloadMs: number;
  readonly sessionMs: number;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
};

export type VideoModelProbeReport = {
  readonly schemaVersion: 1;
  readonly candidate: VideoSegmentationCandidate["id"];
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
  readonly response: Response;
  readonly downloadMs: number;
};

const isGraphArtifact = (
  artifact: VideoModelArtifact,
): artifact is GraphArtifact =>
  artifact.role !== "constants";

const graphArtifacts = (
  candidate: VideoSegmentationCandidate,
): readonly GraphArtifact[] =>
  candidate.artifacts.filter(
    isGraphArtifact,
  );

const fetchGraph = async (
  artifact: LoadedGraph["artifact"],
): Promise<LoadedGraph> => {
  const startedAt = performance.now();

  const response = await fetch(
    artifact.url,
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

  return {
    artifact,
    bytes,
    response,
    downloadMs:
      performance.now() -
      startedAt,
  };
};

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

      const loaded =
        await fetchGraph(
          artifact,
        );

      onProgress?.(
        `Compiling ${candidate.label} ${artifact.role}.`,
      );

      const sessionStartedAt =
        performance.now();

      const session =
        await ort.InferenceSession.create(
          loaded.bytes,
          {
            executionProviders: [
              {
                name: "webgpu",
              },
            ],
            graphOptimizationLevel:
              "all",
          },
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
        resolvedUrl:
          loaded.response.url,
        bytes:
          loaded.bytes.byteLength,
        etag:
          loaded.response.headers.get(
            "etag",
          ),
        downloadMs:
          loaded.downloadMs,
        sessionMs,
        inputNames: [
          ...session.inputNames,
        ],
        outputNames: [
          ...session.outputNames,
        ],
      });
    }

    return {
      schemaVersion: 1,
      candidate:
        candidate.id,
      userAgent:
        navigator.userAgent,
      generatedAt:
        new Date().toISOString(),
      totalBytes:
        graphs.reduce(
          (sum, graph) =>
            sum +
            graph.bytes,
          0,
        ),
      totalDownloadMs:
        graphs.reduce(
          (sum, graph) =>
            sum +
            graph.downloadMs,
          0,
        ),
      totalSessionMs:
        graphs.reduce(
          (sum, graph) =>
            sum +
            graph.sessionMs,
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
            // the graph that failed to load or compile.
          }
        },
      ),
    );
  }
};
