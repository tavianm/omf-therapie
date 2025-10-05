import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pa11y from "pa11y";

const ROOT = process.cwd();
const LATEST_DIR = path.join(ROOT, "public", "reports", "latest");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

async function run() {

  const sitemap = await readFile(path.join(ROOT, "public", "sitemap.txt"), "utf-8");
  const urls = sitemap.split("\n").map((u) => u.trim()).filter(Boolean);

  const results = [];

  await rm(LATEST_DIR, { recursive: true, force: true }).catch(() => { });

  await mkdir(LATEST_DIR, { recursive: true });

  for (const url of urls) {
    // Run Pa11y programmatically
    const result = await pa11y(url, {
      standard: "WCAG2AA",
      includeWarnings: true,
      // level: 'error' // Uncomment to restrict to errors
    });

    const payload = { url, issues: result.issues };

    // Save JSON result per URL
    const slug = url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_");
    const jsonPath = path.join(LATEST_DIR, `${slug}.pa11y.json`);
    await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf-8");

    const errors = result.issues.filter((i) => i.type === "error").length;
    const warnings = result.issues.filter((i) => i.type === "warning").length;
    results.push({ url, errors, warnings, file: path.basename(jsonPath) });
  }

  const indexHtml = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Rapport a11y - ${timestamp}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 1rem; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: .5rem; }
    th { background: #f6f6f6; text-align: left; }
  </style>
</head>
<body>
  <h1>Rapport accessibilité (Pa11y)</h1>
  <p>Date: ${new Date().toLocaleString("fr-FR")}</p>
  <table>
    <thead><tr><th>URL</th><th>Erreurs</th><th>Avertissements</th><th>JSON</th></tr></thead>
    <tbody>
      ${results.map((r) => `<tr>
        <td><a href="${r.url}">${r.url}</a></td>
        <td>${r.errors}</td>
        <td>${r.warnings}</td>
        <td><a href="./${r.file}" download>${r.file}</a></td>
      </tr>`).join("")}
    </tbody>
  </table>
</body>
</html>`;

  // Update latest
  await writeFile(path.join(LATEST_DIR, "index.html"), indexHtml, "utf-8");

  console.log(`Audit done. Report at: public/reports/latest`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
