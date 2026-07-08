#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const outputPath = path.join(
  projectRoot,
  "publications/threat_intelligence/videoml/seed-video-scripts.json",
);

const python = `import json
from publications.threat_intelligence.videoml.video_pipeline import EDITION_OVERVIEW_SLUG
from publications.threat_intelligence.videoml.videos_dsl import (
    generate_videoml_items_from_seed,
    parse_video_script_editorial,
    videoml_item_slug,
)

scripts = {}
for record in generate_videoml_items_from_seed():
    if record.get("modelName") != "Item":
        continue
    item = record.get("expected") or {}
    if item.get("type") != "videoml":
        continue
    video_script = parse_video_script_editorial(item.get("editorial"))
    if not video_script:
        continue
    target = video_script.get("target") if isinstance(video_script.get("target"), dict) else {}
    target_kind = str(target.get("kind") or "article")
    if target_kind == "edition":
        target_slug = EDITION_OVERVIEW_SLUG
    else:
        target_slug = str(target.get("articleSlug") or "").strip()
    if not target_slug:
        continue
    scripts[target_slug] = {
        "videomlSlug": videoml_item_slug(target_slug),
        "targetKind": target_kind,
        "dsl": str(video_script["dsl"]),
    }

print(json.dumps({"scripts": scripts}, ensure_ascii=False))
`;

const pythonPath = path.join(os.tmpdir(), `papyrus-export-seed-video-scripts-${process.pid}.py`);
fs.writeFileSync(pythonPath, python, "utf8");

try {
  const stdout = execSync(`poetry run python ${JSON.stringify(pythonPath)}`, {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: [path.join(projectRoot, "src"), projectRoot].join(path.delimiter),
    },
  });

  const payload = JSON.parse(stdout);
  const output = {
    generatedAt: new Date().toISOString(),
    ...payload,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(output.scripts).length} video scripts to ${outputPath}`);
} finally {
  fs.unlinkSync(pythonPath);
}
