export const GUIDE_PAGE_IDS = [
  "guide-remove-background-without-uploading",
  "guide-webgpu-vs-webassembly",
  "guide-node-js-background-removal",
  "guide-batch-background-removal-cli",
  "guide-how-local-background-removal-works",
  "guide-how-bgcut-uses-effect",
  "guide-png-webp-jpeg-transparency",
  "guide-background-removal-privacy",
  "guide-browser-cli-node",
] as const;

export type GuidePageId = (typeof GUIDE_PAGE_IDS)[number];

export type GuideCodeBlock = {
  readonly language: "shell" | "typescript";
  readonly code: string;
};

export type GuideVisual =
  | { readonly kind: "effect-boundary" }
  | { readonly kind: "resource-lifecycle" };

export type GuideSection = {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
  readonly code?: GuideCodeBlock;
  readonly visual?: GuideVisual;
};

export type Guide = {
  readonly page: GuidePageId;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly summary: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly sections: readonly GuideSection[];
};

const publishedAt = "2026-09-29";

export const GUIDES: Readonly<Record<GuidePageId, Guide>> = {
  "guide-remove-background-without-uploading": {
    page: "guide-remove-background-without-uploading",
    slug: "remove-background-without-uploading",
    title: "How to remove a background without uploading your image",
    description:
      "Learn how local background removal works in a browser, what still downloads from the site, and how to verify that your source image is not sent for inference.",
    summary:
      "A no-upload background remover runs the model on your device. The important check is not the marketing label. It is whether the source image or decoded pixels leave the browser.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "what-no-upload-means",
        title: "What no upload means",
        paragraphs: [
          "A background remover needs the pixels of your image to estimate which parts belong to the subject. A hosted service sends those pixels to a server. A local browser remover keeps that inference step on your device.",
          "With bgcut.dev, the browser downloads the application, ONNX Runtime files, and a model. Your source image, decoded pixels, predicted mask, and exported result stay on your machine during background removal.",
          "Local processing does not mean the page makes no network requests. The site still has to load its own code and model files. The privacy distinction is about whether your image becomes part of a request to a background-removal server.",
        ],
      },
      {
        id: "use-bgcut",
        title: "Remove a background locally",
        paragraphs: [
          "Open bgcut.dev, choose or paste a JPEG, PNG, WebP, or AVIF image, and wait for the result. The browser tries WebGPU first when it can use it. If that path cannot run, bgcut can retry with WebAssembly.",
          "After inference, bgcut restores the matte to the source dimensions and produces the transparent result in the browser. You can inspect the original and result before copying or downloading the PNG.",
          "There is no account step, API key, or per-image request to a bgcut inference service.",
        ],
      },
      {
        id: "verify-local-processing",
        title: "How to verify the claim",
        paragraphs: [
          "If privacy matters for a specific image, verify the behavior instead of relying on a badge. Open the browser developer tools, switch to the Network panel, clear the log, then process a disposable test image.",
          "You should see application, runtime, and model requests. You should not see the test image sent as a request body to bgcut for inference. A local tool should also keep working for another image after the required runtime and model files are cached, subject to normal browser cache behavior.",
          "For sensitive work, use your organization's normal browser and device controls as well. Local inference reduces one data transfer. It does not replace endpoint security or access policy.",
        ],
      },
      {
        id: "when-browser-local-fits",
        title: "When browser-local removal fits",
        paragraphs: [
          "Browser-local removal is useful when you want an interactive tool and do not want to install a package. It is also useful when the source image should not be sent to an inference provider.",
          "For automated jobs, folders, or application code, use bgcut's CLI or Node.js API instead. Those interfaces also run locally and avoid turning browser automation into a batch-processing system.",
        ],
        bullets: [
          "Use the browser for interactive one-image work and visual inspection.",
          "Use the CLI for shell scripts, files, and directories.",
          "Use the Node.js API when background removal is part of an application.",
        ],
      },
    ],
  },
  "guide-webgpu-vs-webassembly": {
    page: "guide-webgpu-vs-webassembly",
    slug: "webgpu-vs-webassembly-background-removal",
    title: "WebGPU vs WebAssembly for local background removal",
    description:
      "Understand the WebGPU and WebAssembly paths used for browser background removal, why a local tool needs both, and what fallback behavior means.",
    summary:
      "WebGPU can run model work on the GPU. WebAssembly gives the browser a broader CPU-compatible fallback. A useful background remover chooses between them without changing where the image is processed.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "different-execution-paths",
        title: "Two execution paths, one local job",
        paragraphs: [
          "WebGPU gives web applications access to modern GPU compute. WebAssembly provides a portable compiled execution target that browsers can run without the same GPU requirements.",
          "For background removal, both paths can execute the model on the user's device. The difference is how the browser performs the computation, not whether the source image has to be uploaded.",
          "bgcut uses ONNX Runtime in both browser paths. Automatic mode attempts WebGPU first. If WebGPU is unavailable or its setup or inference fails in a way that permits fallback, bgcut retries with WebAssembly.",
        ],
      },
      {
        id: "why-webgpu-first",
        title: "Why try WebGPU first",
        paragraphs: [
          "Neural-network inference contains large groups of numeric operations that can map well to a GPU. WebGPU gives the runtime a way to schedule those operations on supported browser and hardware combinations.",
          "That does not make every WebGPU run faster than every WebAssembly run. Device, browser, model graph, input size, shader compilation, cache state, and runtime version all affect timing. Measure the exact configuration you plan to support.",
          "bgcut keeps benchmark records separate from product claims for this reason. A performance number without its device, image size, browser, runtime, version, and cold or warm state is hard to reproduce.",
        ],
      },
      {
        id: "why-wasm-matters",
        title: "Why WebAssembly still matters",
        paragraphs: [
          "A browser tool that requires one GPU path has a smaller compatibility range. WebAssembly gives bgcut another local execution option when WebGPU is missing or cannot complete the run.",
          "The fallback also keeps the user-facing contract simple. The user chooses an image. bgcut selects the available browser engine. The output remains local in either case.",
          "The fallback is not a promise that every device can run the model. Memory limits, browser features, and other runtime constraints still apply.",
        ],
      },
      {
        id: "safari-model-selection",
        title: "Safari and model selection",
        paragraphs: [
          "bgcut has a validated internal-FP16 browser model for Safari WebGPU devices that expose the shader-f16 feature. Other browser paths use the FP32 artifact.",
          "This selection is an implementation detail with a verification rule. It should not be turned into a broad claim that one browser or numeric format is always faster or more accurate.",
          "If you are integrating bgcut into a workflow where engine choice matters, use the documented runtime behavior and reproduce the benchmark on the devices you care about.",
        ],
      },
    ],
  },
  "guide-node-js-background-removal": {
    page: "guide-node-js-background-removal",
    slug: "node-js-background-removal",
    title: "How to remove image backgrounds in Node.js",
    description:
      "Use bgcut from Node.js with one reusable local runtime, single-image removal, batch iteration, output formats, engine selection, and typed errors.",
    summary:
      "bgcut exposes an object-based Node.js API. Open one remover, reuse it for the work you have, and close it when the job is finished.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "install-and-open",
        title: "Install and open bgcut",
        paragraphs: [
          "The Node.js API runs background removal on the machine where your process is running. It is not a client for a hosted bgcut API.",
          "Create one remover and keep it alive while you process related images. Reusing the instance avoids rebuilding the native runtime for every call.",
        ],
        code: {
          language: "shell",
          code: "bun add bgcut",
        },
      },
      {
        id: "single-image",
        title: "Remove one background",
        paragraphs: [
          "Call removeBackground with a file path, Uint8Array, or ArrayBuffer. The result contains the encoded data plus width, height, and output format.",
          "PNG is the natural default when you need transparency. WebP can also preserve transparency. JPEG has no alpha channel, so bgcut composites the result on white when you request JPG output.",
        ],
        code: {
          language: "typescript",
          code: `import { writeFile } from "node:fs/promises";
import { bgcut } from "bgcut";

const remover = await bgcut();

try {
  const result = await remover.removeBackground("photo.jpg", {
    format: "webp",
  });

  await writeFile("photo.webp", result.data);
} finally {
  await remover.close();
}`,
        },
      },
      {
        id: "many-images",
        title: "Process many images with one runtime",
        paragraphs: [
          "Use removeMany for files, directories, iterables, or async iterables. Processing is sequential and the instance stays warm between items.",
          "Each yielded item reports success or failure for that source. A bad image does not have to discard the results that came before it or stop later inputs from running.",
        ],
        code: {
          language: "typescript",
          code: `import { bgcut } from "bgcut";

const remover = await bgcut();

try {
  for await (const item of remover.removeMany("photos")) {
    if (!item.ok) {
      console.error(item.source.input, item.error);
      continue;
    }

    console.log(item.result);
  }
} finally {
  await remover.close();
}`,
        },
      },
      {
        id: "engines-and-errors",
        title: "Choose an engine only when you need to",
        paragraphs: [
          "The default engine is auto. It tries the native WebGPU runtime first and can use CPU if runtime creation fails. Use gpu when the job must require WebGPU. Use cpu when you need to force the CPU path.",
          "Public failures use BgcutError with documented codes for model, engine, input, inference, output, and closed-state errors. Handle those codes at the boundary where your application can decide whether to retry, reject the input, or stop the job.",
          "Do not silently turn an explicit gpu request into CPU work. An explicit engine choice is a constraint from the caller.",
        ],
      },
    ],
  },
  "guide-batch-background-removal-cli": {
    page: "guide-batch-background-removal-cli",
    slug: "batch-background-removal-cli",
    title: "How to batch remove backgrounds from the command line",
    description:
      "Use the bgcut CLI for multiple images and recursive directories, choose output locations and formats, and keep one warm local runtime for the batch.",
    summary:
      "The bgcut CLI accepts more than one file or a directory. Batch work runs sequentially and reuses one runtime instead of starting a new inference process for every image.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "one-file-first",
        title: "Start with one file",
        paragraphs: [
          "The smallest CLI command takes an image path and writes a transparent PNG next to the source file unless you provide another output.",
          "Supported inputs are JPEG, PNG, WebP, and AVIF. The first run may need to obtain and validate the model before inference can start.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut photo.jpg

# choose an output
npx bgcut photo.jpg -o portrait.png`,
        },
      },
      {
        id: "multiple-files",
        title: "Pass several files to one batch",
        paragraphs: [
          "List several source files in the same command when you want them processed by one bgcut run. The CLI keeps one runtime and processes the images in order.",
          "Sequential processing avoids pretending that every machine can run several copies of the model at once. It also makes output and failure reporting easier to follow in shell workflows.",
        ],
        code: {
          language: "shell",
          code: "npx bgcut first.jpg second.png third.webp",
        },
      },
      {
        id: "directory",
        title: "Process a directory recursively",
        paragraphs: [
          "A directory input tells bgcut to scan supported images recursively. With an output directory, the results go under that destination instead of beside each source.",
          "Use this for photo folders, build jobs, or other file-based automation where a browser queue would add unnecessary work.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut photos/
npx bgcut photos/ -o ./cutouts`,
        },
      },
      {
        id: "formats-and-engines",
        title: "Choose output and engine constraints",
        paragraphs: [
          "PNG is the default transparent output. Use the WebP option for lossless WebP with transparency. JPEG output uses a white background because JPEG does not carry an alpha channel.",
          "Automatic engine selection tries native WebGPU and can use CPU if runtime creation fails. If your automation requires one engine, pass the explicit GPU or CPU option and treat failure as a real failure instead of changing the requirement.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut photo.jpg --webp
npx bgcut photo.jpg --gpu
npx bgcut photo.jpg --cpu`,
        },
      },
    ],
  },
  "guide-how-local-background-removal-works": {
    page: "guide-how-local-background-removal-works",
    slug: "how-local-background-removal-works",
    title: "How local AI background removal works",
    description:
      "Follow a local background-removal job through image decode, resize and normalization, ONNX inference, matte restoration, compositing, and export.",
    summary:
      "Background removal is a pipeline. The model predicts a matte at its working resolution, then the application maps that result back to the source image and encodes a new file.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "decode",
        title: "1. Decode the source image",
        paragraphs: [
          "The application first decodes JPEG, PNG, WebP, or AVIF bytes into pixels. Orientation matters here because the model and final compositor need to agree about which pixel is where.",
          "In the browser, decoding uses browser image facilities. The native Node and CLI path uses Sharp and libvips for decode and orientation.",
          "No segmentation has happened yet. This stage only turns the input file into pixels the rest of the pipeline can use.",
        ],
      },
      {
        id: "prepare-model-input",
        title: "2. Prepare the model input",
        paragraphs: [
          "bgcut's public model input is 512 by 512. The application resizes the source for the model and applies the normalization expected by the model.",
          "The browser WebGPU path uses TypeGPU for resize and ImageNet normalization. The browser WebAssembly path uses canvas resize with the same normalization. The native path uses linear resize and ImageNet normalization.",
          "The original source dimensions are kept because the 512 by 512 model input is not the final output size.",
        ],
      },
      {
        id: "infer-mask",
        title: "3. Run segmentation inference",
        paragraphs: [
          "The ONNX model predicts a matte that describes foreground membership across the image. bgcut uses ONNX Runtime to execute the model locally.",
          "Browser automatic mode tries WebGPU and can fall back to WebAssembly. The native CLI and Node.js API use native ONNX Runtime with WebGPU or CPU according to engine selection.",
          "The model file is large because it contains the learned parameters. The npm package does not bundle the model artifacts. bgcut validates cached model size and SHA-256 before reuse.",
        ],
      },
      {
        id: "restore-and-composite",
        title: "4. Restore the matte and export",
        paragraphs: [
          "The predicted matte is restored to the source image dimensions. bgcut then combines that matte with the original pixels to produce transparency at the original size.",
          "PNG and WebP can carry alpha transparency. JPEG cannot, so a JPEG result needs an opaque background.",
          "This last step is why the model's 512 by 512 input does not mean the downloaded cutout is limited to 512 by 512.",
        ],
      },
    ],
  },
  "guide-png-webp-jpeg-transparency": {
    page: "guide-png-webp-jpeg-transparency",
    slug: "png-webp-jpeg-transparency",
    title: "PNG vs WebP vs JPEG after background removal",
    description:
      "Choose an output format after background removal based on transparency, compatibility, file size needs, and what bgcut actually writes.",
    summary:
      "Use PNG when you want the simplest transparent output. WebP can also keep transparency. JPEG cannot store an alpha channel and needs an opaque background.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "png",
        title: "PNG for transparent cutouts",
        paragraphs: [
          "PNG supports an alpha channel, so it can store the soft transparency around a removed subject. bgcut uses PNG as the default output in its browser and CLI workflows.",
          "PNG is a safe choice when the result will move between editors, design tools, browsers, or other systems and preserving transparency matters more than minimizing the file size.",
          "A transparent pixel is still a pixel with color channels plus alpha. Applications can handle the hidden color channels differently around edges, which is one reason to inspect the final result in the destination tool when edge quality matters.",
        ],
      },
      {
        id: "webp",
        title: "WebP when you want transparency in another format",
        paragraphs: [
          "WebP supports alpha transparency and can be useful for web delivery or pipelines that already use WebP assets.",
          "bgcut's WebP output is lossless. That keeps the format choice from adding lossy compression artifacts to the cutout.",
          "Use WebP only when the systems that consume the output accept it. A technically smaller or newer format is not useful if the next tool in the workflow requires PNG.",
        ],
      },
      {
        id: "jpeg",
        title: "JPEG needs an opaque background",
        paragraphs: [
          "JPEG does not have an alpha channel. A background-removed image cannot stay transparent when it is encoded as JPEG.",
          "bgcut uses a white background for JPG output. That can be useful for catalogs or systems that require JPEG, but it is a different result from a transparent cutout.",
          "If you may need to place the subject on another background later, keep a PNG or WebP transparent master and make a JPEG copy only for the destination that requires it.",
        ],
      },
      {
        id: "decision",
        title: "A simple format rule",
        paragraphs: [
          "Choose the format based on the next step in the workflow. Do not convert just because one extension is more familiar.",
        ],
        bullets: [
          "Choose PNG for a broadly compatible transparent master.",
          "Choose lossless WebP when your downstream system accepts WebP and you want transparency.",
          "Choose JPEG only when you want or require an opaque image.",
        ],
      },
    ],
  },
  "guide-background-removal-privacy": {
    page: "guide-background-removal-privacy",
    slug: "background-removal-privacy",
    title: "What 'no upload' means for background-removal privacy",
    description:
      "Separate local inference from ordinary website traffic, understand which bgcut data stays on your machine, and verify the boundary with browser tools.",
    summary:
      "A site can load code and model files from the network while still processing your image locally. The privacy question is whether the source image or derived image data is sent away for inference.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "separate-network-from-image-transfer",
        title: "Separate network access from image transfer",
        paragraphs: [
          "The phrase 'works locally' is often misunderstood as 'the page never uses the network.' A hosted web application normally downloads HTML, JavaScript, styles, runtime files, and other assets before it can do anything.",
          "For background-removal privacy, the important boundary is the image. A local inference flow can download the model and still keep the selected image on the device.",
          "bgcut.dev serves application, model, and ONNX Runtime files. It does not need to send your source image to a bgcut inference backend because there is no hosted inference backend in that flow.",
        ],
      },
      {
        id: "data-in-local-job",
        title: "Data created during a local job",
        paragraphs: [
          "The browser starts with the source image bytes, decodes them into pixels, prepares model input, receives a predicted matte, composites the result, and creates the exported image.",
          "Those intermediate values can be as sensitive as the original file. A meaningful local-processing claim covers the source image, decoded pixels, mask, and result rather than only saying the original filename is not uploaded.",
          "bgcut's public privacy contract says those values stay on the user's machine during hosted browser inference.",
        ],
      },
      {
        id: "verify",
        title: "Verify with a disposable image",
        paragraphs: [
          "Open your browser's Network panel before selecting a test image. Clear existing requests, process the test image, and inspect the requests that occur during the run.",
          "Model and runtime downloads are expected. An upload containing the source image or derived image bytes to a background-removal endpoint would contradict a local-inference claim.",
          "This check is useful when evaluating any background-removal tool, not only bgcut. It turns a marketing statement into something you can inspect.",
        ],
      },
      {
        id: "other-privacy-boundaries",
        title: "Local inference is one privacy boundary",
        paragraphs: [
          "Local inference removes the need to send the image to an inference provider. Other parts of the device and browser still matter, including extensions, endpoint management, shared accounts, local storage, screen capture, and the destination where you later upload the result.",
          "Treat 'no upload' as a specific data-flow property, not a complete security guarantee.",
        ],
      },
    ],
  },
  "guide-how-bgcut-uses-effect": {
    page: "guide-how-bgcut-uses-effect",
    slug: "how-bgcut-uses-effect",
    title: "How bgcut uses Effect without making everything Effect",
    description:
      "See where bgcut 0.6.1 uses Effect for typed failures, fallback, resource cleanup, model caching, and runtime boundaries, and why tight image and GPU loops stay plain.",
    summary:
      "bgcut uses Effect around work that can fail, allocate resources, or cross a system boundary. Pixel math, preprocessing loops, and GPU command code stay plain TypeScript or TypeGPU when Effect would add no useful control.",
    publishedAt: "2026-10-01",
    updatedAt: "2026-10-01",
    sections: [
      {
        id: "boundary",
        title: "The boundary we chose",
        paragraphs: [
          "bgcut runs in several environments. The hosted browser uses browser APIs, WebGPU or WebAssembly, and ONNX Runtime. The CLI and Node.js API add Sharp, filesystem access, model caching, and native ONNX Runtime.",
          "That mix creates real failure and cleanup paths. bgcut uses Effect around GPU setup, image decoding, model downloads, session creation, inference, export, and cleanup. It does not wrap every function in Effect.",
          "As of bgcut 0.6.1, the internal runtime uses effect@4.0.0. The public Node.js API still returns Promises and async iterables, so callers do not need to know Effect.",
        ],
        visual: {
          kind: "effect-boundary",
        },
      },
      {
        id: "typed-failures",
        title: "Failures stay specific",
        paragraphs: [
          "Browser failures are tagged data instead of arbitrary thrown values. The error union on each Effect tells the caller which failures can come back from that operation.",
          "Formatting uses Match.exhaustive. If a new error tag is added without a matching formatter, the match stops being exhaustive instead of silently falling through to a generic message.",
        ],
        code: {
          language: "typescript",
          code: `export class ModelLoadFailed extends Data.TaggedError(
  "ModelLoadFailed",
)<{
  readonly message: string;
}> {}

export class InferenceFailed extends Data.TaggedError(
  "InferenceFailed",
)<{
  readonly message: string;
}> {}

export type BackgroundRemovalError =
  | GpuRuntimeError
  | ImageError
  | ModelDownloadFailed
  | ModelLoadFailed
  | InferenceFailed
  | ExportFailed;`,
        },
      },
      {
        id: "fallback",
        title: "Fallback is a decision, not a catch-all",
        paragraphs: [
          "Automatic browser mode tries WebGPU first. It falls back to WebAssembly only when shouldFallbackToWasm says the specific error permits it.",
          "That distinction matters. A bad image should remain an input error. A model failure should not be hidden by switching engines.",
          "Native auto mode follows the same idea at session creation. It tries WebGPU, then CPU if session creation fails. Explicit gpu and cpu requests do not silently change engines.",
        ],
        code: {
          language: "typescript",
          code: `const automaticRemoval = (
  file: File,
): Effect.Effect<BackgroundRemovalResult, BackgroundRemovalError> =>
  removeBackgroundWebGpu(file).pipe(
    Effect.catch((error) =>
      shouldFallbackToWasm(error)
        ? removeBackgroundWithWasm(file)
        : Effect.fail(error),
    ),
  );`,
        },
      },
      {
        id: "resources",
        title: "Resources have owners",
        paragraphs: [
          "Browser removal owns objects that need explicit cleanup, including ImageBitmap instances, GPU input buffers, and some ONNX session leases.",
          "Effect.acquireUseRelease keeps acquisition, use, and cleanup in one expression. The release step still runs when the use step fails.",
        ],
        visual: {
          kind: "resource-lifecycle",
        },
        code: {
          language: "typescript",
          code: `return yield* Effect.acquireUseRelease(
  createGpuModelInput(runtime, sourceBitmap, timings),
  (input) =>
    Effect.gen(function* () {
      const outputs = yield* Effect.tryPromise({
        try: () =>
          session.run(
            { [inputName]: input.tensor },
            { [outputName]: outputTarget.tensor },
          ),
        catch: (cause) =>
          new InferenceFailed({
            message: String(cause),
          }),
      });

      return outputs;
    }),
  (input) => Effect.sync(() => releaseGpuModelInput(input)),
);`,
        },
      },
      {
        id: "model-cache",
        title: "The model cache is one typed workflow",
        paragraphs: [
          "Native bgcut needs a validated model before it can create a session. The cache workflow checks the current file's size and SHA-256, tries compatible older cache locations, downloads to a temporary file when needed, verifies it, and only then moves it into place.",
          "Each network and filesystem failure becomes ModelCacheError. The caller gets one typed operation instead of a chain of unrelated promise failures.",
        ],
        code: {
          language: "typescript",
          code: `const modelPath = yield* ensureCachedModel();
const nativeSession = yield* createSession(modelPath, engine);`,
        },
      },
      {
        id: "public-api",
        title: "Effect stops at the public API",
        paragraphs: [
          "The public Node.js API does not return Effect values. runPublicEffect executes the internal Effect, reads its Result, and throws the mapped public error when the operation fails.",
          "That lets the runtime keep detailed errors such as ModelCacheError, BgcutSessionError, and BgcutInferenceError internally while users work with a smaller BgcutError contract.",
          "The CLI also has one Effect program and interprets it with runPromiseExit. Argument parsing, local-server startup, runtime failures, and the final exit code share one execution path without changing the Node.js API.",
        ],
        code: {
          language: "typescript",
          code: `const runPublicEffect = async <A, E extends Error>(
  effect: Effect.Effect<A, E>,
): Promise<A> => {
  const result = await Effect.runPromise(Effect.result(effect));

  if (Result.isFailure(result)) {
    throw result.failure;
  }

  return result.success;
};`,
        },
      },
      {
        id: "plain-code",
        title: "Hot loops stay plain",
        paragraphs: [
          "Effect is not bgcut's pixel-processing library. Pixel math, preprocessing, compositing, TypeGPU work, and raw WebGPU commands stay as direct code when they already have clear inputs and outputs.",
          "Those functions do not need an Effect wrapper when they do not own asynchronous resources or expose a failure that the caller needs to distinguish.",
          "The rule bgcut follows today is simple. Use Effect where failure, cleanup, or runtime control is part of correctness. Keep deterministic math and tight GPU work plain.",
        ],
        code: {
          language: "typescript",
          code: `const createMask = (logits: Float32Array): Uint8Array => {
  const alpha = new Uint8Array(logits.length);

  for (let index = 0; index < logits.length; index += 1) {
    alpha[index] = logitToAlphaByte(logits[index]);
  }

  return alpha;
};`,
        },
      },
    ],
  },
  "guide-browser-cli-node": {
    page: "guide-browser-cli-node",
    slug: "browser-cli-or-node-background-removal",
    title: "Browser, CLI, or Node.js for background removal?",
    description:
      "Choose the bgcut interface that matches interactive editing, shell automation, directory batches, or application code without changing the local-inference model.",
    summary:
      "Use the browser when a person is choosing and checking an image. Use the CLI for file automation. Use the Node.js API when background removal belongs inside application code.",
    publishedAt,
    updatedAt: publishedAt,
    sections: [
      {
        id: "browser",
        title: "Use the browser for interactive work",
        paragraphs: [
          "The hosted browser app is the shortest path when a person has an image and wants a transparent result. It supports choosing, dragging, or pasting an image and shows the original and cutout together for inspection.",
          "The browser path runs inference on the device with WebGPU when available and can use WebAssembly as a local fallback.",
          "Do not automate the browser just to process a folder. The CLI already has a file and directory contract for that job.",
        ],
      },
      {
        id: "cli",
        title: "Use the CLI for files and shell automation",
        paragraphs: [
          "The CLI fits scripts, build steps, scheduled jobs, and directories. It can accept one image, several images, or a directory and write the results as files.",
          "Batch processing is sequential and reuses one warm runtime. You can choose output format and require GPU or CPU when the environment needs a specific engine.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut photo.jpg
npx bgcut photos/ -o ./cutouts`,
        },
      },
      {
        id: "node",
        title: "Use Node.js inside an application",
        paragraphs: [
          "The Node.js API fits servers, desktop applications, workers on your own machine, and other JavaScript code that needs background removal as one step in a larger process.",
          "Create one bgcut instance, reuse it, and close it when finished. removeMany accepts files, directories, iterables, and async iterables when your application owns the input stream.",
        ],
        code: {
          language: "typescript",
          code: `import { bgcut } from "bgcut";

const remover = await bgcut();

try {
  const result = await remover.removeBackground("photo.jpg");
  console.log(result.width, result.height, result.format);
} finally {
  await remover.close();
}`,
        },
      },
      {
        id: "same-local-contract",
        title: "The interface changes, the local contract does not",
        paragraphs: [
          "The hosted browser runs the browser model locally. The CLI and Node.js API run the native runtime locally. Choosing an interface does not turn bgcut into a hosted image-processing service.",
          "Pick the interface based on who controls the job. A person usually wants the browser. A shell script usually wants the CLI. Application code usually wants the Node.js API.",
        ],
      },
    ],
  },
};

export const isGuidePage = (page: string): page is GuidePageId =>
  Object.hasOwn(GUIDES, page);
