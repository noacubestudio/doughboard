#!/usr/bin/env node

// this is server intended to serve index.html
// run with:
// node server.mjs
// then open http://localhost:8888/
import { createServer } from "node:http";
import { URL } from "node:url";
import { join } from "node:path";
import { stat, readFile } from "node:fs/promises";

const port = process.argv[2] ? Number.parseInt(process.argv[2], 10) : 8888;
const mimeTypes = {
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  js: "text/javascript",
  mjs: "text/javascript",
  wasm: "application/wasm",
  css: "text/css",
};

createServer(async (request, response) => {
  const uri = new URL(request.url || "", `http://${request.headers.host}`)
    .pathname;
  let filename = join(process.cwd(), uri);

  try {
    const fileStat = await stat(filename);

    if (fileStat.isDirectory()) filename += "/index.html";

    const file = await readFile(filename, "binary");
    const mimeType = mimeTypes[filename.split(".").pop() || ""] || "text/plain";

    response.writeHead(200, {
      "Content-Type": mimeType,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    response.write(file, "binary");
    response.end();
  } catch (err) {
    if (err.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.write("404 Not Found\n");
    } else {
      response.writeHead(500, {
        "Content-Type": "text/plain",
        "Cross-Origin-Opener-Policy": "same-origin unsafe-allow-outgoing",
      });
      response.write(`${err}\n`);
    }
    response.end();
  }
}).listen(port);

console.log(
  `Static file server running at\n  => http://localhost:${port}/\nCTRL + C to shutdown`
);
