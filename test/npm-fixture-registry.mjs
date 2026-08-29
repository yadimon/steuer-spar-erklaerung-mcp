import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const [manifestArgument, tarballArgument, readyArgument] = process.argv.slice(2);
if (!manifestArgument || !tarballArgument || !readyArgument) {
  throw new Error("Aufruf: npm-fixture-registry <package.json> <tarball> <ready.json>");
}
const manifest = JSON.parse(readFileSync(resolve(manifestArgument), "utf8"));
const tarball = readFileSync(resolve(tarballArgument));
const shasum = createHash("sha1").update(tarball).digest("hex");
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/api.tgz") {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": tarball.length,
    });
    response.end(tarball);
    return;
  }
  let requestedPackage = "";
  try { requestedPackage = decodeURIComponent(path.slice(1)); } catch { /* 404 unten */ }
  if (requestedPackage === manifest.name) {
    const address = server.address();
    if (!address || typeof address !== "object") throw new Error("Fixture-Registry ist nicht gebunden.");
    const body = JSON.stringify({
      name: manifest.name,
      "dist-tags": { latest: manifest.version },
      versions: {
        [manifest.version]: {
          ...manifest,
          dist: {
            tarball: `http://127.0.0.1:${address.port}/api.tgz`,
            shasum,
            integrity,
          },
        },
      },
    });
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    response.end(body);
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: `not found: ${basename(path)}` }));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Fixture-Registry erhielt keinen Port.");
  writeFileSync(resolve(readyArgument), `${JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}` })}\n`, "utf8");
});
