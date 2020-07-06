import { ElementHandle, Page, JSHandle, Request } from "puppeteer";
// @ts-ignore
import { TimeoutError } from 'puppeteer/lib/cjs/api';
import { writeFile as writeFileCb } from "fs";
import { promisify } from "util";
import { sleep } from './utils';

const writeFile = promisify(writeFileCb);

export function getText(el: ElementHandle<Element>) {
  return el.getProperty("innerText").then(it => it.jsonValue()) as Promise<
    string
  >;
}

export async function saveScreenshotAndHtml(
  page: Page,
  label: string
): Promise<void> {
  if (!process.env.DEBUG) return;
  try {
    await page.screenshot({ path: `${label}.png` });
    console.debug(`caught screenshot as ${label}.png`);
    const stringifiedPage = await page.evaluate(
      () => document.body && document.body.outerHTML
    );
    await writeFile(`${label}.html`, stringifiedPage);
  } catch (err) {
    console.debug("unable to capture screenshot and/or html");
    console.info(err);
  }
}

/**
 * Wait up to `timeout` ms for `value` to appear as text in the page.
 * if `value` is an array, wait for any of it's entries to appear.
 * returns the value found, or throws a TimeoutError
 */
export function waitForText(
  page: Page,
  value: string | Array<string>,
  opts = { timeout: 30000 }
) {
  if (!Array.isArray(value)) {
    value = [value];
  }
  return page
    .waitForFunction(
      value =>
        document.body &&
        value.find((v: string) => document.body.innerText.includes(v)),
      opts,
      value
    )
    .then(j => j.jsonValue());
}

function evaluateRegex(page: Page, regex: RegExp): Promise<JSHandle> {
  const stringify = regex.toString();

  // tslint:disable-next-line:no-eval
  return page.evaluateHandle(v => eval(v), stringify);
}

export async function findAllWithText(
  page: Page,
  selector: string,
  _value: string | RegExp,
  opts: { timeout?: number; exact?: boolean; scope?: ElementHandle } = {}
) {
  // Find all elements within `page` matching `selector` that contain `value` as text.
  let value: string | JSHandle;
  if (_value instanceof RegExp) {
    value = await evaluateRegex(page, _value);
  } else {
    value = _value;
  }

  // if `timeout` is passed, wait for up to that long (ms) to see if such an element appears.
  // if `scope` is passed, limit the search to the subtree contained by that element.
  if (opts.timeout) {
    try {
      await page.waitForFunction(
        (value, selector, exact, scope) => {
          const elem: HTMLElement = scope || document;
          let test;

          if (value instanceof RegExp) {
            test = (tag: Element) => value.test(tag.textContent || "");
          } else if (exact) {
            test = (tag: Element) => (tag.textContent || "").trim() === value;
          } else {
            test = (tag: Element) => (tag.textContent || "").includes(value);
          }

          return (
            Array.from(elem.querySelectorAll(selector)).filter(test).length > 0
          );
        },
        { timeout: opts.timeout },
        value,
        selector,
        opts.exact || false,
        opts.scope || null
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        return [];
      }
      throw err;
    }
  }

  const handles = await page.evaluateHandle(
    (value, selector, exact, scope) => {
      const elem: HTMLElement = scope || document;
      let test;

      if (value instanceof RegExp) {
        test = (tag: Element) => value.test(tag.textContent || "");
      } else if (exact) {
        test = (tag: Element) => (tag.textContent || "").trim() === value;
      } else {
        test = (tag: Element) => (tag.textContent || "").includes(value);
      }

      return Array.from(elem.querySelectorAll(selector)).filter(test);
    },
    value,
    selector,
    opts.exact || false,
    opts.scope || null
  );
  const props = await handles.getProperties();
  return Array.from(props)
    .map(([_, h]) => h.asElement())
    .filter(e => e);
}

export async function findOneWithText(
  page: Page,
  selector: string,
  value: string | RegExp,
  opts: { timeout?: number; exact?: boolean; scope?: ElementHandle } = {}
): Promise<ElementHandle> {
  const items = await findAllWithText(page, selector, value, opts);
  const item = items[0];
  if (!item) {
    throw new Error(
      `Expected to find a "${selector}" containing the text "${value}"`
    );
  }
  if (items.length > 1) {
    console.warn(
      `Expected to find a single "${selector}" containing the text "${value}". Found ${items.length}.`
    );
  }
  return item;
}

