import fs from "fs";
import path from "path";

const baseUrl = "https://omf-therapie.fr";
const blogsDir = path.join("src", "utils", "blogs");

// Ensure the public directory exists
if (!fs.existsSync("public")) {
  fs.mkdirSync("public");
}

// Base static pages
const basePages = ["", "/contact", '/accessibilite', "/blog",];

// Extract blog slugs from TS files to build blog URLs
const blogUrls = [];
if (fs.existsSync(blogsDir)) {
  const files = fs.readdirSync(blogsDir).filter((f) => f.endsWith(".ts"));
  const slugRegex = /slug:\s*"([^"]+)"/;

  for (const f of files) {
    const content = fs.readFileSync(path.join(blogsDir, f), "utf-8");
    const match = content.match(slugRegex);
    if (match && match[1]) {
      blogUrls.push(`/blog/${match[1]}`);
    }
  }
}

const allPages = [...basePages, ...blogUrls];
const now = new Date().toISOString();

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${allPages
    .map(
      (page) => `
    <url>
      <loc>${baseUrl}${page}</loc>
      <lastmod>${now}</lastmod>
      <changefreq>weekly</changefreq>
      <priority>${page === "" ? "1.0" : "0.8"}</priority>
    </url>`
    )
    .join("\n")}
</urlset>`;

const sitemapTxt = allPages.map((page) => `${baseUrl}${page}`).join("\n");

fs.writeFileSync("public/sitemap.xml", sitemapXml);
fs.writeFileSync("public/sitemap.txt", sitemapTxt);
console.log(`Sitemaps generated with blog URLs (${blogUrls.length} blogs, ${allPages.length} total pages).`);
