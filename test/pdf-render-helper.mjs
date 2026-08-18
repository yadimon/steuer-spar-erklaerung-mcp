import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function minimalPdf() {
  const stream = "BT /F1 24 Tf 72 720 Td (SSE PDF smoke) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

const root = mkdtempSync(join(tmpdir(), "sse-pdf-render-"));
try {
  const pdf = join(root, "minimal.pdf");
  const output = join(root, "output");
  mkdirSync(output);
  writeFileSync(pdf, minimalPdf(), "ascii");
  const powershell = join(
    process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
  );
  const run = () => spawnSync(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    "powershell/render-pdf.ps1", "-Path", pdf, "-OutputDirectory", output, "-Width", "800", "-MaxPages", "2",
  ], { encoding: "utf8", windowsHide: true, timeout: 20_000 });

  const first = run();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const result = JSON.parse(first.stdout.trim());
  assert.equal(result.ok, true, result.error);
  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.files, ["minimal-page-0001.png"]);
  const png = join(output, result.files[0]);
  assert(existsSync(png));
  assert.deepEqual([...readFileSync(png).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const collision = run();
  assert.equal(collision.status, 0, collision.stderr || collision.stdout);
  const collisionResult = JSON.parse(collision.stdout.trim());
  assert.equal(collisionResult.ok, false);
  assert.match(collisionResult.error, /exist|already|vorhanden/iu);
  assert.deepEqual(collisionResult.createdFiles, []);
  const source = readFileSync("powershell/render-pdf.ps1", "utf8");
  assert.match(source, /\[Console\]::Out\.Flush\(\)[\s\S]*\[Environment\]::Exit\(0\)\s*$/u,
    "WinRT-Finalisierung muss nach vollstaendigem stdout umgangen werden");
  process.stdout.write("PDF-Renderer: native Ein-Seiten-PNG-Erzeugung und create-only Kollision bestanden\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
