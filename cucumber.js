module.exports = {
  default: {
    paths: ["features/**/*.feature"],
    require: ["features/support/**/*.js", "features/step_definitions/**/*.js"],
    tags: "not @live-agent",
    format: ["progress", "summary"],
    publishQuiet: true,
  },
  agentLive: {
    paths: ["features/console-agent-live.feature"],
    require: ["features/support/**/*.js", "features/step_definitions/**/*.js"],
    tags: "@live-agent",
    format: ["progress", "summary"],
    publishQuiet: true,
  },
};
