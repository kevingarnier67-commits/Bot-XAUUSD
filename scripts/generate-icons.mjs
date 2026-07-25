// One-off asset generator: rasterizes scripts/icon-source*.svg into public/icons/*.png.
// Not run automatically (requires `sharp`, installed ad hoc). Re-run manually after
// editing the SVG sources, then commit the resulting PNGs.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "..", "public", "icons");

const standard = readFileSync(path.join(dir, "icon-source.svg"));
const maskable = readFileSync(path.join(dir, "icon-source-maskable.svg"));

const jobs = [
  { src: standard, size: 192, out: "icon-192.png" },
  { src: standard, size: 512, out: "icon-512.png" },
  { src: standard, size: 180, out: "apple-touch-icon.png" },
  { src: standard, size: 32, out: "favicon-32.png" },
  { src: maskable, size: 192, out: "icon-maskable-192.png" },
  { src: maskable, size: 512, out: "icon-maskable-512.png" },
];

for (const job of jobs) {
  await sharp(job.src, { density: 384 })
    .resize(job.size, job.size)
    .png()
    .toFile(path.join(outDir, job.out));
  console.log(`wrote ${job.out}`);
}
