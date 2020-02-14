puppeteer-brillo
================

Puppeteer tools to help you scrape websites

### Functions

- `getText(el: ElementHandle): Promise<string>` read the innerText from an element handle.
- `saveScreenshotAndHtml(page: Page, label: string): Promise<void>` Only enabled when `process.env.DEBUG` is set. Captures a screenshot of the current page and the html structure, saving them to files.
- `waitForText(page: Page, value: string | string[], opts: { timeout: number }): Promise<string>` Wait up to `timeout` ms for `value` to appear as text in the page. If `value` is an array, wait for any of it's entries to appear. Returns the value found, or throws a TimeoutError.
- `findAllWithText(page: Page, selector: string: value: string | RegExp, opts: { timeout?: number, exact?: boolean, scope?: ElementHandle } = {})` find all elements within `page` matching `selector` that contain `value` as text. If `exact` is true, the element must contain exactly that text. If `scope` is passed, only consider elements within that DOM subtree. If `timeout` is passed, wait for up to that long (ms) to see if such an element appears.
- `findOneWithText(...)` just like `findAllWithText`, but errors if no match is found, and warns if more than one is found.
- `furthestAncestorWithout(child: ElementHandle, childToAvoid: ElementHandle): Promise<ElementHandle | null>` Return the earliest ancestor of `child` that does not contain the `avoid` element.
- `nearestParentLike(child: ElementHandle, selector: string): Promise<ElementHandle | null>` find the closest ancestor to `child` that matches `selector`.
- `commonAncestor(a: ElementHandle, b: ElementHandle): Promise<ElementHandle | null>` find the closest element that contains both `a` and `b`.
- `waitForNetworkIdle(page: Page, idleMs: number, opts: NetworkIdleOptions): Promise<void>` Attach network listeners to watch for outstanding requests. Resolve once all are settled. Set `opts.maxInflightRequests` to a positive number to allow resolving while there are still requests outstanding. Set `opts.skipRequest` to determine that some requests are not worth waiting for.
- `whileWaitingForNetworkIdle<T>(page: Page, idleMs: number, opts: NetworkIdleOptions, action: () => Promise<T>): Promise<T>` Attach network listeners to watch for outstanding requests, call `action`, and then resolve once all outstanding requests have returned. Useful to ensure that data fetched in response to a button click has all arrived on the page.
