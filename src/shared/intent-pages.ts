export const INTENT_PAGE_IDS = [
  "intent-private-background-remover",
  "intent-node-background-removal",
  "intent-background-removal-cli",
  "intent-batch-background-remover",
  "intent-open-source-background-remover",
] as const;

export type IntentPageId = (typeof INTENT_PAGE_IDS)[number];

export type IntentCode = {
  readonly language: "shell" | "typescript";
  readonly code: string;
};

export type IntentSection = {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
  readonly code?: IntentCode;
};

export type IntentPage = {
  readonly page: IntentPageId;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly summary: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
  readonly sections: readonly IntentSection[];
  readonly guideHref?: string;
};

export const INTENT_PAGES: Readonly<Record<IntentPageId, IntentPage>> = {
  "intent-private-background-remover": {
    page: "intent-private-background-remover",
    slug: "private-background-remover",
    title: "Private background remover with no image upload",
    description:
      "Remove image backgrounds locally in your browser. bgcut keeps source images, decoded pixels, masks, and results on your device instead of sending them to an inference backend.",
    summary:
      "Use bgcut when you want an interactive background remover without sending the source image to a background-removal server.",
    ctaLabel: "Remove a background",
    ctaHref: "/",
    guideHref: "/guides/remove-background-without-uploading",
    sections: [
      {
        title: "Your image stays on the device",
        paragraphs: [
          "bgcut.dev downloads application code, ONNX Runtime files, and the model it needs to run. The source image itself is decoded and processed in the browser.",
          "Source image bytes, decoded pixels, the predicted mask, and the generated result are not sent to a bgcut inference backend.",
        ],
      },
      {
        title: "WebGPU first, WebAssembly fallback",
        paragraphs: [
          "Automatic browser mode tries WebGPU when the browser and device can use it. When that path cannot run and fallback is allowed, bgcut can use WebAssembly instead.",
          "Both paths keep inference local. Engine selection changes how the browser computes the result, not where the image is processed.",
        ],
      },
      {
        title: "No account or per-image service request",
        paragraphs: [
          "The hosted remover does not require a bgcut account. There is also no per-image request to a bgcut inference service because that service is not part of the browser flow.",
          "The device running the browser supplies the compute. Local processing is not the same thing as free infrastructure.",
        ],
      },
    ],
  },
  "intent-node-background-removal": {
    page: "intent-node-background-removal",
    slug: "node-background-removal",
    title: "Node.js background removal that runs locally",
    description:
      "Remove image backgrounds from Node.js with the bgcut package. Reuse one local runtime for single images, batches, directories, and streamed input.",
    summary:
      "Use the bgcut object API inside Node.js when background removal belongs in application code and you do not need a hosted HTTP service.",
    ctaLabel: "Read the Node.js docs",
    ctaHref: "/docs#node-api",
    guideHref: "/guides/node-js-background-removal",
    sections: [
      {
        title: "Open one remover and reuse it",
        paragraphs: [
          "bgcut creates a native local runtime. Keep the instance alive across related work instead of constructing a new model session for every image.",
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
        title: "Process files, directories, and iterables",
        paragraphs: [
          "removeMany accepts files, directories, iterables, and async iterables. It processes inputs sequentially and yields each item as it completes.",
          "Per-image failures are yielded with the source instead of forcing every later input to be discarded.",
        ],
      },
      {
        title: "Choose the engine only when the caller cares",
        paragraphs: [
          "The default auto engine tries native WebGPU and can use CPU if runtime creation cannot use WebGPU. Use gpu or cpu when your environment requires one path.",
          "An explicit GPU requirement is not silently changed to CPU.",
        ],
      },
    ],
  },
  "intent-background-removal-cli": {
    page: "intent-background-removal-cli",
    slug: "background-removal-cli",
    title: "Background removal CLI for local image processing",
    description:
      "Remove image backgrounds from the command line with bgcut. Process one file, several files, or directories locally with PNG, WebP, or JPEG output.",
    summary:
      "Use the bgcut CLI for shell scripts, build jobs, local automation, and file-in/file-out workflows.",
    ctaLabel: "Read the CLI docs",
    ctaHref: "/docs#cli",
    guideHref: "/guides/batch-background-removal-cli",
    sections: [
      {
        title: "Run it without a global install",
        paragraphs: [
          "A one-off command can process an image with the published bgcut package. PNG is the default output.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut photo.jpg
npx bgcut photo.jpg -o portrait.png`,
        },
      },
      {
        title: "Choose output and engine constraints",
        paragraphs: [
          "WebP output is lossless and can preserve transparency. JPEG is flattened onto white because JPEG has no alpha channel.",
          "Automatic native mode tries WebGPU and can use CPU if runtime creation cannot use WebGPU. Explicit GPU and CPU flags keep that choice strict.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut photo.jpg --webp
npx bgcut photo.jpg --gpu
npx bgcut photo.jpg --cpu`,
        },
      },
      {
        title: "Keep the image local",
        paragraphs: [
          "The CLI runs the model on the machine where the command executes. It does not upload the source image to a bgcut inference backend.",
        ],
      },
    ],
  },
  "intent-batch-background-remover": {
    page: "intent-batch-background-remover",
    slug: "batch-background-remover",
    title: "Batch background remover for files and folders",
    description:
      "Remove backgrounds from multiple images or recursive directories with bgcut. Reuse one warm local runtime from the CLI or Node.js API.",
    summary:
      "Use one local runtime for a set of images instead of starting a separate inference process for every file.",
    ctaLabel: "See batch examples",
    ctaHref: "/guides/batch-background-removal-cli",
    guideHref: "/guides/batch-background-removal-cli",
    sections: [
      {
        title: "Batch from the command line",
        paragraphs: [
          "Pass several files in one command or give bgcut a directory. Directory input is scanned recursively for supported images.",
        ],
        code: {
          language: "shell",
          code: `npx bgcut first.jpg second.png
npx bgcut photos/ -o ./cutouts`,
        },
      },
      {
        title: "Batch from Node.js",
        paragraphs: [
          "removeMany also accepts a directory, iterable, or async iterable. That lets the caller own discovery or stream work from another part of the application.",
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
        title: "Sequential work is deliberate",
        paragraphs: [
          "bgcut processes the batch sequentially and keeps one runtime warm. It does not assume every machine has the memory or GPU capacity to run several model sessions at once.",
        ],
      },
    ],
  },
  "intent-open-source-background-remover": {
    page: "intent-open-source-background-remover",
    slug: "open-source-background-remover",
    title: "Open-source local background remover",
    description:
      "bgcut is an MIT-licensed background remover with a local browser app, CLI, and Node.js API. Inspect the source, run inference locally, and automate it without a hosted bgcut API.",
    summary:
      "bgcut is built in public and licensed under MIT. The project covers an interactive browser remover plus local developer interfaces.",
    ctaLabel: "View bgcut on GitHub",
    ctaHref: "https://github.com/jhomra21/bgcut",
    guideHref: "/guides/how-local-background-removal-works",
    sections: [
      {
        title: "One project, several local interfaces",
        paragraphs: [
          "The hosted browser app runs inference in the browser. The CLI and Node.js API use the native runtime on the machine running the process.",
          "That gives end users and application developers different interfaces without requiring a bgcut-hosted inference endpoint.",
        ],
      },
      {
        title: "MIT licensed",
        paragraphs: [
          "The repository and npm package declare the MIT license. Review the licenses of models and third-party dependencies for the way you plan to distribute or deploy the complete system.",
        ],
      },
      {
        title: "The implementation is inspectable",
        paragraphs: [
          "The repository includes browser inference, native Node and CLI paths, model verification, deployment code, docs, benchmark tooling, and the website.",
          "For a technical walk-through of decode, normalization, inference, matte restoration, and export, read the local background-removal guide.",
        ],
      },
    ],
  },
};

export const isIntentPage = (page: string): page is IntentPageId =>
  Object.hasOwn(INTENT_PAGES, page);
