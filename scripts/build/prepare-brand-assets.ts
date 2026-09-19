import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

const assetsDirectory = resolve(import.meta.dir, "../../assets/brand");

const publicDirectory = resolve(import.meta.dir, "../../public");

const encoded = await readFile(
  resolve(assetsDirectory, "bgcut-icon.png.b64"),
  "utf8",
);

const icon = Buffer.from(encoded.trim(), "base64");

await Promise.all([
  sharp(icon)
    .resize(48, 48)
    .png({ palette: true })
    .toFile(resolve(publicDirectory, "favicon-48x48.png")),
  sharp(icon)
    .resize(180, 180)
    .flatten({ background: "#ffffff" })
    .png({ palette: true })
    .toFile(resolve(publicDirectory, "apple-touch-icon.png")),
  sharp(icon)
    .resize(192, 192)
    .png({ palette: true })
    .toFile(resolve(publicDirectory, "icon-192x192.png")),
  sharp(icon)
    .resize(512, 512)
    .png({ palette: true })
    .toFile(resolve(publicDirectory, "icon-512x512.png")),
]);

const socialIcon = await sharp(icon)
  .resize(280, 280)
  .png({ palette: true })
  .toBuffer();

await sharp({
  create: {
    width: 1200,
    height: 630,
    channels: 4,
    background: "#ffffff",
  },
})
  .composite([{ input: socialIcon, gravity: "center" }])
  .png({ palette: true })
  .toFile(resolve(publicDirectory, "og-image.png"));

console.log("Prepared bgcut favicon, app icons, and social preview.");
