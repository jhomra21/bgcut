import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = process.argv[2];

const origin = process.argv[3] ?? "http://127.0.0.1:5184";

const output = resolve(process.argv[4] ?? "/tmp/bgcut-video-ui");

if (fixture === undefined) {
  throw new Error("Usage: bun run scripts/benchmark/video-local-preview/ui-e2e.ts <bear-video> [origin] [artifact-dir]");
}

await mkdir(output, { recursive: true });

const session = `bgcut-video-ui-${process.pid}`;

const env = { ...process.env };

delete env.AGENT_BROWSER_CDP;

delete env.AGENT_BROWSER_SESSION;

const browser = async (...args: string[]) => {
  const child = Bun.spawn(["agent-browser", "--session", session, ...args], {
    env, stdout: "pipe", stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) throw new Error(`${args.join(" ")}\n${stdout}\n${stderr}`);

  return stdout;
};

const waitFor = async (expression: string) => {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = await browser("eval", `Boolean(${expression})`);

    if (result.trim() === "true") return;

    await Bun.sleep(1000);
  }

  throw new Error(`Timed out: ${expression}`);
};

const assertMediaFirst = `(() => {
  const editor = document.querySelector(".video-lab");
  const media = editor?.querySelector(".video-lab-selection-frame, .video-lab-preview, .video-lab-video");
  if (!editor || !media || !editor.getAttribute("aria-label") ||
      editor.querySelector("h1,h2,h3,h4,h5,h6")) {
    throw new Error("Video editor must have a nonvisible accessible label and no mode headings.");
  }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const mediaBottom = media.getBoundingClientRect().bottom;
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (!text.textContent.trim() || media.contains(text)) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    const bounds = range.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0 && bounds.top < mediaBottom - 1) {
      throw new Error("Supporting text or controls precede the video: " + text.textContent.trim());
    }
  }
})()`;

