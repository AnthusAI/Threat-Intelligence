import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import type { Plugin } from "vite";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(storybookDir, "..");

function fixJsonImportMimeType(): Plugin {
  return {
    name: "storybook-fix-json-import-mime",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!/\.json(?:\?|&).*import/.test(url)) {
          next();
          return;
        }
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => {
          if (
            typeof name === "string" &&
            name.toLowerCase() === "content-type" &&
            value === "application/json"
          ) {
            return originalSetHeader("content-type", "text/javascript");
          }
          return originalSetHeader(name, value);
        };
        next();
      });
    },
  };
}

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../publications/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-onboarding",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(config) {
    config.plugins = [...(config.plugins ?? []), fixJsonImportMimeType()];
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": projectRoot,
      "next/font/google": path.join(storybookDir, "mocks/next-font-google.ts"),
    };
    config.esbuild = {
      ...config.esbuild,
      jsx: "automatic",
    };
    config.define = {
      ...config.define,
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.NEXT_PUBLIC_PAPYRUS_SITE_BRAND": JSON.stringify("threat-intelligence"),
      "process.env.NEXT_PUBLIC_PAPYRUS_VIDEO_MODE": JSON.stringify("preview"),
    };
    return config;
  },
  staticDirs: ["../public"],
};
export default config;
