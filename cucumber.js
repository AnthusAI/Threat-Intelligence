module.exports = {
  default: {
    paths: ["features/**/*.feature"],
    require: ["features/support/**/*.js", "features/step_definitions/**/*.js"],
    format: ["progress", "summary"],
    publishQuiet: true,
  },
};
