import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
}

async function main() {
  const distDir = path.resolve("dist");
  const cesiumDir = path.join(distDir, "cesium");

  const mappings = [
    ["Assets", "Assets"],
    ["Workers", "Workers"],
    ["Widgets", "Widgets"]
  ];

  if (!(await exists(cesiumDir))) {
    console.warn(`[postbuild] 未找到 ${cesiumDir}，跳过 Cesium 资源复制。`);
    return;
  }

  for (const [from, to] of mappings) {
    const src = path.join(cesiumDir, from);
    const dest = path.join(distDir, to);
    if (await exists(src)) {
      await copyDir(src, dest);
      console.log(`[postbuild] Copied ${from} -> dist/${to}`);
    } else {
      console.warn(`[postbuild] 缺少 ${src}，无法复制到 dist/${to}`);
    }
  }
}

await main();

