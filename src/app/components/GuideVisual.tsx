import { Match, Switch } from "@solidjs/web";

import type { GuideVisual } from "../../shared/guides";

const EffectBoundaryVisual = () => (
  <figure class="guide-visual effect-boundary-visual">
    <div class="effect-boundary-stack">
      <div class="guide-visual-card">
        <span class="guide-visual-label">Public APIs</span>
        <code>Promise · AsyncIterable · BgcutError</code>
      </div>

      <span class="guide-visual-connector" aria-hidden="true" />

      <div class="guide-visual-card guide-visual-card-emphasis">
        <span class="guide-visual-label">Effect-managed work</span>
        <code>typed errors · fallback · acquire / use / release</code>
      </div>

      <span class="guide-visual-connector" aria-hidden="true" />

      <div class="effect-boundary-details">
        <div class="guide-visual-card">
          <span class="guide-visual-label">Runtime and I/O work</span>
          <code>WebGPU setup · model cache · ONNX sessions · filesystem · export</code>
        </div>
        <div class="guide-visual-card">
          <span class="guide-visual-label">Hot loops stay plain</span>
          <code>pixel math · preprocessing · TypeGPU · raw WebGPU</code>
        </div>
      </div>
    </div>

    <figcaption>
      Effect handles failures, fallback, and cleanup. The public API stays Promise-based, while pixel
      and GPU loops remain plain TypeScript, TypeGPU, or WebGPU.
    </figcaption>
  </figure>
);

const ResourceLifecycleVisual = () => (
  <figure class="guide-visual resource-lifecycle-visual">
    <div class="resource-lifecycle-flow">
      <div class="guide-visual-card">
        <span class="guide-visual-label">Acquire</span>
        <code>ImageBitmap · GPU input · session lease</code>
      </div>

      <span class="resource-lifecycle-arrow" aria-hidden="true">→</span>

      <div class="guide-visual-card guide-visual-card-emphasis">
        <span class="guide-visual-label">Use</span>
        <code>decode · infer · composite · export</code>
      </div>

      <span class="resource-lifecycle-arrow" aria-hidden="true">→</span>

      <div class="guide-visual-card">
        <span class="guide-visual-label">Release</span>
        <code>bitmap.close · releaseGpuModelInput · session.release</code>
      </div>
    </div>

    <figcaption>
      acquireUseRelease ties cleanup to the resource. A failure in the use step does not skip the
      release step.
    </figcaption>
  </figure>
);

export const GuideVisualBlock = (props: { readonly visual: GuideVisual }) => (
  <Switch>
    <Match when={props.visual.kind === "effect-boundary"}>
      <EffectBoundaryVisual />
    </Match>
    <Match when={props.visual.kind === "resource-lifecycle"}>
      <ResourceLifecycleVisual />
    </Match>
  </Switch>
);
