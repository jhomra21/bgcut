export const PrivacyPage = () => (
  <main class="page-content legal-shell">
    <article class="legal-page">
      <div class="eyebrow">Privacy</div>
      <h1>Your images stay on your device.</h1>
      <p class="legal-updated">Last updated September 19, 2026</p>

      <section>
        <h3>Image processing</h3>
        <p>
          The hosted app runs background removal in your browser. The local app serves the same
          removal workflow from <code>127.0.0.1</code> without the hosted site's navigation,
          documentation, changelog, or legal pages. Image inference still runs in the browser. The CLI and
          Node API process images in the local Node process. bgcut does not send source images,
          decoded pixels, masks, or generated outputs to a bgcut inference service.
        </p>
      </section>

      <section>
        <h3>Network requests</h3>
        <p>
          The hosted app fetches its app files, ONNX Runtime files, and pinned model from bgcut.dev
          through Cloudflare. The CLI, local app server, and Node API may download the pinned model
          from a bgcut GitHub release when the local cache is missing or invalid. Cloudflare and
          GitHub can receive request metadata such as IP address, user agent, requested URL, and
          request time.
        </p>
      </section>

      <section>
        <h3>Accounts, cookies, and analytics</h3>
        <p>
          bgcut's application code does not create accounts, set application cookies, or send
          product analytics or telemetry.
        </p>
      </section>

      <section>
        <h3>Third-party services</h3>
        <p>
          GitHub and npm links take you to third-party sites. Cloudflare delivers bgcut.dev, and
          GitHub serves native model downloads. Their privacy policies apply to those requests.
        </p>
      </section>

      <section>
        <h3>Changes and questions</h3>
        <p>
          The date above changes when this policy changes. Open an issue in the bgcut GitHub
          repository with privacy questions.
        </p>
      </section>
    </article>
  </main>
);
