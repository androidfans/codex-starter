#!/usr/bin/env node

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-starter-test-'));
const originalHomedir = os.homedir;
os.homedir = () => tmpHome;

const mod = require('./index.js');

const {
  getProjectDisplayName,
  extractUserText,
  loadSessionQuick,
  loadSessionDetail,
  buildSessionSearchText,
  indexSessionsInBackground,
  isInteractiveSession,
  loadAllSessions,
  filterSessionList,
  formatTimestamp,
  formatFileSize,
  loadMeta,
  saveMeta,
  getSessionMeta,
  getDefaultLaunchMode,
  setDefaultLaunchMode,
  getLaunchMode,
  buildCodexCommand,
  detectCLI,
  getShellCommand,
  CODEX_DIR,
  SESSIONS_DIR,
  META_FILE,
} = mod;

function writeSession(relativePath, lines) {
  const filePath = path.join(SESSIONS_DIR, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.map(line => JSON.stringify(line)).join('\n'));
  return filePath;
}

before(() => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
});

after(() => {
  os.homedir = originalHomedir;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('paths', () => {
  it('uses ~/.codex paths', () => {
    assert.equal(CODEX_DIR, path.join(tmpHome, '.codex'));
    assert.equal(SESSIONS_DIR, path.join(tmpHome, '.codex', 'sessions'));
    assert.equal(META_FILE, path.join(tmpHome, '.codex', 'codex-starter-meta.json'));
  });
});

describe('helpers', () => {
  it('formats project names from cwd', () => {
    assert.equal(getProjectDisplayName('/Users/test/Desktop/Bojun-Vibe-Codings'), 'test/Desktop/Bojun-Vibe-Codings');
    assert.equal(getProjectDisplayName(path.join(tmpHome, 'src', 'demo')), '~/src/demo');
  });

  it('extracts only meaningful user text from Codex response items', () => {
    const entry = {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>' },
          { type: 'input_text', text: 'fix login redirect loop' },
        ],
      },
    };
    assert.equal(extractUserText(entry), 'fix login redirect loop');
  });

  it('formats file sizes and timestamps', () => {
    assert.equal(formatFileSize(512), '512B');
    assert.equal(formatFileSize(2048), '2K');
    assert.equal(formatFileSize(1048576), '1.0M');
    assert.equal(formatTimestamp(null), 'unknown');
  });

  it('loads and persists meta', () => {
    saveMeta({ sessions: { abc: { customTitle: 'Pinned' } } });
    const meta = loadMeta();
    assert.equal(getSessionMeta(meta, 'abc').customTitle, 'Pinned');
    assert.deepEqual(getSessionMeta(meta, 'missing'), {});
  });

  it('loads and persists the default launch mode', () => {
    const meta = { sessions: {} };

    assert.equal(getDefaultLaunchMode(meta), 'default');

    setDefaultLaunchMode(meta, 'danger');
    assert.equal(meta.defaultLaunchMode, 'danger');
    assert.equal(loadMeta().defaultLaunchMode, 'danger');
    assert.equal(getDefaultLaunchMode(loadMeta()), 'danger');

    setDefaultLaunchMode(meta, 'default');
    assert.equal(meta.defaultLaunchMode, undefined);
    assert.equal(getDefaultLaunchMode(loadMeta()), 'default');
  });

  it('falls back to default launch mode for invalid meta values', () => {
    assert.equal(getDefaultLaunchMode({ sessions: {}, defaultLaunchMode: 'missing' }), 'default');
  });

  it('detects codex CLI name', () => {
    assert.deepEqual(detectCLI(), { name: 'codex', cmd: 'codex' });
  });

  it('disables job control before nested interactive zsh initialization', () => {
    const originalShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';
    assert.deepEqual(getShellCommand('codex resume abc'), {
      shellPath: '/bin/zsh',
      shellArgs: ['+m', '-ic', 'unsetopt MONITOR; codex resume abc'],
    });
    process.env.SHELL = originalShell;
  });

  it('does not inject zsh syntax into other shells', () => {
    const originalShell = process.env.SHELL;
    process.env.SHELL = '/usr/local/bin/fish';
    assert.deepEqual(getShellCommand('codex resume abc'), {
      shellPath: '/usr/local/bin/fish',
      shellArgs: ['-ic', 'codex resume abc'],
    });
    process.env.SHELL = originalShell;
  });

  it('builds explicit Codex mode commands', () => {
    assert.equal(getLaunchMode('full-auto').label, 'Full Auto');
    assert.equal(buildCodexCommand({ modeId: 'default' }), 'codex');
    assert.equal(buildCodexCommand({ sessionId: 'sess-123', modeId: 'full-auto' }), 'codex --full-auto resume sess-123');
    assert.equal(buildCodexCommand({ sessionId: 'sess-123', modeId: 'danger' }), 'codex --dangerously-bypass-approvals-and-sandbox resume sess-123');
  });
});