try {
  await browser("open", origin);
  await browser("set", "viewport", "1280", "900");
  await browser("upload", "#source-file-input", resolve(fixture));
  await waitFor('document.querySelector(".video-lab-selection-frame video.is-ready")');
  await waitFor('document.querySelector(".video-lab-frame-status")?.dataset.state==="ready"');
  await browser("eval", `(() => {
    const button=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Remove background");
    if(button.getBoundingClientRect().bottom>innerHeight ||
       document.querySelector(".video-lab-export-details")?.open !== false) {
      throw new Error("Primary action must fit the initial viewport and advanced settings must start collapsed.");
    }
  })()`);
  await browser("eval", `(() => {
    if (!document.querySelector(".video-lab-model-status")?.dataset.state) {
      throw new Error("Model preparation must have explicit loading/readiness status before the first click.");
    }
  })()`);
  await browser("eval", `(async () => {
    const video = document.querySelector(".video-lab-selection-frame video");
    const file = await fetch(video.src).then(response => response.blob());
    const { readVideoSourceInfo } = await import("/scripts/benchmark/video-segmentation/media-source.ts");
    const info = await readVideoSourceInfo(file);
    const end = document.querySelectorAll("input[type=number]")[1].valueAsNumber;
    if (end !== Math.min(15, info.duration)) {
      throw new Error("Default trim must use the precise primary-video span, not native duration: " +
        JSON.stringify({native:video.duration,end,info}));
    }
  })()`);
  await browser("eval", assertMediaFirst);
  await browser("screenshot", `${output}/initial-readiness.png`, "--full");
  await browser("eval", `(() => {
    if (document.querySelectorAll('input[type=file]').length !== 1 ||
        document.querySelector(".video-lab-drop") || document.querySelector(".drop-trigger")) {
      throw new Error("Video did not replace the single main intake.");
    }
    const start = document.querySelector('input[type=number]');
    start.value = "0";
    start.dispatchEvent(new Event("change", {bubbles:true}));
  })()`);
  await waitFor('document.querySelector(".video-lab-selection-frame video.is-ready")');
  await browser("eval", `(() => {
    const el = document.querySelector(".video-lab-selection-surface");
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles:true, isPrimary:true, pointerType:"mouse", button:0,
      clientX:r.left+r.width*0.40, clientY:r.top+r.height*0.65
    }));
  })()`);
  await waitFor('document.querySelector(".video-lab-preview-status")?.textContent.includes("Highlighted")');
  await browser("eval", `(async () => {
    const c = document.querySelector(".video-lab-mask-overlay");
    const before = c.toDataURL();
    const el = document.querySelector(".video-lab-selection-surface");
    const r = el.getBoundingClientRect();
    for (const x of [0.41,0.42,0.43]) {
      el.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles:true,isPrimary:true,pointerType:"mouse",button:0,
        clientX:r.left+r.width*x,clientY:r.top+r.height*.65
      }));
    }
    await new Promise(resolve => setTimeout(resolve, 60));
    if (c.toDataURL() !== before) throw new Error("Pending refinements cleared the last valid same-frame mask.");
    const run = [...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Remove background");
    if (!run.disabled) throw new Error("Stale preview must not authorize export.");
  })()`);
  await waitFor('document.querySelector(".video-lab-preview-status")?.textContent.includes("Highlighted")');
  await browser("eval", `(() => {
    const c = document.querySelector(".video-lab-mask-overlay");
    const pixels = c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    if (!pixels.some((value,index) => index%4===3 && value>0)) throw new Error("Empty mask preview");
  })()`);
  await browser("screenshot", `${output}/desktop-mask.png`, "--full");
  await browser("set", "viewport", "390", "844");
  await browser("eval", `(() => {
    window.scrollTo(0,0);
    const button=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Remove background");
    if(button.getBoundingClientRect().bottom>innerHeight) throw new Error("Primary action requires mobile scrolling.");
  })()`);
  await browser("eval", assertMediaFirst);
  await browser("screenshot", `${output}/mobile-mask.png`, "--full");
  await browser("eval", `(() => {
    if (document.documentElement.scrollWidth > innerWidth) throw new Error("Mobile overflow");
  })()`);
  await browser("find", "role", "button", "click", "--name", "Remove background");
  await browser("eval", assertMediaFirst);
  await waitFor('document.querySelector("a[download]")');
  await browser("eval", `(() => {
    if (document.querySelector(".video-lab-preview")) throw new Error("Playable result must not duplicate the still preview.");
    if (!document.querySelector(".video-lab-video[controls]")) throw new Error("Missing playable export.");
  })()`);
  await browser("eval", assertMediaFirst);
  await browser("screenshot", `${output}/mobile-result.png`, "--full");

  const result = await browser("eval", `(() => {
    const link = document.querySelector("a[download]");
    if (!link.download.endsWith(".webm")) throw new Error("Wrong export filename");
    const fusedGraph = "/video-model/sam21-tiny/tracked-step.onnx";
    const requested = performance.getEntriesByType("resource").some(entry =>
      new URL(entry.name).pathname === fusedGraph);
    if (!requested) throw new Error("The Solid editor never requested the fused SAM tracking graph.");
    return {
      filename:link.download,
      result:document.querySelector(".video-lab-result-row").textContent,
      fusedGraphRequested:requested,
    };
  })()`);

  await Bun.write(`${output}/result.json`, result);

  // Changing media while a preview is being scheduled must invalidate it.
  await browser("find", "role", "button", "click", "--name", "Change subject");
  await waitFor('document.querySelector(".video-lab-selection-frame video.is-ready")');
  await waitFor('document.querySelector(".video-lab-preview-status")?.dataset.state==="ready"');
  await browser("eval", 'document.querySelector(".video-lab-refine").open=true');
  await browser("eval", `(async () => {
    const c=document.querySelector(".video-lab-mask-overlay");
    const before=c.toDataURL();
    [...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Subject 1").click();
    await new Promise(resolve=>setTimeout(resolve,60));
    if(c.toDataURL()!==before || document.querySelector(".video-lab-preview-status").dataset.state!=="ready") {
      throw new Error("Subject switching recomputed or flashed its selection.");
    }
    [...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Clear").click();
    await new Promise(resolve=>setTimeout(resolve,60));
    if(c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)) {
      throw new Error("Cleared subject left a ghost mask.");
    }
    const el=document.querySelector(".video-lab-selection-surface");const r=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,isPrimary:true,pointerType:"mouse",button:0,
      clientX:r.left+r.width*.4,clientY:r.top+r.height*.65}));
    const scrub=document.querySelector('input[type=range]');scrub.value=String(1/6);
    scrub.dispatchEvent(new Event("input",{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,500));
    if(document.querySelectorAll(".video-lab-point").length ||
       c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)) {
      throw new Error("Seek allowed stale prompts or mask to reappear.");
    }
  })()`);
  await browser("eval", `(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["invalid"], "broken.png", {type:"image/png"}));
    document.querySelector(".drop-surface").dispatchEvent(new DragEvent("drop", {bubbles:true,dataTransfer:transfer}));
  })()`);
  await waitFor('document.querySelector(".empty-error")');
  await browser("eval", `(() => {
    if (document.querySelector(".video-lab")) throw new Error("Stale video workspace after image switch");
  })()`);
  console.log(`Unified video UI acceptance passed. Artifacts: ${output}`);
} finally {
  await browser("close");
}
