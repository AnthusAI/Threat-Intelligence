const { After, setDefaultTimeout, setWorldConstructor } = require("@cucumber/cucumber");
const { chromium } = require("playwright");

setDefaultTimeout(60_000);

class PapyrusWorld {
  constructor() {
    this.baseUrl = process.env.PAPYRUS_BASE_URL ?? "http://localhost:3001";
    this.browser = null;
    this.page = null;
    this.consoleErrors = [];
    this.currentScenarioId = null;
  }

  async openScenario(scenarioId, width, height) {
    this.currentScenarioId = scenarioId;
    await this.openPath(`/?scenario=${encodeURIComponent(scenarioId)}`, width, height);
    await this.page.waitForFunction(
      (expectedScenarioId) => (
        window.__PAPYRUS_LAYOUT__ &&
        window.__PAPYRUS_SCENARIO__ === expectedScenarioId &&
        document.querySelector(".paper-page--active")
      ),
      scenarioId,
      { timeout: 15_000 },
    );
  }

  async openPath(path, width, height) {
    this.consoleErrors = [];
    this.browser = await chromium.launch({
      headless: process.env.PAPYRUS_HEADLESS !== "false",
    });
    this.page = await this.browser.newPage({
      viewport: { width, height },
    });
    this.page.on("console", (message) => {
      if (message.type() === "error") {
        this.consoleErrors.push(message.text());
      }
    });

    const url = new URL(path, this.baseUrl);
    await this.page.goto(url.toString(), { waitUntil: "load" });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    this.browser = null;
    this.page = null;
  }
}

setWorldConstructor(PapyrusWorld);

After(async function () {
  await this.close();
});
