#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const babulusRoot = process.env.BABULUS_ROOT || path.join(process.env.HOME || "", "Projects/Babulus");
const require = createRequire(import.meta.url);

const REACT_18_VERSION = "18.3.1";
const VENDOR_URLS = {
  react: `https://unpkg.com/react@${REACT_18_VERSION}/umd/react.production.min.js`,
  reactDom: `https://unpkg.com/react-dom@${REACT_18_VERSION}/umd/react-dom.production.min.js`,
};

function resolveEsbuild() {
  const candidates = [
    path.join(projectRoot, "node_modules/esbuild"),
    path.join(babulusRoot, "node_modules/esbuild"),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      continue;
    }
  }
  throw new Error("esbuild not found. Run npm install in Papyrus or set BABULUS_ROOT to a Babulus checkout with dependencies.");
}

async function ensureVendorFile(filePath, url) {
  if (fs.existsSync(filePath)) return;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
}

async function ensureReactVendor() {
  const vendorDir = path.join(projectRoot, "public/videoml/vendor");
  await ensureVendorFile(path.join(vendorDir, "react.production.min.js"), VENDOR_URLS.react);
  await ensureVendorFile(path.join(vendorDir, "react-dom.production.min.js"), VENDOR_URLS.reactDom);
}

const globalsPlugin = {
  name: "globals",
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "globals" }));
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: "react-dom", namespace: "globals" }));
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: "react-dom/client", namespace: "globals" }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: "react/jsx-runtime", namespace: "globals" }));
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: "react/jsx-dev-runtime", namespace: "globals" }));

    const jsxRuntimeShim = `
var React = window.React;
function jsx(type, config, maybeKey) {
  var props = config || {};
  var key = maybeKey !== undefined ? maybeKey : props.key;
  if (key !== undefined) {
    props = Object.assign({}, props, { key: key });
  }
  return React.createElement(type, props);
}
exports.Fragment = React.Fragment;
exports.jsx = jsx;
exports.jsxs = jsx;
`;

    build.onLoad({ filter: /.*/, namespace: "globals" }, (args) => {
      if (args.path === "react") {
        return { contents: "module.exports = window.React", loader: "js" };
      }
      if (args.path === "react-dom" || args.path === "react-dom/client") {
        return { contents: "module.exports = window.ReactDOM", loader: "js" };
      }
      if (args.path === "react/jsx-runtime" || args.path === "react/jsx-dev-runtime") {
        return { contents: jsxRuntimeShim, loader: "js" };
      }
      return null;
    });

    build.onResolve({ filter: /^babulus-browser-bundle$/ }, () => ({
      path: path.join(babulusRoot, "scripts/browser-bundle.tsx"),
    }));

    build.onResolve({ filter: /^babulus-renderer\// }, (args) => {
      const subpath = args.path.replace(/^babulus-renderer\//, "");
      const base = path.join(babulusRoot, "packages/renderer/src", subpath);
      if (fs.existsSync(`${base}.tsx`)) return { path: `${base}.tsx` };
      if (fs.existsSync(`${base}.ts`)) return { path: `${base}.ts` };
      return { path: base };
    });

    build.onResolve({ filter: /^babulus-shared\// }, (args) => {
      const subpath = args.path.replace(/^babulus-shared\//, "");
      const base = path.join(babulusRoot, "packages/shared/src", subpath);
      if (fs.existsSync(`${base}.tsx`)) return { path: `${base}.tsx` };
      if (fs.existsSync(`${base}.ts`)) return { path: `${base}.ts` };
      return { path: base };
    });

    build.onResolve({ filter: /^babulus-videoml-player\// }, (args) => {
      const subpath = args.path.replace(/^babulus-videoml-player\//, "");
      const base = path.join(babulusRoot, "packages/videoml-player/src", subpath);
      if (fs.existsSync(`${base}.tsx`)) return { path: `${base}.tsx` };
      if (fs.existsSync(`${base}.ts`)) return { path: `${base}.ts` };
      return { path: base };
    });
  },
};

async function bundle() {
  if (!fs.existsSync(path.join(babulusRoot, "scripts/browser-bundle.tsx"))) {
    throw new Error(`Babulus checkout not found at ${babulusRoot}. Set BABULUS_ROOT.`);
  }

  await ensureReactVendor();

  const esbuild = resolveEsbuild();
  const outDir = path.join(projectRoot, "public/videoml");
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, "ti-preview-bundle.js");

  await esbuild.build({
    entryPoints: [path.join(projectRoot, "publications/threat_intelligence/videoml/preview-bundle.tsx")],
    bundle: true,
    format: "iife",
    outfile,
    platform: "browser",
    jsx: "automatic",
    absWorkingDir: projectRoot,
    plugins: [globalsPlugin],
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
    },
    sourcemap: true,
    logLevel: "info",
  });

  console.error(`✓ TI VideoML preview bundle: ${outfile}`);
}

bundle().catch((error) => {
  console.error(error);
  process.exit(1);
});
