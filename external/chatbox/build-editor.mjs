import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const result = await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["./editor-source.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "../js/chat-code-editor.js",
  tsconfigRaw: {},
  legalComments: "eof",
  write: false,
  plugins: [
    {
      name: "workspace-reader",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => ({
          path: args.path.startsWith(".")
            ? path.resolve(
                args.importer
                  ? path.dirname(args.importer)
                  : fileURLToPath(new URL(".", import.meta.url)),
                args.path,
              )
            : fileURLToPath(import.meta.resolve(args.path)),
          namespace: "workspace",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "workspace" },
          async (args) => ({
            contents: await readFile(args.path, "utf8"),
            loader: "js",
          }),
        );
      },
    },
  ],
});
await writeFile(
  new URL("../js/chat-code-editor.js", import.meta.url),
  result.outputFiles[0].contents,
);
