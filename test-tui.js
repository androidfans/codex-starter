#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-starter-tui-'));
const originalHomedir = os.homedir;
os.homedir = () => tmpHome;

const codeXDir = path.join(tmpHome, '.codex');
const sessionsDir = path.join(codeXDir, 'sessions', '2026', '04', '13');
fs.mkdirSync(sessionsDir, { recursive: true });

function writeSession(fileName, lines) {
  fs.writeFileSync(path.join(sessionsDir, fileName), lines.map(line => JSON.stringify(line)).join('\n'));
}

writeSession('rollout-a.jsonl', [
  {
    timestamp: '2026-04-13T02:47:46.375Z',
    type: 'session_meta',
    payload: {
      id: 'sess-a',
      timestamp: '2026-04-13T02:47:46.375Z',
      cwd: '/Users/test/Desktop/project-alpha',
      cli_version: '0.120.0',
      model_provider: 'litellm',
      source: 'cli',
      originator: 'codex-tui',
    },
  },
  {
    timestamp: '2026-04-13T02:47:50.000Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'build project filter UI' },
  },
  {
    timestamp: '2026-04-13T02:47:52.000Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'On it.' },
  },
  {
    timestamp: '2026-04-13T02:47:53.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text: 'commentary-only-marker' }],
    },
  },
  {
    timestamp: '2026-04-13T02:47:54.000Z',
    type: 'response_item',
    payload: { type: 'custom_tool_call_output', output: 'tool-only-marker' },
  },
  {
    timestamp: '2026-04-13T02:47:55.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: 'release-summary-marker completed' }],
    },
  },
  ...Array.from({ length: 20 }, (_, index) => ({
    timestamp: `2026-04-13T02:48:${String(index).padStart(2, '0')}.000Z`,
    type: 'event_msg',
    payload: { type: 'user_message', message: `extra prompt ${String(index + 1).padStart(2, '0')}` },
  })),
]);

writeSession('rollout-b.jsonl', [
  {
    timestamp: '2026-04-12T02:47:46.375Z',
    type: 'session_meta',
    payload: {
      id: 'sess-b',
      timestamp: '2026-04-12T02:47:46.375Z',
      cwd: '/Users/test/Desktop/project-beta',
      cli_version: '0.120.0',
      model_provider: 'litellm',
      source: 'exec',
      originator: 'codex_exec',
    },
  },
  {
    timestamp: '2026-04-12T02:47:50.000Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'investigate failing tests' },
  },
]);

writeSession('rollout-a-fork.jsonl', [
  {
    timestamp: '2026-04-13T03:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'sess-a-fork',
      forked_from_id: 'sess-a',
      timestamp: '2026-04-13T03:00:00.000Z',
      cwd: '/Users/test/Desktop/project-alpha',
      source: 'cli',
      originator: 'codex-tui',
    },
  },
  {
    timestamp: '2026-04-13T02:47:46.375Z',
    type: 'session_meta',
    payload: {
      id: 'sess-a',
      timestamp: '2026-04-13T02:47:46.375Z',
      cwd: '/Users/test/Desktop/project-alpha',
      source: 'cli',
      originator: 'codex-tui',
    },
  },
  {
    timestamp: '2026-04-13T03:01:00.000Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'build project filter UI' },
  },
]);

writeSession('rollout-a-fork-latest.jsonl', [
  {
    timestamp: '2026-04-13T04:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'sess-a-fork-latest',
      forked_from_id: 'sess-a-fork',
      timestamp: '2026-04-13T04:00:00.000Z',
      cwd: '/Users/test/Desktop/project-alpha',
      source: 'cli',
      originator: 'codex-tui',
    },
  },
  {
    timestamp: '2026-04-13T03:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'sess-a-fork',
      forked_from_id: 'sess-a',
      timestamp: '2026-04-13T03:00:00.000Z',
      cwd: '/Users/test/Desktop/project-alpha',
      source: 'cli',
      originator: 'codex-tui',
    },
  },
  {
    timestamp: '2026-04-13T04:01:00.000Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'build project filter UI' },
  },
]);

fs.writeFileSync(path.join(codeXDir, 'codex-starter-meta.json'), JSON.stringify({
  sessions: {
    'sess-a': { customTitle: 'build project filter UI — renamed-dashboard-marker' },
  },
}));

const screenKeyHandlers = {};
const screenKeypressHandlers = [];
const widgets = {};
let widgetId = 0;

