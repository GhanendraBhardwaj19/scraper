import { chromium } from "playwright";

export const COLUMNS = [
  "Search Keyword",
  "Name",
  "Rating",
  "Reviews Count",
  "Category",
  "Address",
  "Phone",
  "Website",
  "Plus Code",
  "Hours",
  "Description",
  "Service Options",
  "Google Maps URL",
  "Scraped At",
];

// --------------------------------------------------
// Browser
// --------------------------------------------------

export async function startBrowser(headless = false) {
  const browser = await chromium.launch({
    headless,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    locale: "en-US",
    viewport: {
      width: 1920,
      height: 1080,
    },
  });

  const page = await context.newPage();

  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);

  return {
    browser,
    context,
    page,
  };
}

// --------------------------------------------------
// Small helpers
// --------------------------------------------------

async function safeText(page, selector) {
  try {
    const element = page.locator(selector).first();

    if ((await element.count()) === 0) {
      return "";
    }

    return (await element.innerText()).trim();
  } catch {
    return "";
  }
}

async function safeAttr(page, selector, attribute) {
  try {
    const element = page.locator(selector).first();

    if ((await element.count()) === 0) {
      return "";
    }

    return (
      (await element.getAttribute(attribute)) || ""
    ).trim();
  } catch {
    return "";
  }
}

async function sleep(page, milliseconds) {
  await page.waitForTimeout(milliseconds);
}

// --------------------------------------------------
// Google Maps search
// --------------------------------------------------

export async function searchGoogleMaps(page, keyword) {
  console.log(`Searching: ${keyword}`);

  const url =
    "https://www.google.com/maps/search/" +
    encodeURIComponent(keyword) +
    "?hl=en";

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForSelector(
    'div[role="feed"], div[role="main"]',
    {
      timeout: 30000,
    }
  );

  await sleep(page, 3000);

  console.log("Google Maps results loaded.");
}

// --------------------------------------------------
// Collect first few URLs
// --------------------------------------------------

export async function getFirstListingUrls(
  page,
  limit = 5
) {
  const cards = page.locator("a.hfpxzc");

  await cards.first().waitFor({
    state: "visible",
    timeout: 20000,
  });

  const count = await cards.count();

  const urls = [];
  const seen = new Set();

  for (let i = 0; i < count; i++) {
    const href = await cards.nth(i).getAttribute("href");

    if (
      href &&
      href.includes("/maps/place/") &&
      !seen.has(href)
    ) {
      seen.add(href);
      urls.push(href);
    }

    if (urls.length >= limit) {
      break;
    }
  }

  return urls;
}

// --------------------------------------------------
// Collect ALL listing URLs by scrolling
// --------------------------------------------------

export async function collectAllListingUrls(
  page,
  maxResults = null
) {
  const urls = [];
  const seen = new Set();

  let staleRounds = 0;

  for (let round = 0; round < 200; round++) {
    const cards = page.locator("a.hfpxzc");

    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      const href = await cards
        .nth(i)
        .getAttribute("href");

      if (
        href &&
        href.includes("/maps/place/") &&
        !seen.has(href)
      ) {
        seen.add(href);
        urls.push(href);
      }

      if (
        maxResults &&
        urls.length >= maxResults
      ) {
        return urls.slice(0, maxResults);
      }
    }

    const endMarkers = page.getByText(
      /reached the end of the list/i
    );

    if ((await endMarkers.count()) > 0) {
      break;
    }

    const before = urls.length;

    if (count > 0) {
      try {
        await cards
          .nth(count - 1)
          .scrollIntoViewIfNeeded();
      } catch {
        // Ignore scrolling failure
      }
    }

    const feed = page.locator('div[role="feed"]');

    if ((await feed.count()) > 0) {
      try {
        await feed.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      } catch {
        // Ignore and try page scroll instead
      }
    } else {
      await page.evaluate(() => {
        window.scrollBy(0, 1500);
      });
    }

    await sleep(page, 2200);

    if (urls.length === before) {
      staleRounds++;

      if (staleRounds >= 6) {
        break;
      }
    } else {
      staleRounds = 0;
    }
  }

  return urls;
}

// --------------------------------------------------
// Open individual listing
// --------------------------------------------------

export async function openListing(page, url) {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForSelector("h1.DUwDvf", {
      timeout: 20000,
    });

    await sleep(page, 2000);

    return true;
  } catch {
    return false;
  }
}

// Alias matching the old Python naming
export async function openListingUrl(page, url) {
  return openListing(page, url);
}

// --------------------------------------------------
// Scrape complete listing details
// --------------------------------------------------

export async function scrapeDetails(
  page,
  keyword = ""
) {
  const data = {};

  for (const column of COLUMNS) {
    data[column] = "";
  }

  data["Search Keyword"] = keyword;
  data["Google Maps URL"] = page.url();

  data["Scraped At"] = new Date()
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  // Name
  data.Name =
    (await safeText(page, "h1.DUwDvf")) ||
    (await safeText(page, "h1"));

  // Rating
  data.Rating =
    (await safeAttr(
      page,
      "div.F7nice span[aria-hidden='true']",
      "innerText"
    )) ||
    (await safeText(
      page,
      "div.F7nice span[aria-hidden='true']"
    ));

  // Reviews Count
  data["Reviews Count"] =
    (await safeText(
      page,
      "div.F7nice span[aria-label*='review']"
    )) ||
    (await safeAttr(
      page,
      "div.F7nice span[aria-label*='review']",
      "aria-label"
    ));

  // Category
  data.Category = await safeText(
    page,
    "button[jsaction*='category']"
  );

  // Address
  data.Address = (
    await safeAttr(
      page,
      "button[data-item-id='address']",
      "aria-label"
    )
  ).replace(/^Address:\s*/i, "");

  // Phone
  data.Phone = (
    await safeAttr(
      page,
      "button[data-item-id^='phone']",
      "aria-label"
    )
  ).replace(/^Phone:\s*/i, "");

  // Website
  data.Website = await safeAttr(
    page,
    "a[data-item-id='authority']",
    "href"
  );

  // Plus Code
  data["Plus Code"] = (
    await safeAttr(
      page,
      "button[data-item-id='oloc']",
      "aria-label"
    )
  ).replace(/^Plus code:\s*/i, "");

  // Hours
  let hours = await safeAttr(
    page,
    "button[data-item-id='oh']",
    "aria-label"
  );

  if (!hours) {
    hours = await safeAttr(
      page,
      "div[jsaction*='openhours'], div.t39EBf",
      "aria-label"
    );
  }

  data.Hours = hours
    .replace(/See more hours/gi, "")
    .replace(/^[\s·]+|[\s·]+$/g, "");

  // Description
  data.Description = await safeText(
    page,
    "div.PYvSYb"
  );

  // Service Options
  try {
    const chips = page.locator("div.LTs0Rc");

    const chipCount = await chips.count();

    const serviceOptions = [];

    for (let i = 0; i < chipCount; i++) {
      const label = await chips
        .nth(i)
        .getAttribute("aria-label");

      if (label) {
        serviceOptions.push(label.trim());
      }
    }

    data["Service Options"] =
      serviceOptions.join("; ");
  } catch {
    data["Service Options"] = "";
  }

  return data;
}

// --------------------------------------------------
// Basic details only
// --------------------------------------------------

export async function scrapeBasicDetails(page) {
  const fullData = await scrapeDetails(page);

  return {
    name: fullData.Name,
    address: fullData.Address,
    phone: fullData.Phone,
    mapsUrl: fullData["Google Maps URL"],
  };
}