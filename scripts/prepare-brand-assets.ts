import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

const assetsDirectory = resolve(import.meta.dir, "../assets");

const publicDirectory = resolve(import.meta.dir, "../public");

const readBase64Asset = async (name: string): Promise<Buffer> => {
  const encoded = await readFile(resolve(assetsDirectory, name), "utf8");

  return Buffer.from(encoded.trim(), "base64");
};

const [icon, logo] = await Promise.all([
  readBase64Asset("bgcut-icon.png.b64"),
  readBase64Asset("bgcut-logo.png.b64"),
]);

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
  writeFile(resolve(publicDirectory, "bgcut-logo.png"), logo),
]);

const socialLogo = await sharp(logo)
  .resize({ width: 900, withoutEnlargement: true })
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
  .composite([{ input: socialLogo, gravity: "center" }])
  .png({ palette: true })
  .toFile(resolve(publicDirectory, "og-image.png"));

console.log("Prepared bgcut favicon, app icons, header logo, and social preview.");