describe('session parsing', () => {
  it('loads quick session metadata from Codex JSONL', () => {
    const filePath = writeSession('2026/04/13/rollout-quick.jsonl', [
      {
        timestamp: '2026-04-13T02:47:46.375Z',
        type: 'session_meta',
        payload: {
          id: 'sess-quick',
          timestamp: '2026-04-13T02:47:46.375Z',
          cwd: '/Users/test/Desktop/project-alpha',
          cli_version: '0.120.0',
          model_provider: 'litellm',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-13T02:48:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'implement project search' }],
        },
      },
      {
        timestamp: '2026-04-13T02:48:10.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Working on it.' },
      },
    ]);

    const session = loadSessionQuick(filePath);
    assert.equal(session.sessionId, 'sess-quick');
    assert.equal(session.project, 'test/Desktop/project-alpha');
    assert.equal(session.topic, 'implement project search');
    assert.equal(session.version, '0.120.0');
    assert.equal(session.modelProvider, 'litellm');
    assert.equal(session.source, 'cli');
    assert.equal(session.originator, 'codex-tui');
    assert.ok(session.lastTs);
  });

  it('loads session detail including assistant text and function calls', () => {
    const filePath = writeSession('2026/04/13/rollout-detail.jsonl', [
      {
        timestamp: '2026-04-13T02:31:02.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-detail',
          timestamp: '2026-04-13T02:31:02.000Z',
          cwd: '/Users/test/Desktop/project-beta',
          cli_version: '0.120.0',
          model_provider: 'litellm',
          source: 'exec',
          originator: 'codex_exec',
        },
      },
      {
        timestamp: '2026-04-13T02:31:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'add tests for API client' }],
        },
      },
      {
        timestamp: '2026-04-13T02:31:04.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{}',
        },
      },
      {
        timestamp: '2026-04-13T02:31:05.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Added integration tests and updated fixtures.' }],
        },
      },
    ]);

    const session = loadSessionQuick(filePath);
    loadSessionDetail(session);

    assert.equal(session.userMessages[0], 'add tests for API client');
    assert.match(session.assistantSnippets[0], /Added integration tests/);
    assert.deepEqual(session.toolsUsed, ['exec_command']);
    assert.equal(session.totalMessages, 2);
    assert.equal(session.project, 'test/Desktop/project-beta');
  });

  it('keeps a cleared custom title cleared after reloading', () => {
    const filePath = writeSession('2026/04/13/rollout-title-cleared.jsonl', [
      {
        timestamp: '2026-04-13T02:31:02.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-title-cleared',
          timestamp: '2026-04-13T02:31:02.000Z',
          cwd: '/Users/test/Desktop/project-title',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'title persistence test' },
      },
      { type: 'custom-title', customTitle: 'Old title' },
      { type: 'custom-title', customTitle: '' },
    ]);

    const session = loadSessionQuick(filePath);
    assert.equal(session.customTitle, '');

    loadSessionDetail(session);
    assert.equal(session.customTitle, '');
  });

  it('builds search text from user input and final answers only', async () => {
    const filePath = writeSession('2026/04/13/rollout-search.jsonl', [
      {
        timestamp: '2026-04-13T03:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-search',
          timestamp: '2026-04-13T03:00:00.000Z',
          cwd: '/Users/test/Desktop/project-search',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Find the lunar widget' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Find the lunar widget' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'commentary-only-marker' }],
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'agent_message', phase: 'commentary', message: 'event-commentary-marker' },
      },
      {
        type: 'response_item',
        payload: { type: 'reasoning', summary: ['reasoning-only-marker'] },
      },
      {
        type: 'response_item',
        payload: { type: 'custom_tool_call_output', output: 'tool-only-marker' },
      },
      {
        type: 'event_msg',
        payload: { type: 'patch_apply_end', stdout: 'edit-only-marker' },
      },
      {
        type: 'event_msg',
        payload: { type: 'agent_message', phase: 'final_answer', message: 'event-final-marker' },
      },
      {
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'legacy-final-marker' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'The release-summary-marker is ready.' }],
        },
      },
    ]);

    const session = loadSessionQuick(filePath);
    const searchText = await buildSessionSearchText(session);

    assert.match(searchText, /find the lunar widget/);
    assert.match(searchText, /release-summary-marker/);
    assert.match(searchText, /event-final-marker/);
    assert.match(searchText, /legacy-final-marker/);
    assert.doesNotMatch(searchText, /commentary-only-marker/);
    assert.doesNotMatch(searchText, /event-commentary-marker/);
    assert.doesNotMatch(searchText, /reasoning-only-marker/);
    assert.doesNotMatch(searchText, /tool-only-marker/);
    assert.doesNotMatch(searchText, /edit-only-marker/);
  });

  it('defers search indexing and processes sessions incrementally', async () => {
    const sessions = [
      loadSessionQuick(path.join(SESSIONS_DIR, '2026/04/13/rollout-search.jsonl')),
      loadSessionQuick(path.join(SESSIONS_DIR, '2026/04/13/rollout-quick.jsonl')),
    ];
    const scheduled = [];
    const indexed = [];
    let completed = false;

    indexSessionsInBackground(sessions, {
      schedule: callback => scheduled.push(callback),
      onSessionIndexed: session => indexed.push(session.sessionId),
      onComplete: () => { completed = true; },
    });

    assert.equal(indexed.length, 0, 'indexing should not run before the scheduler yields');
    await scheduled.shift()();
    assert.deepEqual(indexed, ['sess-search']);
    assert.match(sessions[0].searchText, /release-summary-marker/);
    assert.equal(completed, false);

    await scheduled.shift()();
    assert.deepEqual(indexed, ['sess-search', 'sess-quick']);
    await scheduled.shift()();
    assert.equal(completed, true);
  });

  it('keeps exact project filtering separate from full-text search', () => {
    const sessions = [
      { sessionId: 'alpha', project: 'project-alpha', topic: 'first topic', searchText: 'release marker' },
      { sessionId: 'beta', project: 'project-beta', topic: 'second topic', searchText: 'mentions project-alpha release marker' },
    ];

    assert.deepEqual(
      filterSessionList(sessions, '', 'project-alpha').map(session => session.sessionId),
      ['alpha'],
    );
    assert.deepEqual(
      filterSessionList(sessions, 'release', 'project-alpha').map(session => session.sessionId),
      ['alpha'],
    );
  });

  it('searches both live custom titles and indexed transcript text', () => {
    const sessions = [
      {
        sessionId: 'alpha',
        project: 'project-alpha',
        topic: 'first topic',
        customTitle: 'Launch Checklist',
        searchText: 'transcript-only marker',
      },
    ];

    assert.deepEqual(filterSessionList(sessions, 'checklist'), sessions);
    assert.deepEqual(filterSessionList(sessions, 'transcript-only'), sessions);
    assert.deepEqual(filterSessionList(sessions, 'checklist marker'), sessions);
  });

  it('classifies exec runs as non-interactive sessions', () => {
    const execSession = loadSessionQuick(path.join(SESSIONS_DIR, '2026/04/13/rollout-detail.jsonl'));
    const cliSession = loadSessionQuick(path.join(SESSIONS_DIR, '2026/04/13/rollout-quick.jsonl'));

    assert.equal(isInteractiveSession(execSession), false);
    assert.equal(isInteractiveSession(cliSession), true);
  });

  it('discovers only interactive sessions from nested date directories', () => {
    writeSession('2026/04/12/rollout-old.jsonl', [
      {
        timestamp: '2026-04-12T02:31:02.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-old',
          timestamp: '2026-04-12T02:31:02.000Z',
          cwd: '/Users/test/Desktop/project-gamma',
          cli_version: '0.120.0',
          model_provider: 'litellm',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-12T02:31:03.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'older session prompt' },
      },
    ]);

    const sessions = loadAllSessions();
    const ids = sessions.map(session => session.sessionId);
    assert.ok(ids.includes('sess-quick'));
    assert.ok(ids.includes('sess-old'));
    assert.ok(!ids.includes('sess-detail'));
  });
});
