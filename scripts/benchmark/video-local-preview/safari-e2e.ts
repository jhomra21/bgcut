import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = process.argv[2];

const origin = process.argv[3] ?? "http://127.0.0.1:5191";

const output = resolve(process.argv[4] ?? "/tmp/bgcut-safari-video");

const driver = process.argv[5] ?? "http://127.0.0.1:4450";

const fixtureOrigin = process.argv[6] ?? "http://127.0.0.1:4196";

if (fixture === undefined) {
  throw new Error("Usage: bun run safari-e2e.ts <bear.mp4> [app-origin] [artifact-dir] [webdriver-origin]");
}

await mkdir(output, { recursive: true });

const request = async (path: string, method: string, body?: string) => {
  const response = await fetch(driver + path, {
    method, headers: { "content-type": "application/json" }, body,
  });

  const result = await response.json();

  if (!response.ok) throw new Error(JSON.stringify(result));

  return result.value;
};

const session = await request("/session", "POST", JSON.stringify({
  capabilities: { alwaysMatch: { browserName: "safari" } },
}));

const base = `/session/${session.sessionId}`;

const command = (path: string, body: string) => request(base + path, "POST", body);

const evaluate = (script: string) => command("/execute/sync", JSON.stringify({ script, args: [] }));

const evaluateAsync = (script: string) => command("/execute/async", JSON.stringify({ script, args: [] }));

const waitFor = async (expression: string, attempts = 150) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(`return Boolean(${expression});`)) return;
    await Bun.sleep(1000);
  }

  throw new Error(`Safari timed out: ${expression}`);
};

const captureState = async (name: string) => {
  const state = await evaluate(`return (() => {
    const input = document.querySelector("#source-file-input");
    const video = document.querySelector(".video-lab-selection-frame video");
    const state = document.querySelector(".video-lab");
    const error = document.querySelector(".error-card");
    return {
      url: location.href,
      title: document.title,
      file: input?.files?.[0] ? {
        name: input.files[0].name, size: input.files[0].size,
        type: input.files[0].type
      } : null,
      editorPresent: Boolean(state),
      editorText: state?.innerText?.slice(0, 2200) ?? null,
      error: error?.innerText ?? null,
      video: video ? {
        readyState: video.readyState, networkState: video.networkState,
        errorCode: video.error?.code ?? null,
        errorMessage: video.error?.message ?? null,
        currentTime: video.currentTime,
        duration: video.duration, paused: video.paused,
        videoWidth: video.videoWidth, videoHeight: video.videoHeight,
        currentSrc: video.currentSrc, className: video.className
      } : null,
      canPlayH264: document.createElement("video").canPlayType(
        'video/mp4; codecs="avc1.64001e"'
      ),
      frameStatus: document.querySelector(".video-lab-frame-status")?.dataset.state,
      modelStatus: document.querySelector(".video-lab-model-status")?.dataset.state
    };
  })();`);

  await Bun.write(`${output}/${name}.json`, JSON.stringify(state, null, 2));
  await screenshot(name);

  return state;
};

const screenshot = async (name: string) => {
  const bytes = await request(base + "/screenshot", "GET");
  await Bun.write(`${output}/${name}.png`, Buffer.from(bytes, "base64"));
};

let sourceStrategy: "webdriver-file-upload" | "browser-file" = "webdriver-file-upload";

let webdriverFileError: string | undefined;