function createMockWidget(label, opts = {}) {
  const widget = new EventEmitter();
  widget.__label = label;
  widget.__id = widgetId++;
  widget._content = '';
  widget._items = opts.items ? [...opts.items] : [];
  widget.items = opts.items ? [...opts.items] : [];
  widget._selectedIndex = 0;
  widget._destroyed = false;
  widget._scrollPos = 0;
  widget.childBase = 0;
  widget.height = 10;
  widget.width = 120;
  widget.top = opts.top || 0;
  widget.bottom = opts.bottom || 0;
  widget.wrap = opts.wrap !== false;
  widget.parent = opts.parent;
  widget.style = opts.style || {};
  widget.setContent = function(content) { this._content = content; this.content = content; };
  widget.getContent = function() { return this._content; };
  widget.parseContent = function() {};
  widget.getScreenLines = function() {
    if (!this._content) return [];
    const width = Math.max(1, Number(this.width) || 1);
    return this._content.split('\n').flatMap((line) => {
      const plain = line.replace(/{(\/?)([\w\-,;!#]*)}/g, '');
      const rows = this.wrap ? Math.max(1, Math.ceil([...plain].length / width)) : 1;
      return Array.from({ length: rows }, () => plain);
    });
  };
  widget.setItems = function(items) {
    this._items = [...items];
    this.items = [...items];
    // Blessed may emit while replacing list contents; the app must suppress
    // this internal selection event while rebuilding fork rows.
    const index = Math.max(0, Math.min(this._selectedIndex, this.items.length - 1));
    this.emit('select item', this.items[index], index);
  };
  widget.select = function(index) { this._selectedIndex = index; };
  widget.focus = function() {};
  widget.destroy = function() { this._destroyed = true; };
  widget.getScroll = function() { return this._scrollPos; };
  widget.setScroll = function(value) {
    const visibleHeight = this.parent && this.parent !== mockScreen
      ? this.parent.height - (Number(this.top) || 0) - (Number(this.bottom) || 0)
      : this.height;
    const maxScroll = Math.max(0, this.getScreenLines().length - Math.max(1, visibleHeight));
    this._scrollPos = Math.max(0, Math.min(value, maxScroll));
  };
  widget.scroll = function(delta) { this.setScroll(this._scrollPos + delta); };
  widget.render = function() {};
  widget.key = function(keys, handler) {
    const list = Array.isArray(keys) ? keys : [keys];
    const store = (label === 'screen') ? screenKeyHandlers : (widget.__keyHandlers || (widget.__keyHandlers = {}));
    for (const key of list) {
      if (!store[key]) store[key] = [];
      store[key].push(handler);
    }
  };
  return widget;
}

const mockScreen = createMockWidget('screen');
let screenOptions;
let inputSourceActivationCount = 0;
mockScreen.width = 120;
mockScreen.height = 40;
mockScreen.on = function(event, handler) {
  EventEmitter.prototype.on.call(this, event, handler);
  if (event === 'keypress') screenKeypressHandlers.push(handler);
  return this;
};

const mockBlessed = {
  screen: (opts) => {
    screenOptions = opts;
    return mockScreen;
  },
  box: (opts) => {
    const widget = createMockWidget('box', opts);
    if (opts.parent === mockScreen && opts.top === 0) widgets.header = widget;
    if (opts.parent === mockScreen && opts.bottom === 0) widgets.footer = widget;
    if (opts.parent === mockScreen && String(opts.left).includes('50%')) {
      widgets.detail = widget;
      widget.width = Math.floor(mockScreen.width / 2) - 1;
      widget.height = mockScreen.height - 7;
    }
    if (opts.parent === widgets.detail && opts.width === '100%') widget.width = widgets.detail.width;
    if (opts.name === 'detail-meta') widgets.detailMeta = widget;
    if (opts.name === 'detail-messages') widgets.detailMessages = widget;
    if (opts.name === 'detail-action') widgets.detailAction = widget;
    if (String(opts.label).includes('Renamed')) widgets.renameConfirm = widget;
    return widget;
  },
  list: (opts) => {
    const widget = createMockWidget('list', opts);
    if (opts.parent === mockScreen && opts.left === 0 && opts.top === 4) {
      widgets.list = widget;
      widget.height = 8;
    } else if (opts.parent === mockScreen) {
      widgets.popupList = widget;
    }
    return widget;
  },
  line: opts => createMockWidget('line', opts),
};

const stringWidthPath = require.resolve('string-width');
require.cache[require.resolve('blessed')] = { exports: mockBlessed };
require.cache[stringWidthPath] = { exports: input => String(input).length };

const originalExit = process.exit;
let exitCallCount = 0;
process.exit = () => { exitCallCount++; };

const originalStdoutWrite = process.stdout.write;
process.stdout.write = () => true;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = () => {};
console.error = () => {};

const childProcess = require('child_process');
const originalSpawn = childProcess.spawn;
const spawnCalls = [];
childProcess.spawn = function(cmd, args, opts) {
  spawnCalls.push({ cmd, args, opts });
  const fakeChild = new EventEmitter();
  fakeChild.stdin = { write: () => {}, end: () => {} };
  return fakeChild;
};

const mod = require('./index.js');

function triggerScreenKey(keyName, ch = null) {
  const handlers = screenKeyHandlers[keyName] || [];
  for (const handler of handlers) handler(ch, { name: keyName });
}

function triggerKeypress(ch, keyName = ch) {
  for (const handler of screenKeypressHandlers) handler(ch, { name: keyName, ctrl: false, meta: false });
}

function triggerWidgetKey(widget, keyName, ch = null) {
  const handlers = widget.__keyHandlers?.[keyName] || [];
  for (const handler of handlers) handler(ch, { name: keyName });
}

function detailText() {
  return [widgets.detailMeta, widgets.detailMessages, widgets.detailAction]
    .filter(Boolean)
    .map(widget => widget.getContent())
    .join('\n');
}

before(async () => {
  mod.createApp({
    activateInputSource: () => { inputSourceActivationCount++; },
  });
  assert.match(widgets.header.getContent(), /indexing search/);
  // Initial render happens synchronously; search indexing starts on the next
  // event-loop turn and streams each transcript without blocking the TUI.
  for (let attempt = 0; attempt < 100 && /indexing search/.test(widgets.header.getContent()); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.doesNotMatch(widgets.header.getContent(), /indexing search/);
});

after(() => {
  childProcess.spawn = originalSpawn;
  process.exit = originalExit;
  process.stdout.write = originalStdoutWrite;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  os.homedir = originalHomedir;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('codex starter tui', () => {
  it('activates ABC on focus or the first mouse down after blur', () => {
    assert.equal(screenOptions.sendFocus, true);
    mockScreen.emit('mousedown', { action: 'mousedown' });
    assert.equal(inputSourceActivationCount, 0, 'ordinary clicks do not switch input sources');

    mockScreen.emit('blur');
    mockScreen.emit('mousedown', { action: 'mousedown' });
    mockScreen.emit('focus');
    mockScreen.emit('mousedown', { action: 'mousedown' });
    assert.equal(inputSourceActivationCount, 2);
  });

  it('renders Codex Starter header and list items', () => {
    assert.match(widgets.header.getContent(), /Codex Starter/);
    assert.match(widgets.header.getContent(), /conversations · 3 versions/);
    assert.ok(widgets.list.items.some(item => item.includes('build proj')));
    assert.ok(widgets.list.items.some(item => item.includes('▸')));
    assert.ok(widgets.list.items.some(item => item.includes('→ Latest')));
    assert.ok(!widgets.list.items.some(item => item.includes('investigate failing tests')));
  });

  it('expands and collapses fork families with arrow keys', () => {
    triggerKeypress(null, 'escape');
    triggerScreenKey('home');
    triggerScreenKey('down');
    assert.equal(widgets.list.items.length, 2, 'new row plus one collapsed family');

    triggerScreenKey('right');
    assert.equal(widgets.list.items.length, 5, 'family row plus all three versions');
    assert.ok(widgets.list.items.some(item => item.includes('Original')));
    assert.equal(widgets.list.items.filter(item => item.includes('Fork')).length, 2);

    triggerScreenKey('down');
    widgets.list.childBase = 3;
    triggerScreenKey('left');
    assert.equal(widgets.list.items.length, 2);
    assert.equal(widgets.list.childBase, 0);
    assert.ok(widgets.list.items.some(item => item.includes('▸')));
  });

  it('expands and collapses fork families with Vim keys', () => {
    triggerScreenKey('home');
    triggerScreenKey('down');

    triggerKeypress('l');
    assert.equal(widgets.list.items.length, 5, 'l expands the selected family');

    triggerKeypress('j');
    triggerKeypress('h');
    assert.equal(widgets.list.items.length, 2, 'h collapses from a child version');
    assert.ok(widgets.list.items.some(item => item.includes('▸')));
  });

  it('resumes an explicitly selected expanded version', () => {
    triggerScreenKey('home');
    triggerScreenKey('down');
    triggerScreenKey('right');
    triggerScreenKey('down');
    triggerScreenKey('enter');
    assert.match(spawnCalls.at(-1).args.at(-1), /resume sess-a(?:\s|$)/);
    triggerScreenKey('left');
  });

  it('shows every historical turn with one response preview per user message', () => {
    triggerKeypress(null, 'escape');
    triggerScreenKey('home');
    triggerScreenKey('down');
    triggerScreenKey('right');
    triggerScreenKey('down');

    assert.match(widgets.detailMessages.getContent(), /extra prompt 20/);
    const userPreviewCount = (widgets.detailMessages.getContent().match(/You >/g) || []).length;
    const codexPreviewCount = (widgets.detailMessages.getContent().match(/Codex >/g) || []).length;
    assert.equal(userPreviewCount, 21);
    assert.ok(codexPreviewCount <= userPreviewCount);
    assert.match(
      widgets.detailMessages.getContent(),
      /On it\.\{\/\}\n\n .*You >\{\/\} extra prompt 01/,
    );
    triggerScreenKey('left');
  });

  it('scrolls only the middle conversation viewport', () => {
    triggerScreenKey('home');
    triggerScreenKey('down');
    triggerScreenKey('right');
    triggerScreenKey('down');
    const metaScroll = widgets.detailMeta.getScroll();
    const messagesScroll = widgets.detailMessages.getScroll();
    const actionScroll = widgets.detailAction.getScroll();

    widgets.detailMeta.emit('wheeldown');
    widgets.detailMessages.emit('wheeldown');
    widgets.detailAction.emit('wheeldown');

    assert.equal(widgets.detailMeta.getScroll(), metaScroll);
    assert.equal(widgets.detailMessages.getScroll(), messagesScroll + 2);
    assert.equal(widgets.detailAction.getScroll(), actionScroll);
    assert.match(widgets.detailMeta.getContent(), /Session/);
    assert.match(widgets.detailAction.getContent(), /Enter.*resume this conversation/);
    triggerScreenKey('left');
  });

  it('reflows fixed panels and clamps conversation scroll on resize', () => {
    triggerScreenKey('home');
    triggerScreenKey('down');
    triggerScreenKey('right');
    triggerScreenKey('down');

    widgets.detail.height = 80;
    widgets.detail.width = 39;
    widgets.detailMeta.width = 39;
    widgets.detailMessages.width = 39;
    widgets.detailAction.width = 39;
    mockScreen.emit('resize');
    assert.ok(widgets.detailMeta.height > widgets.detailMeta.getContent().split('\n').length);
    assert.ok(widgets.detailAction.height > 4);

    widgets.detail.height = 12;
    mockScreen.emit('resize');
    widgets.detailMessages.setScroll(999);
    widgets.detail.height = 80;
    mockScreen.emit('resize');
    const visibleHeight = widgets.detail.height
      - widgets.detailMessages.top - widgets.detailMessages.bottom;
    const maxScroll = Math.max(
      0,
      widgets.detailMessages.getScreenLines().length - visibleHeight,
    );
    assert.ok(widgets.detailMessages.getScroll() <= maxScroll);

    widgets.detail.height = mockScreen.height - 7;
    widgets.detail.width = Math.floor(mockScreen.width / 2) - 1;
    widgets.detailMeta.width = widgets.detail.width;
    widgets.detailMessages.width = widgets.detail.width;
    widgets.detailAction.width = widgets.detail.width;
    mockScreen.emit('resize');
    triggerScreenKey('left');
  });

  it('supports search via slash mode', () => {
    triggerScreenKey('/');
    triggerKeypress('f');
    triggerKeypress('i');
    triggerKeypress('l');
    triggerKeypress('t');
    triggerKeypress('e');
    triggerKeypress('r');
    assert.ok(widgets.header.getContent().includes('/ filter'));
    assert.ok(widgets.list.items.some(item => item.includes('→ Latest')));
  });

  it('searches final answers but not commentary or tool output', () => {
    triggerKeypress(null, 'escape');
    triggerScreenKey('/');
    for (const ch of 'release-summary-marker') triggerKeypress(ch);
    assert.ok(widgets.list.items.some(item => item.includes('→ Latest')));

    triggerKeypress(null, 'escape');
    triggerScreenKey('/');
    for (const ch of 'tool-only-marker') triggerKeypress(ch);
    assert.ok(!widgets.list.items.some(item => item.includes('→ Latest')));
    triggerScreenKey('end');
    assert.equal(widgets.list._selectedIndex, 0);
    triggerKeypress('G');
    assert.equal(widgets.list._selectedIndex, 0);
    triggerKeypress(null, 'escape');
  });

  it('searches locally renamed session titles', () => {
    triggerScreenKey('/');
    for (const ch of 'renamed-dashboard-marker') triggerKeypress(ch);
    assert.ok(widgets.list.items.some(item => item.includes('→ Latest')));
    triggerKeypress(null, 'escape');
  });

  it('persists clearing a renamed session title', async () => {
    triggerScreenKey('home');
    triggerScreenKey('down');
    triggerScreenKey('right');
    triggerScreenKey('down');
    triggerScreenKey('r');
    for (let i = 0; i < 80; i++) triggerKeypress(null, 'backspace');
    triggerKeypress(null, 'enter');

    const transcript = fs.readFileSync(path.join(sessionsDir, 'rollout-a.jsonl'), 'utf-8');
    assert.deepEqual(JSON.parse(transcript.trim().split('\n').at(-1)), {
      type: 'custom-title',
      customTitle: '',
    });

    await new Promise(resolve => setTimeout(resolve, 220));
    triggerWidgetKey(widgets.renameConfirm, 'escape');
    triggerScreenKey('left');
  });

  it('keeps the project filter when Escape clears a text search', () => {
    triggerScreenKey('/');
    for (const ch of 'release') triggerKeypress(ch);
    triggerKeypress(null, 'enter');
    triggerScreenKey('enter');

    triggerScreenKey('p');
    widgets.popupList.emit('select', null, 1);
    assert.match(widgets.header.getContent(), /project-alpha/);
    assert.match(widgets.header.getContent(), /release/);

    triggerScreenKey('/');
    triggerKeypress(null, 'escape');
    assert.match(widgets.header.getContent(), /project-alpha/);

    triggerKeypress(null, 'escape');
  });

  it('keeps active filters when a popup is dismissed with Escape', () => {
    triggerScreenKey('p');
    widgets.popupList.emit('select', null, 1);
    assert.match(widgets.header.getContent(), /project-alpha/);

    triggerScreenKey('p');
    const popup = widgets.popupList;
    triggerKeypress(null, 'escape');
    triggerWidgetKey(popup, 'escape');
    assert.match(widgets.header.getContent(), /project-alpha/);

    triggerKeypress(null, 'escape');
  });

  it('cycles explicit launch mode with m', () => {
    triggerKeypress(null, 'escape');
    triggerScreenKey('home');
    triggerScreenKey('m');
    assert.ok(widgets.header.getContent().includes('[Full Auto]'));
    assert.ok(detailText().includes('codex --full-auto'));
    assert.equal(mod.loadMeta().defaultLaunchMode, 'full-auto');
  });

  it('resumes selected session with codex resume', () => {
    triggerKeypress(null, 'escape');
    triggerScreenKey('home');
    triggerScreenKey('down');
    triggerScreenKey('enter');
    const lastCall = spawnCalls.at(-1);
    assert.ok(lastCall.cmd.endsWith('sh') || lastCall.cmd.endsWith('zsh') || lastCall.cmd.endsWith('bash'));
    assert.ok(lastCall.args.includes('-ic'));
    assert.ok(lastCall.args.at(-1).includes('codex --full-auto resume'));
    assert.ok(lastCall.args.at(-1).includes('sess-a-fork-latest'));
  });

  it('starts dangerous mode from new session row', () => {
    widgets.list.select(0);
    triggerScreenKey('home');
    triggerScreenKey('d');
    const lastCall = spawnCalls.at(-1);
    assert.ok(lastCall.args.at(-1).includes('codex --dangerously-bypass-approvals-and-sandbox'));
    assert.equal(mod.loadMeta().defaultLaunchMode, 'danger');
  });

  it('allows Ctrl-C to quit while a popup is open', () => {
    triggerScreenKey('p');
    const previousExitCallCount = exitCallCount;
    triggerScreenKey('C-c');
    assert.equal(exitCallCount, previousExitCallCount + 1);
  });
});
