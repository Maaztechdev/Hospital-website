const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const widths = [1920, 1440, 1280, 1024, 768, 375];
  const results = [];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 1200 });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(700);

    const entry = await page.evaluate(() => {
      const selectors = [
        'header nav[aria-label="Primary"] a[href="/"]',
        'header nav[aria-label="Primary"] a[href="/about"]',
        'header nav[aria-label="Primary"] a[href="/departments"]',
        'header nav[aria-label="Primary"] a[href="/doctors"]',
        'header nav[aria-label="Primary"] a[href="/services"]',
        'header nav[aria-label="Primary"] a[href="/blog"]',
        'header nav[aria-label="Primary"] a[href="/contact"]',
        'header a[href^="tel:"]',
        'header a[aria-label="Dashboard"]',
        'header a[href="/contact#emergency"]',
        'header a[href="/appointment"]',
        'header button[aria-label="Open menu"]',
        'header button[aria-label="Close menu"]'
      ];

      const elements = [...document.querySelectorAll(selectors.join(', '))].filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      });

      const overlapPairs = [];
      for (let i = 0; i < elements.length; i++) {
        const a = elements[i].getBoundingClientRect();
        for (let j = i + 1; j < elements.length; j++) {
          const b = elements[j].getBoundingClientRect();
          const sameRow = Math.abs(a.top - b.top) < 8 || Math.abs(a.bottom - b.bottom) < 8;
          const horizontalOverlap = !(a.right <= b.left + 1 || b.right <= a.left + 1);
          const overlap = sameRow && horizontalOverlap;

          if (overlap) {
            overlapPairs.push({
              a: (elements[i].textContent || elements[i].getAttribute('aria-label') || elements[i].tagName).replace(/\s+/g, ' ').trim().slice(0, 24),
              b: (elements[j].textContent || elements[j].getAttribute('aria-label') || elements[j].tagName).replace(/\s+/g, ' ').trim().slice(0, 24),
              aRect: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
              bRect: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }
            });
          }
        }
      }

      const header = document.querySelector('header');
      const nav = document.querySelector('nav[aria-label="Primary"]');
      return {
        width: window.innerWidth,
        scrollbar: document.documentElement.scrollWidth > window.innerWidth + 1,
        overlapPairs: overlapPairs,
        overlapCount: overlapPairs.length,
        navOverflow: nav ? nav.getBoundingClientRect().right < nav.scrollWidth + 2 : false,
        headerRect: header ? { left: header.getBoundingClientRect().left, right: header.getBoundingClientRect().right } : null,
        navRect: nav ? { left: nav.getBoundingClientRect().left, right: nav.getBoundingClientRect().right } : null
      };
    });

    results.push(entry);

    if (width === 1440) {
      await page.screenshot({ path: 'test-results/navbar-1440.png', fullPage: false });
    }
    if (width === 768) {
      await page.screenshot({ path: 'test-results/navbar-768.png', fullPage: false });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
