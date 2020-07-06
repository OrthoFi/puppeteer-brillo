import { readFile as readFileCb } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import {
  getText,
  waitForText,
  findAllWithText,
  findOneWithText,
  furthestAncestorWithout,
  commonAncestor,
  nearestParentLike,
} from './scraping_utils';
// @ts-ignore
import { TimeoutError } from 'puppeteer/lib/cjs/api';
import { sleep } from './utils';
import { withPage, getPage, disposePage } from './browser';
import { Page } from 'puppeteer';

const readFile = promisify(readFileCb);

describe('scraping utils', () => {
  let simple: Page;
  let simpleContent: string;
  beforeAll(async () => {
    simpleContent = await readFile(join(__dirname, 'fixtures', 'simple.html'), {
      encoding: 'utf8',
    });
    simple = await getPage();
    await simple.setContent(simpleContent);
  });
  afterAll(async () => {
    await disposePage(simple);
    await sleep(150); // uhh. wait until the browser closes (see browser.ts:scheduleCloseBrowser)
  });

  describe('getText', () => {
    it('gets the text', async () => {
      const b = await simple.$('b[data-b-in-p');
      const contents = await getText(b!);
      expect(contents).toBe('this is a new paragraph!');
    });

    it('includes nested text', async () => {
      const p = await simple.$('p[data-second]');
      const contents = await getText(p!);
      expect(contents).toMatch(/emphasized text inside a p/);
    });
  });

  describe('waitForText', () => {
    it('resolves with text value', async () => {
      const arrived = await waitForText(simple, 'Another great link');
      expect(arrived).toBe('Another great link');
    });

    it('resolves with correct value when multiple are given', async () => {
      const arrived = await waitForText(simple, [
        'not in the page',
        'also not present',
        'emphasized text',
      ]);
      expect(arrived).toBe('emphasized text');
    });

    it('rejects if text is not found', async () => {
      const notPresent = waitForText(simple, 'not in the page, sorry', {
        timeout: 10,
      });
      await expect(notPresent).rejects.toThrow(TimeoutError);
    });

    it('waits until text is found', async () => {
      await withPage(async page => {
        await page.setContent(simpleContent);
        let resolved = false;
        const notYetPresent = waitForText(
          page,
          'This text is not yet in the page',
          { timeout: 1000 },
        );
        // tslint:disable-next-line: no-floating-promises
        notYetPresent.then(() => {
          resolved = true;
        });

        await sleep(0); // yield to the event queue
        expect(resolved).toBe(false);

        await page.evaluate(() => {
          const p = document.createElement('p');
          p.innerText = 'This text is not yet in the page';
          document.body.appendChild(p);
        });

        await sleep(0);
        await expect(notYetPresent).resolves.toBe(
          'This text is not yet in the page',
        );
      });
    });
  });

  describe('findAllWithText', () => {
    it('is able to take a regex as a parameter', async () => {
      const regex = /this is a new paragraph!/i;
      const boldText = await findAllWithText(simple, 'b', regex);
      await expect(boldText.length).toEqual(2);
    });

    it('finds elements matching on exact text', async () => {
      const elementTags = await findAllWithText(
        simple,
        'b',
        'this is a new paragraph!',
      );
      await expect(elementTags.length).toEqual(2);
    });

    it('finds elements matching on partial text', async () => {
      const elementTags = await findAllWithText(simple, 'a', 'link');
      await expect(elementTags.length).toEqual(2);
    });

    it('finds elements where the text is in a child element', async () => {
      const elementTags = await findAllWithText(
        simple,
        'td',
        'More preceise search.',
      );
      await expect(elementTags.length).toEqual(1);
    });

    it('finds multiple elements when they exist', async () => {
      const elementTags = await findAllWithText(simple, 'p > b', 'this is a');
      await expect(elementTags.length).toEqual(2);
    });

    it('finds zero examples when selector is not found', async () => {
      const elementTags = await findAllWithText(simple, 'nope', 'this is a');
      await expect(elementTags.length).toEqual(0);
    });

    it('finds zero examples when text doesnt match', async () => {
      const elementTags = await findAllWithText(simple, 'p', 'brrrrrgrtgrtgrt');
      await expect(elementTags.length).toEqual(0);
    });
  });

  describe('findOneWithText', () => {
    it('throws on element not found', async () => {
      await expect(findOneWithText(simple, 'svg', 'anything')).rejects.toThrow(
        Error,
      );
    });

    it('warns on multiple found', async () => {
      const spyWarn = jest.spyOn(console, 'warn');
      spyWarn.mockReset();
      await findOneWithText(simple, 'b', 'paragraph');
      expect(spyWarn).toHaveBeenCalled();
    });

    it('does not warn on single found', async () => {
      const spyWarn = jest.spyOn(console, 'warn');
      spyWarn.mockReset();
      await findOneWithText(simple, 'p[data-second]', 'paragraph');
      expect(spyWarn).not.toHaveBeenCalled();
    });
  });

  describe('furthestAncestorWithout', () => {
    it('finds the nearest ancestor possible', async () => {
      const nested = await simple.$('[data-nested-strong]');
      const toAvoid = await simple.$('[data-second]');
      const ancestor = await furthestAncestorWithout(nested!, toAvoid!);
      const isDataFirstDiv = await simple.evaluate(
        a => a.hasAttribute('data-first-div'),
        ancestor,
      );
      expect(isDataFirstDiv).toBe(true);
    });
  });

  // TODO, the rest of the tests
  describe('commonAncestor', () => {
    it('finds the nearest ancestor of two elements', async () => {
      const b = await findOneWithText(
        simple,
        'b[data-b-in-p]',
        'this is a new paragraph!',
      );
      const em = await findOneWithText(
        simple,
        'em',
        'emphasized text inside a p',
      );
      const p = await commonAncestor(b, em);
      expect(p).toBeTruthy();
      const evaluateP = await simple.evaluate(
        elem => elem.hasAttribute('data-second'),
        p,
      );
      expect(evaluateP).toBeTruthy();
    });

    it('finds an element of its own ancestory', async () => {
      const b = await findOneWithText(
        simple,
        'b[data-b-in-p]',
        'this is a new paragraph!',
      );
      const em = await findOneWithText(
        simple,
        'em',
        'emphasized text inside a p',
      );
      const ancestor = await commonAncestor(b, em);
      expect(ancestor).toBeTruthy();
      const evaluateP = await simple.evaluate(
        elem => elem.hasAttribute('data-second'),
        ancestor,
      );
      expect(evaluateP).toBeTruthy();
    });
  });

  describe('nearestParentLike', () => {
    it('finds the immediate parent', async () => {
      const b = await findOneWithText(
        simple,
        'b[data-b-in-p]',
        'this is a new paragraph!',
      );
      const p = await nearestParentLike(b, 'p');
      const evaluateP = await simple.evaluate(
        elem => elem.hasAttribute('data-second'),
        p,
      );
      expect(p).toBeTruthy();
      expect(evaluateP).toBeTruthy();
    });

    it('finds a parent two steps up', async () => {
      const i = await findOneWithText(simple, 'i', 'in bold italics.');
      const p = await nearestParentLike(i, 'p');
      const evaluateP = await simple.evaluate(
        elem => elem.hasAttribute('data-second'),
        p,
      );
      expect(p).toBeTruthy();
      expect(evaluateP).toBeTruthy();
    });

    it('finds the nearest matching parent', async () => {
      const strong = await findOneWithText(
        simple,
        'strong[data-nested-strong]',
        'armstrong',
      );
      const div = await nearestParentLike(strong, 'div');
      const evaluateDiv = await simple.evaluate(
        elem => elem.hasAttribute('data-second-div'),
        div,
      );
      expect(div).toBeTruthy();
      expect(evaluateDiv).toBeTruthy();
    });

    it('doesnt include itself in the search', async () => {
      const div = await findOneWithText(
        simple,
        'div[data-second-div]',
        'armstrong',
      );
      const parent = await nearestParentLike(div, 'div');
      const evaluateParent = await simple.evaluate(
        elem => elem.hasAttribute('data-first-div'),
        parent,
      );
      expect(parent).toBeTruthy();
      expect(evaluateParent).toBeTruthy();
    });

    it('returns null if no match can be found', async () => {
      const strong = await findOneWithText(
        simple,
        'strong[data-nested-strong]',
        'armstrong',
      );
      const parent = await nearestParentLike(strong, '[non-existent-selector]');
      expect(parent).toBeNull();
    });
  });
});
