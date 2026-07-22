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
  widget.style = opts.style || {};
  widget.setContent = function(content) { this._content = content; };
  widget.getContent = function() { return this._content; };
  widget.setItems = function(items) { this._items = [...items]; this.items = [...items]; };
  widget.select = function(index) { this._selectedIndex = index; };
  widget.focus = function() {};
  widget.destroy = function() { this._destroyed = true; };
  widget.scroll = function(delta) { this._scrollPos += delta; };
  widget.setScroll = function(value) { this._scrollPos = value; };
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
mockScreen.width = 120;
mockScreen.height = 40;
mockScreen.on = function(event, handler) {
  EventEmitter.prototype.on.call(this, event, handler);
  if (event === 'keypress') screenKeypressHandlers.push(handler);
  return this;
};

const mockBlessed = {
  screen: () => mockScreen,
  box: (opts) => {
    const widget = createMockWidget('box', opts);
    if (opts.parent === mockScreen && opts.top === 0) widgets.header = widget;
    if (opts.parent === mockScreen && opts.bottom === 0) widgets.footer = widget;
    if (opts.parent === mockScreen && String(opts.left).includes('50%')) widgets.detail = widget;
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
process.exit = () => {};

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

before(async () => {
  mod.createApp();
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
  it('renders Codex Starter header and list items', () => {
    assert.match(widgets.header.getContent(), /Codex Starter/);
    assert.ok(widgets.list.items.some(item => item.includes('build project filter UI')));
    assert.ok(!widgets.list.items.some(item => item.includes('investigate failing tests')));
  });

  it('expands the conversation preview for taller detail panes', () => {
    triggerKeypress(null, 'escape');
    widgets.detail.height = 80;
    triggerScreenKey('home');
    triggerScreenKey('down');
    assert.match(widgets.detail.getContent(), /extra prompt 11/);
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
    assert.ok(widgets.list.items.some(item => item.includes('build project filter UI')));
  });

  it('searches final answers but not commentary or tool output', () => {
    triggerKeypress(null, 'escape');
    triggerScreenKey('/');
    for (const ch of 'release-summary-marker') triggerKeypress(ch);
    assert.ok(widgets.list.items.some(item => item.includes('build project filter UI')));

    triggerKeypress(null, 'escape');
    triggerScreenKey('/');
    for (const ch of 'tool-only-marker') triggerKeypress(ch);
    assert.ok(!widgets.list.items.some(item => item.includes('build project filter UI')));
    triggerKeypress(null, 'escape');
  });

  it('searches locally renamed session titles', () => {
    triggerScreenKey('/');
    for (const ch of 'renamed-dashboard-marker') triggerKeypress(ch);
    assert.ok(widgets.list.items.some(item => item.includes('build project filter UI')));
    triggerKeypress(null, 'escape');
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
    assert.ok(widgets.detail.getContent().includes('codex --full-auto'));
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
  });

  it('starts dangerous mode from new session row', () => {
    widgets.list.select(0);
    triggerScreenKey('home');
    triggerScreenKey('d');
    const lastCall = spawnCalls.at(-1);
    assert.ok(lastCall.args.at(-1).includes('codex --dangerously-bypass-approvals-and-sandbox'));
    assert.equal(mod.loadMeta().defaultLaunchMode, 'danger');
  });
});
