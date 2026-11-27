// Order-unlock checks for history-quiz. Synthetic ids only.
// Chrome is pinned to 127.0.0.1 for the API and Mantle hosts, so a missed
// mock cannot redeem a real order or code.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const API = 'https://' + API_HOST;
const ORDER = 'P847291038475610293';
const CODE = 'LSABCD';
const REPEAT = 'P111111111111111111';
const SEQ = 'P123456789012345678';
const P19 = 'P9900000000000001378';
const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}/`;
const ART = '/opt/cursor/artifacts';

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER)) throw new Error('synthetic order is not a legal id: ' + patternError(ORDER));
if (patternError(REPEAT) !== 'repeat') throw new Error('repeat fixture');
if (patternError(SEQ) !== 'sequence') throw new Error('sequence fixture');
if (patternError(P19) !== 'shape') throw new Error('19-digit fixture');
if (!/^LS[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    uses: 0,
    max: 3,
    vaultMode: 'ok',
    vaultGet: 'ok',
    mantleRemaining: 3,
    mantleMissing: false,
    posts: 0,
    peeks: 0,
    vaultPosts: 0,
    vaultGets: 0,
    mantleGets: 0,
    mantleDecr: 0,
    mantleIncr: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleApi(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  const quiz = u.searchParams.get('quiz');
  state.urls.push(req.method() + ' ' + u.pathname + u.search);
  if (u.pathname === '/order/get' || u.pathname === '/order/redeem' || u.pathname.includes('/orders/')) {
    state.unexpected.push('vercel-order ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'down') {
      await req.abort('failed');
      return;
    }
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  if (u.pathname === '/get') {
    state.vaultGets++;
    if (quiz !== 'history') return send(req, 400, { ok: false, error: 'invalid' });
    if (state.vaultGet === 'miss') return send(req, 404, { ok: false, error: 'not_found' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  state.unexpected.push('api ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function handleMantle(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' mantle ' + u.pathname);
  if (u.pathname.includes('/orders/')) {
    state.unexpected.push('mantle-order ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (!u.pathname.includes('/hq/')) {
    state.unexpected.push('mantle-col ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (req.method() === 'GET') {
    state.mantleGets++;
    if (state.mantleMissing) return send(req, 404, { error: 'not_found' });
    return send(req, 200, { remaining: state.mantleRemaining, max: 3 });
  }
  if (req.method() === 'POST' && u.pathname.includes('/increment/')) {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    if (body.by === -1) {
      state.mantleDecr++;
      if (state.mantleDecrResult != null) return send(req, 200, { remaining: state.mantleDecrResult });
      state.mantleRemaining -= 1;
    } else if (body.by === 1) {
      state.mantleIncr++;
      state.mantleRemaining += 1;
    } else {
      state.unexpected.push('mantle by ' + body.by);
    }
    return send(req, 200, { remaining: state.mantleRemaining });
  }
  state.unexpected.push('mantle ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === API_HOST) return await handleApi(req, u, state);
      if (u.hostname === 'mantledb.sh') return await handleMantle(req, u, state);
      state.unexpected.push(u.hostname + req.url());
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      posts: state.posts, peeks: state.peeks,
      vaultPosts: state.vaultPosts, vaultGets: state.vaultGets,
      mantleGets: state.mantleGets, mantleDecr: state.mantleDecr, mantleIncr: state.mantleIncr,
      bodies: state.bodies, urls: state.urls, unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    answers = Array(QUESTIONS.length).fill(0);
    finishQuiz();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#quizProgress', (el) => el.textContent);
  await page.click('#options .option');
  await page.waitForFunction((prev) => document.getElementById('quizProgress').textContent !== prev, { timeout: 3000 }, before);
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => u.includes('/orders/') || u.includes('/order/'));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.posts === 0 && state.peeks === 0 && state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, msg, state);
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    let max = 0;
    let min = 0;
    let offender = '';
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('#slides')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > max) {
        max = r.right;
        offender = (el.id || el.className || el.tagName).toString().slice(0, 80);
      }
      if (r.left < min) min = r.left;
    }
    const input = document.getElementById('codeInput');
    const inputFit = !input || input.getClientRects().length === 0
      ? null
      : input.scrollWidth <= input.clientWidth + 2;
    return { vw, max: Math.round(max), min: Math.round(min), offender, inputFit, overflow: max > vw + 1 || min < -1 };
  });
}

async function shot(page, name) {
  await mkdir(ART, { recursive: true });
  await page.screenshot({ path: join(ART, name), fullPage: false });
}

async function newPage(browser, state, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport(opts.viewport || { width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemAccess === 'function' && typeof shownOrderUses === 'function');
  return { page, errors };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep LS codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order) => ({
    good: orderFormatError(order),
    repeat: orderFormatError('P111111111111111111'),
    seq: orderFormatError('P123456789012345678'),
    pasted: classifyInput(' 「p8472-9103-8475-610293」 '),
    code: classifyInput(' ls ab cd '),
    p19: orderFormatError('P9900000000000001378'),
    p19c: classifyInput('P9900000000000001378').type,
    copy: orderSuccessText({ ok: true, uses: 1, remaining: 2 }),
    lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0 }),
    laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0 }),
    paid: noteDisplayedUse(order).paidVerified,
    quiz: QUIZ_KEY,
    api: API_BASE,
    title: document.querySelector('.code-panel h3').textContent,
    hint: document.querySelector('.code-hint').innerText,
  }), ORDER);
  assert(out.good === '', 'legal synthetic id rejected ' + out.good);
  assert(out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced LS code ' + JSON.stringify(out.code));
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.paid === false, 'paidVerified must stay false');
  assert(out.quiz === 'history' && out.api === API, 'quiz/api constants');
  assert(out.title === '输入订单号', out.title);
  assert(out.hint.includes('我的订单') && out.hint.includes('3 次'), out.hint);
  assertNoOrderNet(state, 'format checks must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('valid order starts with no order request; refresh and continue keep the count', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(visible.includes('历史人物') && !visible.includes('paidVerified'), 'start copy');
  await openAndSubmit(page, ' 「p8472-9103-8475-610293」 ');
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assertNoOrderNet(state, 'first start must not call the network');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次', 'success copy ' + toast);
  const q1 = await page.$eval('#qText', (el) => el.textContent);
  assert(q1.startsWith('一件事提前做完'), 'first question changed: ' + q1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'refresh at question 1 must not change the display count');
  assertNoOrderNet(state, 'refresh must not call the network');
  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval('#quizProgress', (el) => el.textContent);
  assert(prog === '3 / 15', 'progress ' + prog);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('quizProgress').textContent,
    qi: qIndex,
    a0: answers[0],
    a1: answers[1],
  }));
  assert(resumed.prog === '3 / 15' && resumed.qi === 2 && resumed.a0 === 0 && resumed.a1 === 0, 'mid refresh ' + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, 'mid refresh must not change the display count');
  await page.evaluate(() => showScreen('start'));
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('quizProgress').textContent,
    qi: qIndex,
    a0: answers[0],
  }));
  assert(cont.prog === '3 / 15' && cont.qi === 2 && cont.a0 === 0, 'continue reset the attempt ' + JSON.stringify(cont));
  assert(await shownUses(page) === 1, 'continue must not change the display count');
  assertNoOrderNet(state, 'continue must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result restore and 查看上次结果 do not advance; 再测一次 does; later entry still starts', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstPct = await page.$eval('.match-pct', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const peeked = await page.$eval('.match-pct', (el) => el.textContent);
  assert(peeked === firstPct, 'result refresh changed the result');
  assert(await shownUses(page) === 1, 'result refresh changed the display count');
  assertNoOrderNet(state, 'result refresh must not call the network');

  await page.click('#btnViewLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, 'view last changed the display count');
  assertNoOrderNet(state, 'view last must not call the network for an order');
  await page.evaluate(() => showScreen('start'));
  await page.click('#btnLast');
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'));
  assert(await shownUses(page) === 1, 'start-page view last changed the display count');
  assertNoOrderNet(state, 'start-page view last must not call the network');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, 'retest should display the second use');
  const secondToast = await page.$eval('#toast', (el) => el.textContent);
  assert(secondToast.includes('还可以测 1 次'), secondToast);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('quizProgress').textContent, len: answers.length }));
  assert(restarted.prog === '1 / 15' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  const thirdToast = await page.$eval('#toast', (el) => el.textContent);
  assert(thirdToast.includes('这是最后一次'), thirdToast);
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(await shownUses(page) === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected on the device', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, SEQ);
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, P19);
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, REPEAT);
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  const uses = await page.evaluate((id) => shownOrderUses(id), ORDER);
  assert(!onQuiz && uses === 0, 'rejected ids started the quiz');
  assertNoOrderNet(state, 'rejected ids reached the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('access code hits the vault and does not touch orders', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ' ls ab cd ');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === 'history' && state.bodies[0].code === CODE, 'vault body', state);
  assert(!state.bodies[0].orderId, 'legacy redeem must not send orderId', state);
  assert(state.posts === 0 && state.peeks === 0, 'legacy must not call /order', state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0, 'vault hit must not touch Mantle', state);
  assert(state.urls.some((u) => u.startsWith('POST /redeem')), 'vault url', state);
  assert(!state.urls.some((u) => u.includes('/order')), 'order url on a code', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('还可以测 2 次'), toast);
  await fastFinish(page);
  await page.click('#btnRetry');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  await page.click('#btnStart');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.mantleDecr === 0, 'same-tab code retry must not redeem again', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('vault miss uses Mantle hq, exhausted vault does not', async (browser) => {
  const miss = freshState();
  miss.vaultMode = 'not_found';
  const opened = await newPage(browser, miss);
  await openAndSubmit(opened.page, CODE);
  await waitQuiz(opened.page);
  assert(miss.vaultPosts === 1 && miss.mantleGets === 1 && miss.mantleDecr === 1 && miss.mantleIncr === 0, 'mantle fallback', miss);
  assert(miss.mantleRemaining === 2, 'remaining after decr', miss);
  assert(miss.urls.some((u) => u.includes('/hq/' + CODE)), 'mantle collection', miss);
  assert(!miss.urls.some((u) => u.includes('/order')), 'order url on mantle fallback', miss);
  await opened.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完'));
  const onQuiz = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && done.mantleGets === 0 && done.mantleDecr === 0, 'exhausted vault fell through', done);
  await second.page.close();
});

test('vault outage falls back to Mantle and rolls a negative decrement back', async (browser) => {
  const down = freshState();
  down.vaultMode = 'down';
  const opened = await newPage(browser, down);
  await openAndSubmit(opened.page, CODE);
  await waitQuiz(opened.page);
  assert(down.vaultPosts === 1 && down.mantleDecr === 1 && down.mantleRemaining === 2, 'outage fallback', down);
  await opened.page.close();

  const rollback = freshState();
  rollback.vaultMode = 'not_found';
  rollback.mantleRemaining = 1;
  rollback.mantleDecrResult = -1;
  const page2 = await newPage(browser, rollback);
  await openAndSubmit(page2.page, CODE);
  await page2.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完'));
  const onQuiz = await page2.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && rollback.mantleDecr === 1 && rollback.mantleIncr === 1, 'rollback', rollback);
  await page2.page.close();

  const both = freshState();
  both.vaultMode = 'down';
  both.mantleMissing = true;
  const page3 = await newPage(browser, both);
  await openAndSubmit(page3.page, CODE);
  await page3.page.waitForFunction(() => document.getElementById('toast').textContent.includes('网络异常'));
  assert(await page3.page.evaluate(() => !isUnlocked()), 'network failure unlocked');
  await page3.page.close();
});

test('query string unlocks an order locally or redeems a code', async (browser) => {
  const order = freshState();
  const p1 = await newPage(browser, order, { path: '?code=' + ORDER });
  await waitQuiz(p1.page);
  assert(await shownUses(p1.page) === 1, 'query order should display one use');
  assertNoOrderNet(order, 'query order must not call the network');
  await p1.page.close();

  const code = freshState();
  const p2 = await newPage(browser, code, { path: '?code=' + CODE });
  await waitQuiz(p2.page);
  assert(code.vaultPosts === 1 && code.bodies[0].code === CODE && code.posts === 0, 'query code', code);
  assert(code.mantleGets === 0, 'query code vault hit touched Mantle', code);
  await p2.page.close();
});

test('layout at 320 and 390', async (browser) => {
  for (const width of [320, 390]) {
    const state = freshState();
    const { page, errors } = await newPage(browser, state, { viewport: { width, height: 780, isMobile: true, hasTouch: true } });
    let box = await overflow(page);
    assert(!box.overflow, width + ' start overflow ' + JSON.stringify(box));
    await shot(page, `history-${width}-start.png`);
    await page.click('#btnStart');
    await page.waitForSelector('#codeMask.show');
    await page.$eval('#codeInput', (el, v) => { el.value = v; }, ORDER);
    box = await overflow(page);
    assert(!box.overflow, width + ' modal overflow ' + JSON.stringify(box));
    assert(box.inputFit === true, width + ' order id clipped in the field ' + JSON.stringify(box));
    const heading = await page.$eval('.code-panel h3', (el) => el.textContent);
    assert(heading === '输入订单号', heading);
    await shot(page, `history-${width}-order.png`);
    await page.evaluate(() => {
      closeCodeModal();
      answers = Array(QUESTIONS.length).fill(0);
      computeResult();
      renderResult();
      showScreen('result');
    });
    box = await overflow(page);
    assert(!box.overflow, width + ' result overflow ' + JSON.stringify(box));
    const labels = await page.evaluate(() => ({
      retry: document.getElementById('btnRetry').textContent,
      last: document.getElementById('btnViewLast').textContent,
    }));
    assert(labels.retry === '再测一次' && labels.last === '查看上次结果', JSON.stringify(labels));
    await shot(page, `history-${width}-result.png`);
    assert(errors.length === 0, errors.join('\n'));
    await page.close();
  }
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${API_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