/**
 * Return an ancestor that does not contain the `avoid` element.
 */
export function furthestAncestorWithout(
  child: ElementHandle,
  childToAvoid: ElementHandle
): Promise<ElementHandle | null> {
  return child
    .executionContext()
    .evaluateHandle(
      (child: HTMLElement, toAvoid: HTMLElement) => {
        let curr = child;
        while (
          curr &&
          curr.parentElement &&
          !curr.parentElement.contains(toAvoid)
        ) {
          curr = curr.parentElement;
        }
        return curr;
      },
      child,
      childToAvoid
    )
    .then(h => h.asElement());
}

export function nearestParentLike(child: ElementHandle, selector: string) {
  return child
    .executionContext()
    .evaluateHandle(
      (child, selector) => {
        var curr = child.parentElement;
        while (curr) {
          if (curr.matches(selector)) return curr;
          curr = curr.parentElement;
        }
        return null;
      },
      child,
      selector
    )
    .then(h => h.asElement());
}

export function commonAncestor(
  a: ElementHandle,
  b: ElementHandle
): Promise<ElementHandle | null> {
  return a
    .executionContext()
    .evaluateHandle(
      (a, b) => {
        function parents(node: Node | null) {
          var nodes = [];
          while (node) {
            nodes.unshift(node);
            node = node.parentNode;
          }
          return nodes;
        }

        var a_parents = parents(a);
        var b_parents = parents(b);

        if (a_parents[0] != b_parents[0]) return null;

        var min_length = Math.min(a_parents.length, b_parents.length);
        for (var i = 0; i < min_length; i++) {
          if (a_parents[i] != b_parents[i]) {
            // the lineages diverge!
            return a_parents[i - 1]; //return last common parent before digergence
          }
        }
        return null;
      },
      a,
      b
    )
    .then(h => h.asElement());
}

export async function whileWaitingForNetworkIdle<T>(
  page: Page,
  idleMs: number,
  opts: NetworkIdleOptions,
  action: () => Promise<T>
): Promise<T> {
  const networkIdleP = waitForNetworkIdle(page, idleMs, opts);
  console.debug("listening for network idle");
  const result = await action();
  await sleep(100);
  console.debug("action completed");
  await networkIdleP;
  console.debug("network idle, returning");
  return result;
}

type NetworkIdleOptions = {
  maxInflightRequests?: number;
  skipRequest?: (r: Request) => boolean;
};

export function waitForNetworkIdle(
  page: Page,
  idleMs: number,
  opts: NetworkIdleOptions = {}
) {
  const skipRequest = opts.skipRequest || (() => false);
  const maxInflightRequests = opts.maxInflightRequests || 0;
  // gracias https://github.com/GoogleChrome/puppeteer/issues/1353#issuecomment-356561654
  page.on("request", onRequestStarted);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFinished);

  let inflight: string[] = [];
  let fulfill: () => void;
  let promise = new Promise(x => (fulfill = x));
  console.debug("scheduling onTimeoutDone");
  let timeoutId: NodeJS.Timeout | null = setTimeout(onTimeoutDone, idleMs);
  return promise;

  function onTimeoutDone() {
    page.removeListener("request", onRequestStarted);
    page.removeListener("requestfinished", onRequestFinished);
    page.removeListener("requestfailed", onRequestFinished);
    console.debug("removed all handlers, fulfilling promise");
    fulfill();
  }

  function onRequestStarted(req: Request) {
    if (skipRequest(req)) return;
    inflight.push(req.url());
    console.debug(`new req: ${req.url()} (total: ${inflight})`);
    if (inflight.length > maxInflightRequests && timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function onRequestFinished(req: Request) {
    if (skipRequest(req)) return;
    console.debug(
      `req completed: ${req.url()} (total: ${Math.max(0, inflight.length - 1)})`
    );
    const existingReqIndex = inflight.indexOf(req.url());
    if (existingReqIndex !== -1) {
      inflight.splice(existingReqIndex, 1);
    }
    console.debug(
      `inflight ${inflight}, maxInflight ${maxInflightRequests}, timeoutId ${timeoutId}`
    );
    if (inflight.length <= maxInflightRequests && timeoutId === null) {
      console.debug(
        `${inflight} <= ${maxInflightRequests}, so scheduling onTimeoutDone`
      );
      timeoutId = setTimeout(onTimeoutDone, idleMs);
    }
  }
}
