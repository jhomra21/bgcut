export const COMPARISON_PAGE_IDS = [
  "comparison-remove-bg",
  "comparison-remove-bg-api",
  "comparison-bg0",
  "comparison-imgly",
  "comparison-rembg",
] as const;

export type ComparisonPageId = (typeof COMPARISON_PAGE_IDS)[number];

export type ComparisonRow = {
  readonly label: string;
  readonly bgcut: string;
  readonly other: string;
};

export type ComparisonSection = {
  readonly title: string;
  readonly paragraphs: readonly string[];
};

export type ComparisonSource = {
  readonly label: string;
  readonly href: string;
};

export type Comparison = {
  readonly page: ComparisonPageId;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly otherName: string;
  readonly checkedAt: string;
  readonly intro: string;
  readonly rows: readonly ComparisonRow[];
  readonly chooseBgcut: readonly string[];
  readonly chooseOther: readonly string[];
  readonly sections: readonly ComparisonSection[];
  readonly sources: readonly ComparisonSource[];
};

const checkedAt = "2026-09-29";

export const COMPARISONS: Readonly<Record<ComparisonPageId, Comparison>> = {
  "comparison-remove-bg": {
    page: "comparison-remove-bg",
    slug: "remove-bg-alternative",
    title: "A local remove.bg alternative",
    description:
      "Compare bgcut with the remove.bg workflow if you want local browser, CLI, or Node.js background removal instead of sending images to a hosted removal service.",
    otherName: "remove.bg",
    checkedAt,
    intro:
      "bgcut and remove.bg solve the same visible task with different deployment models. bgcut runs inference on your device. remove.bg has been a hosted service and says its standalone background removal moves into Canva after December 1, 2026.",
    rows: [
      {
        label: "Where inference runs",
        bgcut: "On the user's machine in the browser or native runtime.",
        other: "Hosted service. remove.bg is moving its background-removal functionality into Canva.",
      },
      {
        label: "Interfaces",
        bgcut: "Browser app, CLI, and Node.js API.",
        other: "Web product and API during the current transition, with Canva named as the destination for background removal.",
      },
      {
        label: "Image transfer",
        bgcut: "Source images are not sent to a bgcut inference backend.",
        other: "The hosted workflow sends image data to the service for processing.",
      },
      {
        label: "Usage billing",
        bgcut: "No bgcut per-image service charge because inference runs locally.",
        other: "Hosted-service account and product terms apply.",
      },
      {
        label: "Automation model",
        bgcut: "Run the CLI or Node.js API on infrastructure you control.",
        other: "Use a hosted product or API workflow.",
      },
    ],
    chooseBgcut: [
      "You want the source image to stay on the machine running the job.",
      "You want browser, command-line, and Node.js choices from the same project.",
      "You prefer local compute over a per-request background-removal service.",
    ],
    chooseOther: [
      "You want a managed hosted workflow and do not want to operate local inference.",
      "Your existing process depends on provider-managed infrastructure or integrations.",
      "You are already moving the workflow into Canva or another hosted product.",
    ],
    sections: [
      {
        title: "This is an architecture change, not a drop-in swap",
        paragraphs: [
          "Moving from a hosted remover to bgcut changes where the work happens. A browser user runs the model on their device. A CLI or Node.js job runs it on the machine where the process executes.",
          "That can remove per-image service calls and image uploads from the workflow, but your machine now supplies the compute, memory, model cache, and runtime.",
        ],
      },
      {
        title: "Test your real images before migrating",
        paragraphs: [
          "Do not assume two segmentation systems produce identical masks. Test the image categories that matter to you, including difficult hair, fur, transparent objects, and edge cases from your own catalog.",
          "Compare output at the destination resolution and format. A migration decision should use the images and environment you will actually run.",
        ],
      },
    ],
    sources: [
      {
        label: "remove.bg FAQ about the Canva move",
        href: "https://www.remove.bg/faq",
      },
      {
        label: "bgcut source and runtime documentation",
        href: "https://github.com/jhomra21/bgcut",
      },
    ],
  },
  "comparison-remove-bg-api": {
    page: "comparison-remove-bg-api",
    slug: "remove-bg-api-alternative",
    title: "remove.bg API alternative for local processing",
    description:
      "Use bgcut as a local Node.js or CLI alternative to a remove.bg API workflow. bgcut is not a hosted drop-in HTTP replacement.",
    otherName: "remove.bg API",
    checkedAt,
    intro:
      "bgcut is relevant to remove.bg API users only when local execution fits the system. It does not expose a hosted endpoint that accepts the remove.bg request format.",
    rows: [
      {
        label: "Integration",
        bgcut: "Call a local Node.js API or CLI.",
        other: "Call a hosted HTTP API.",
      },
      {
        label: "Drop-in compatibility",
        bgcut: "No. Application code has to change.",
        other: "Existing integrations use remove.bg's HTTP contract until the service transition.",
      },
      {
        label: "Compute",
        bgcut: "Your machine runs the model.",
        other: "The provider runs the model.",
      },
      {
        label: "Source image",
        bgcut: "Stays on the machine running bgcut.",
        other: "Is sent to the hosted endpoint for processing.",
      },
      {
        label: "Batch work",
        bgcut: "removeMany and CLI directory input reuse one local runtime sequentially.",
        other: "Batch behavior depends on the hosted API and migration target.",
      },
    ],
    chooseBgcut: [
      "You control the machine that processes the images.",
      "Local execution is acceptable for your throughput and deployment model.",
      "You want to remove a hosted background-removal dependency from the request path.",
    ],
    chooseOther: [
      "You need a public HTTP service that your clients can call.",
      "You need provider-managed scaling rather than local model execution.",
      "You need request compatibility with the existing remove.bg API contract.",
    ],
    sections: [
      {
        title: "What the migration looks like in Node.js",
        paragraphs: [
          "Instead of constructing an HTTP request, open one bgcut instance inside the process that owns the job. Reuse it across related images, then close it.",
          "For a directory or stream of inputs, removeMany yields each result as it finishes. Per-image failures can be handled without throwing away the rest of the batch.",
        ],
      },
      {
        title: "Do not hide the deployment change",
        paragraphs: [
          "A local library moves resource use into your application environment. Budget for model download and cache, runtime startup, CPU or GPU availability, memory, and the time each image takes on that hardware.",
          "If those responsibilities do not fit your application, use a hosted API. bgcut should not be presented as a drop-in service when it is a local runtime.",
        ],
      },
    ],
    sources: [
      {
        label: "remove.bg FAQ about the API transition",
        href: "https://www.remove.bg/faq",
      },
      {
        label: "bgcut Node.js API types",
        href: "https://github.com/jhomra21/bgcut/blob/main/src/node/index.d.ts",
      },
    ],
  },
  "comparison-bg0": {
    page: "comparison-bg0",
    slug: "bg0",
    title: "bgcut vs BG0",
    description:
      "Compare bgcut and BG0 for local browser background removal, package integration, CLI and Node.js use, runtime choices, and open-source licensing.",
    otherName: "BG0",
    checkedAt,
    intro:
      "Both projects can remove image backgrounds locally in the browser without sending the source image to an inference backend. The main difference is scope. BG0 focuses on the browser app and browser library. bgcut also ships a CLI and Node.js API.",
    rows: [
      {
        label: "Hosted browser app",
        bgcut: "Yes. Local WebGPU with WebAssembly fallback.",
        other: "Yes. Local WebGPU with WebAssembly fallback.",
      },
      {
        label: "Browser library",
        bgcut: "The public package is centered on CLI and Node.js use; the hosted app owns its browser runtime.",
        other: "Yes. @bg0/browser is a documented integration package.",
      },
      {
        label: "Node.js API",
        bgcut: "Yes.",
        other: "BG0 documents a browser-only package.",
      },
      {
        label: "CLI",
        bgcut: "Yes, including multiple files and recursive directories.",
        other: "Not part of BG0's documented product scope.",
      },
      {
        label: "Source license",
        bgcut: "MIT.",
        other: "Apache-2.0.",
      },
    ],
    chooseBgcut: [
      "You want a local CLI or Node.js API in addition to the browser tool.",
      "You want one package contract for file and directory automation.",
      "MIT licensing fits your project.",
    ],
    chooseOther: [
      "You specifically want a reusable browser background-removal package.",
      "Your project is browser-only and BG0's package contract fits it.",
      "Apache-2.0 licensing fits your project.",
    ],
    sections: [
      {
        title: "The browser privacy model is similar",
        paragraphs: [
          "BG0 documents local browser inference with no source-image upload, WebGPU when available, and WebAssembly fallback. bgcut follows the same high-level privacy boundary in its hosted browser app.",
          "That means the decision is less about whether either project can run locally and more about which interfaces your application needs.",
        ],
      },
      {
        title: "Compare the package contract before choosing",
        paragraphs: [
          "BG0 exposes @bg0/browser for adding background removal to a web application. bgcut's public Node.js contract is built around bgcut(), removeBackground(), removeMany(), and close().",
          "If your integration is inside a browser application, inspect BG0's library first. If you need Node.js, shell automation, or directories, inspect bgcut's interfaces.",
        ],
      },
    ],
    sources: [
      {
        label: "BG0 repository",
        href: "https://github.com/opencoredev/bg0",
      },
      {
        label: "BG0 documentation",
        href: "https://bg0.dev/docs",
      },
      {
        label: "bgcut repository",
        href: "https://github.com/jhomra21/bgcut",
      },
    ],
  },
  "comparison-imgly": {
    page: "comparison-imgly",
    slug: "imgly-background-removal",
    title: "bgcut vs IMG.LY background removal",
    description:
      "Compare bgcut with @imgly/background-removal and @imgly/background-removal-node for browser and Node.js integration, CLI use, and licensing.",
    otherName: "IMG.LY background removal",
    checkedAt,
    intro:
      "Both projects support local JavaScript background removal. IMG.LY documents separate browser and Node.js packages. bgcut combines a Node.js API with a CLI and also runs the bgcut.dev browser tool.",
    rows: [
      {
        label: "Browser integration",
        bgcut: "Hosted browser app. The public package is not documented as a general browser SDK.",
        other: "@imgly/background-removal is a browser package.",
      },
      {
        label: "Node.js integration",
        bgcut: "The bgcut package exposes the local Node.js object API.",
        other: "@imgly/background-removal-node is a separate Node.js package.",
      },
      {
        label: "CLI",
        bgcut: "Yes.",
        other: "Not part of the JavaScript package README used for this comparison.",
      },
      {
        label: "Batch directories",
        bgcut: "CLI directory input and Node.js removeMany are documented.",
        other: "The JavaScript package README focuses on library integration.",
      },
      {
        label: "Source license",
        bgcut: "MIT.",
        other: "The IMG.LY JavaScript background-removal repository states AGPL, with other licensing available from IMG.LY.",
      },
    ],
    chooseBgcut: [
      "You want a CLI and Node.js API in the same package.",
      "You need documented directory and iterable batch input.",
      "MIT licensing fits your project.",
    ],
    chooseOther: [
      "You want the documented IMG.LY browser package.",
      "You prefer separate browser and Node packages.",
      "Its licensing terms fit your project.",
    ],
    sections: [
      {
        title: "Do not compare only package names",
        paragraphs: [
          "The integration boundary is different. IMG.LY publishes a browser package and a Node.js package. bgcut publishes the bgcut package with CLI and Node.js interfaces while bgcut.dev provides the browser application.",
          "Choose based on where background removal lives in your application and which license you can comply with.",
        ],
      },
      {
        title: "Measure quality and speed yourself",
        paragraphs: [
          "This page does not assign a quality or performance winner. Model choices, runtime versions, device hardware, input dimensions, and preprocessing can change results.",
          "Run both systems on the same source images and record cold start, warm inference, final output dimensions, and edge behavior before making a performance claim.",
        ],
      },
    ],
    sources: [
      {
        label: "IMG.LY background-removal repository",
        href: "https://github.com/imgly/background-removal-js",
      },
      {
        label: "@imgly/background-removal on npm",
        href: "https://www.npmjs.com/package/@imgly/background-removal",
      },
      {
        label: "bgcut repository",
        href: "https://github.com/jhomra21/bgcut",
      },
    ],
  },
  "comparison-rembg": {
    page: "comparison-rembg",
    slug: "rembg",
    title: "bgcut vs rembg",
    description:
      "Compare bgcut and rembg for local background removal across JavaScript, Python, CLI, batch, server, Docker, and GPU or CPU deployment choices.",
    otherName: "rembg",
    checkedAt,
    intro:
      "bgcut and rembg both support local background removal and command-line automation, but they fit different application stacks. bgcut targets JavaScript and Node.js. rembg is a Python project with library, CLI, HTTP server, and Docker workflows.",
    rows: [
      {
        label: "Primary language",
        bgcut: "JavaScript and TypeScript package for Node.js, plus the browser app.",
        other: "Python.",
      },
      {
        label: "CLI",
        bgcut: "Yes. Files, multiple inputs, and recursive directories.",
        other: "Yes. rembg documents file, folder, server, binary-stream, and model-management commands.",
      },
      {
        label: "Library",
        bgcut: "Node.js API.",
        other: "Python library.",
      },
      {
        label: "HTTP server",
        bgcut: "No hosted or packaged background-removal HTTP API.",
        other: "rembg documents an HTTP server mode.",
      },
      {
        label: "Container workflow",
        bgcut: "Not the primary documented interface.",
        other: "Docker is a documented option.",
      },
      {
        label: "Source license",
        bgcut: "MIT.",
        other: "MIT.",
      },
    ],
    chooseBgcut: [
      "Your application is JavaScript or TypeScript.",
      "You want the same project for a browser tool, Node.js API, and CLI.",
      "You want removeMany and directory input without adding Python to the application.",
    ],
    chooseOther: [
      "Your application is already Python.",
      "You want rembg's HTTP server or Docker workflow.",
      "You want the model and backend choices documented by the rembg ecosystem.",
    ],
    sections: [
      {
        title: "Language and deployment are the main decision",
        paragraphs: [
          "For a TypeScript application, calling a local Node.js API can be simpler than adding a Python process boundary. For a Python application, rembg can fit directly into the existing environment.",
          "Both projects have command-line options, so shell automation alone does not decide the choice. Look at the surrounding application and the deployment features you need.",
        ],
      },
      {
        title: "Server mode is a real difference",
        paragraphs: [
          "rembg documents an HTTP server. bgcut intentionally documents its Node.js API as a local library, not a hosted service.",
          "If your architecture needs multiple clients to call one background-removal HTTP process, rembg already has that mode. If your Node.js process can own inference directly, bgcut avoids adding that network boundary.",
        ],
      },
    ],
    sources: [
      {
        label: "rembg repository",
        href: "https://github.com/open-mit/rembg",
      },
      {
        label: "bgcut repository",
        href: "https://github.com/jhomra21/bgcut",
      },
    ],
  },
};

export const pathForComparison = (comparison: Comparison): string =>
  comparison.slug.startsWith("remove-bg")
    ? `/${comparison.slug}`
    : `/compare/${comparison.slug}`;

export const isComparisonPage = (page: string): page is ComparisonPageId =>
  Object.hasOwn(COMPARISONS, page);