try {
  await command("/url", JSON.stringify({ url: origin }));
  const input = await command("/element", JSON.stringify({ using: "css selector", value: "#source-file-input" }));
  await command(`/element/${input["element-6066-11e4-a52e-4f735466cecf"]}/value`, JSON.stringify({ text: resolve(fixture) }));

  // A Safari WebDriver file can be visible to the input while its bytes are
  // inaccessible to the browser's Blob API. Don't classify that CI-specific
  // filesystem failure as a segmentation or export failure.
  try {
    await waitFor(
      'document.querySelector(".video-lab-selection-frame video.is-ready") || document.querySelector(".error-card")',
      35,
    );

    const uploadState = await evaluate(`return {
      ready: Boolean(document.querySelector(".video-lab-selection-frame video.is-ready")),
      error: document.querySelector(".error-card")?.textContent?.trim() ?? null
    };`);

    if (!uploadState.ready) {
      webdriverFileError = uploadState.error ?? "WebDriver file was not accepted";
      await captureState("webdriver-file-failure");

      if (!webdriverFileError.includes("I/O read operation failed")) {
        throw new Error(`Unexpected Safari upload error: ${webdriverFileError}`);
      }

      sourceStrategy = "browser-file";

      const synthetic = await evaluateAsync(`
        const done = arguments[arguments.length - 1];
        fetch(${JSON.stringify(fixtureOrigin + "/quality/bear.mp4")})
          .then(response => {
            if (!response.ok) throw new Error("Fixture fetch failed: HTTP " + response.status);
            return response.blob();
          })
          .then(blob => {
            const file = new File([blob], "bear.mp4", {type: "video/mp4"});
            const data = new DataTransfer();
            data.items.add(file);
            const input = document.querySelector("#source-file-input");
            input.files = data.files;
            input.dispatchEvent(new Event("change", {bubbles: true}));
            done({size: file.size, type: file.type});
          })
          .catch(error => done({error: String(error)}));
      `);

      if (synthetic.error || synthetic.size < 100000) {
        throw new Error(`Could not create Safari browser File: ${JSON.stringify(synthetic)}`);
      }

      await waitFor('document.querySelector(".video-lab-selection-frame video.is-ready")', 35);
    }
  } catch (error) {
    const state = await captureState("selection-readiness-failure");
    throw new Error(`Safari selection never became ready: ${JSON.stringify(state)}`, {
      cause: error
    });
  }

  const cold = await evaluate(`return {
    model:document.querySelector(".video-lab-model-status").textContent,
    format:document.querySelector("select").value,
    defaultEnd:document.querySelectorAll("input[type=number]")[1].valueAsNumber,
    exportText:document.querySelector(".video-lab-export-notices").textContent
  };`);

  if (cold.format !== "mp4" || !cold.model || !cold.exportText.includes("no transparency")) {
    throw new Error("Safari needs explicit readiness and a clearly opaque MP4 default.");
  }

  await screenshot("initial-readiness");
  await waitFor('document.querySelector(".video-lab-frame-status")?.dataset.state==="ready"');
  await evaluate(`const action=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Remove background");
    if(action.getBoundingClientRect().bottom>innerHeight) throw new Error("Start action requires scrolling");
    if(document.querySelector(".video-lab-export-details").open) throw new Error("Settings should be collapsed");`);
  await evaluate(`const el=document.querySelector(".video-lab-selection-surface");
    const r=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown",{
      bubbles:true,isPrimary:true,pointerType:"mouse",button:0,
      clientX:r.left+r.width*.4,clientY:r.top+r.height*.65
    }));`);
  await waitFor('document.querySelector(".video-lab-preview-status")?.dataset.state==="ready"');

  const refinement = await evaluateAsync(`const done=arguments[arguments.length-1];
    const c=document.querySelector(".video-lab-mask-overlay");const before=c.toDataURL();
    const el=document.querySelector(".video-lab-selection-surface");const r=el.getBoundingClientRect();
    for(const x of [.41,.42,.43])el.dispatchEvent(new PointerEvent("pointerdown",{
      bubbles:true,isPrimary:true,pointerType:"mouse",button:0,
      clientX:r.left+r.width*x,clientY:r.top+r.height*.65
    }));
    setTimeout(()=>done({
      retained:c.toDataURL()===before,
      status:document.querySelector(".video-lab-preview-status").dataset.state,
      points:document.querySelectorAll(".video-lab-point").length
    }),60);`);

  if (!refinement.retained || refinement.status !== "updating" || refinement.points !== 4) {
    throw new Error("Rapid refinement flashed or dropped the latest prompts.");
  }

  await waitFor('document.querySelector(".video-lab-preview-status")?.dataset.state==="ready"');
  await screenshot("latest-mask");
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Remove background").click();');
  await waitFor('document.querySelector("a[download]") || document.querySelector(".error-card")');
  const filename = await evaluate('return document.querySelector("a[download]")?.download;');

  if (!filename?.endsWith(".mp4")) throw new Error("Safari default export failed.");

  const fusedGraphRequested = await evaluate(`return performance.getEntriesByType("resource").some(entry =>
    new URL(entry.name).pathname === "/video-model/sam21-tiny/tracked-step.onnx");`);

  if (!fusedGraphRequested) throw new Error("Safari did not request the fused SAM tracking graph.");

  const playback = await evaluateAsync(`const done=arguments[arguments.length-1];
    const v=document.querySelector(".video-lab-video");v.muted=true;
    v.play().then(()=>{const before=v.currentTime;
      setTimeout(()=>done({before,after:v.currentTime,paused:v.paused,error:v.error?.message??null}),800);
    }).catch(e=>done({error:String(e)}));`);

  if (playback.error || playback.paused || !(playback.after > playback.before)) {
    throw new Error("Safari native video playback did not advance.");
  }

  const decoded = await evaluate(`const v=document.querySelector(".video-lab-video");v.pause();
    const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;
    const x=c.getContext("2d");x.drawImage(v,0,0);
    return {width:c.width,height:c.height,background:Array.from(x.getImageData(0,0,1,1).data),
      duplicateStill:!!document.querySelector(".video-lab-preview")};`);

  if (decoded.duplicateStill || decoded.background[3] !== 255 || decoded.background[0] < 240) {
    throw new Error("Export must have an explicit white background and one playable result.");
  }

  const encoded = await evaluateAsync(`const done=arguments[arguments.length-1];
    fetch(document.querySelector("a[download]").href).then(r=>r.blob()).then(blob=>{
      const reader=new FileReader();reader.onload=()=>done(reader.result.split(",")[1]);reader.readAsDataURL(blob);
    });`);

  await Bun.write(`${output}/bear.mp4`, Buffer.from(encoded, "base64"));
  await screenshot("playable-result");
  await Bun.write(`${output}/result.json`, JSON.stringify({ sourceStrategy, webdriverFileError, cold, refinement, filename, fusedGraphRequested, playback, decoded }, null, 2));
  console.log(`Safari preview and native playback acceptance passed: ${output}`);
} finally {
  await request(base, "DELETE");
}
