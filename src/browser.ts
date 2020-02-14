import puppeteer from "puppeteer";

let browser: puppeteer.Browser | null = null;
let livePages = 0;
let closeBrowserTimeout: NodeJS.Timeout | null = null;

export async function getPage(opts: puppeteer.LaunchOptions = {}): Promise<puppeteer.Page> {
  cancelCloseBrowser();
  if (!browser) {
    browser = await puppeteer.launch(opts);
  }
  const page = await browser.newPage();
  livePages += 1;
  return page;
}

export async function disposePage(page: puppeteer.Page): Promise<void> {
  await page.close();
  livePages -= 1;
  if (livePages === 0) {
    scheduleCloseBrowser();
  }
}

function _closeBrowser() {
  if (livePages > 0) return;
  if (!browser) return;
  browser.close(); // this is a promise, but no one is listening
  browser = null; // synchronously set browser to be null, so if
  // someone asks for a new page we know we need to make a browser.
  // these two operations would be a "critical section", but node is
  // single-threaded, so there's no need to orchestrate it as such.
}

function scheduleCloseBrowser() {
  closeBrowserTimeout = setTimeout(_closeBrowser, 1000);
}

function cancelCloseBrowser() {
  if (!closeBrowserTimeout) return;
  clearTimeout(closeBrowserTimeout);
}

type FuncWithPage<T> = (page: puppeteer.Page) => Promise<T>;

/**
 * Take the function passed, await the next page,
 * call the function with the page as the first argument.
 * Log any errors, dispose of the page and return the function result.
 */
export async function withPage<T>(action: FuncWithPage<T>, opts: puppeteer.LaunchOptions = {}): Promise<T> {
  const page = await getPage(opts);
  const actionP = action(page);
  actionP
    .then(() => disposePage(page))
    .catch(async err => {
      console.debug("about to capture html for page (error)");
      try {
        const stringifiedPage = await page.evaluate(
          () => document.body && document.body.outerHTML
        );
        err.html = stringifiedPage;
      } catch (e) {
        console.error(err);
        console.error("Unable to capture html for this page");
      }
      await disposePage(page);
      throw err;
    });
  return actionP;
}
