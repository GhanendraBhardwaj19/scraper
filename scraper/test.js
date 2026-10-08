import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: false,
});

const page = await browser.newPage();

await page.goto("https://www.google.com/maps");

console.log("Google Maps opened successfully.");

await page.waitForTimeout(10000);

await browser.close();