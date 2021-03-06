import puppeteer from "puppeteer";

let browser: puppeteer.Browser | null = null;
let browserP: Promise<puppeteer.Browser> | null = null;
let livePages = 0;
let closeBrowserTimeout: NodeJS.Timeout | null = null;

export async function getPage(opts: puppeteer.LaunchOptions = {}): Promise<puppeteer.Page> {
  cancelCloseBrowser();
  if (!browser && !browserP) {
    // in the time spent awaiting puppeteer.launch,
    // another thread of execution might also attempt to get a page.
    // in that scenario, we would accidentally launch two browsers,
    // and one would never be cleaned up. Thereforce, we synchronously
    // assign to browserP during the time that we're awaiting the launch.
    // This is an instance of the request coalescing pattern, if you want
    // to read more about it.
    browserP = puppeteer.launch(opts);
    browser = await browserP;
    browserP = null;
  } else if (browserP) {
    browser = await browserP;
  }
  const page = await browser!.newPage();
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

export function forceCloseBrowser() {
  if (!browser) return Promise.resolve(); // browser already closed
  const p = browser.close();
  browser = null;
  cancelCloseBrowser(); // cancel any scheduled behavior in the future
  return p;
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
