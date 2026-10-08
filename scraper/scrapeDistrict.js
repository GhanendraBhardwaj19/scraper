import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

import {
  COLUMNS,
  startBrowser,
  searchGoogleMaps,
  collectAllListingUrls,
  openListing,
  scrapeDetails,
} from "./scraper.js";

// ----------------------------------------
// SETTINGS
// ----------------------------------------
const args = process.argv.slice(2);

const DISTRICT = args[0] || "Agra";
const STATE = args[1] || "Uttar Pradesh";

const KEYWORD_TEMPLATES = [
  "ayurvedic doctors in {city}",
  "ayurvedic clinic in {city}",
  "ayurvedic hospital in {city}",
  "ayurvedic in {city}",
];

const HEADLESS = false;

// Keep this at 5 for testing first.
// Later change it to null for all results.
const MAX_PER_KEYWORD = null;

// ----------------------------------------
// Helpers
// ----------------------------------------

function slugify(name) {
  return name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

async function writeExcel(outPath, rows) {
  const workbook = new ExcelJS.Workbook();

  const worksheet = workbook.addWorksheet("Places");

  worksheet.columns = COLUMNS.map((column) => ({
    header: column,
    key: column,
    width: 28,
  }));

  for (const row of rows) {
    worksheet.addRow(row);
  }

  await workbook.xlsx.writeFile(outPath);
}

function qualityReport(city, rows, failed) {
  const keyFields = [
    "Name",
    "Phone",
    "Address",
    "Rating",
    "Category",
    "Website",
  ];

  const total = rows.length;

  console.log(`\n=== ${city}: ${total} unique places ===`);

  if (failed > 0) {
    console.log(`Listings that would not load: ${failed}`);
  }

  for (const field of keyFields) {
    const filled = rows.filter((row) => {
      return String(row[field] || "").trim();
    }).length;

    const percentage =
      total > 0
        ? Math.floor((filled / total) * 100)
        : 0;

    console.log(
      `${field.padEnd(12)} ${filled}/${total} (${percentage}%)`
    );
  }
}

// ----------------------------------------
// Main district scraper
// ----------------------------------------

async function scrapeDistrict() {
  const { browser, page } = await startBrowser(HEADLESS);

  try {
    console.log(`[*] State   : ${STATE}`);
    console.log(`[*] District: ${DISTRICT}`);

    // ------------------------------------
    // 1. Search all keywords
    // ------------------------------------

    const urlKeyword = new Map();

    for (const template of KEYWORD_TEMPLATES) {
      const keyword = template.replace(
        "{city}",
        DISTRICT
      );

      console.log(`\nSearching keyword: ${keyword}`);

      let urls = [];

      try {
        await searchGoogleMaps(page, keyword);

        urls = await collectAllListingUrls(
          page,
          MAX_PER_KEYWORD
        );
      } catch (error) {
        console.log(
          `[!] Keyword failed: ${keyword}`
        );

        console.log(error.message);

        continue;
      }

      let newCount = 0;

      for (const url of urls) {
        if (!urlKeyword.has(url)) {
          urlKeyword.set(url, keyword);
          newCount++;
        }
      }

      console.log(
        `'${keyword}' -> ${urls.length} found, ${newCount} new`
      );
    }

    // ------------------------------------
    // 2. Check if anything was found
    // ------------------------------------

    if (urlKeyword.size === 0) {
      throw new Error(
        "No Google Maps listings were found."
      );
    }

    console.log(
      `\n[*] ${urlKeyword.size} unique places to open\n`
    );

    // ------------------------------------
    // 3. Scrape every unique listing
    // ------------------------------------

    const rows = [];
    const seen = new Set();

    let failed = 0;
    let processed = 0;

    for (const [url, keyword] of urlKeyword) {
      processed++;

      console.log(
        `Scraping ${processed}/${urlKeyword.size}...`
      );

      let data = null;

      // One retry, same idea as Python version
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const loaded = await openListing(
            page,
            url
          );

          if (!loaded) {
            console.log(
              `  Attempt ${attempt} failed to load`
            );

            continue;
          }

          data = await scrapeDetails(
            page,
            keyword
          );

          if (data?.Name) {
            break;
          }
        } catch (error) {
          console.log(
            `  Attempt ${attempt} error: ${error.message}`
          );

          await page.waitForTimeout(1000);
        }
      }

      if (!data?.Name) {
        console.log("  ✗ Failed");

        failed++;

        continue;
      }

      // --------------------------------
      // Deduplicate by Name + Address
      // --------------------------------

      const uniqueKey =
        `${data.Name}`.trim().toLowerCase() +
        "|" +
        `${data.Address}`.trim().toLowerCase();

      if (seen.has(uniqueKey)) {
        console.log(
          `  ↳ Duplicate skipped: ${data.Name}`
        );

        continue;
      }

      seen.add(uniqueKey);
      rows.push(data);

      console.log(`  ✓ ${data.Name}`);
    }

    // ------------------------------------
    // 4. Refuse to save empty file
    // ------------------------------------

    if (rows.length === 0) {
      throw new Error(
        "No valid listings were scraped."
      );
    }

    // ------------------------------------
    // 5. Create output folder
    // ------------------------------------

    const outputDir = path.join(
      process.cwd(),
      "output",
      slugify(STATE)
    );

    fs.mkdirSync(outputDir, {
      recursive: true,
    });

    const outputPath = path.join(
      outputDir,
      `${slugify(DISTRICT)}.xlsx`
    );

    // ------------------------------------
    // 6. Save Excel
    // ------------------------------------

    await writeExcel(outputPath, rows);

    // ------------------------------------
    // 7. Quality report
    // ------------------------------------

    qualityReport(
      DISTRICT,
      rows,
      failed
    );

    console.log(
      `\n[+] Saved -> ${outputPath}`
    );
  } catch (error) {
    console.error("\n[ERROR]");
    console.error(error);
  } finally {
    await browser.close();
  }
}

scrapeDistrict();