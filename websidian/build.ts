const result = await Bun.build({
  entrypoints: ["./src/client/index.html"],
  outdir: "./build",
  minify: true,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Build complete: ${result.outputs.length} files`);
