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
  buildSessionFamilies,
  buildVisibleSessionRows,
  formatTimestamp,
  formatFileSize,
  loadMeta,
  saveMeta,
  getSessionMeta,
  getDefaultLaunchMode,
  setDefaultLaunchMode,
  getLaunchMode,
  buildCodexCommand,
  switchToAbcInputSource,
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

  it('switches macOS input to ABC with macism', () => {
    const calls = [];
    const runCommand = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    };

    assert.equal(switchToAbcInputSource('darwin', runCommand), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'macism');
    assert.deepEqual(calls[0].args, ['com.apple.keylayout.ABC']);
    assert.equal(calls[0].options.timeout, 1000);
  });

  it('falls back to the built-in macOS input-source API', () => {
    const calls = [];
    const runCommand = (command, args) => {
      calls.push({ command, args });
      if (command === 'macism') return { status: null, error: { code: 'ENOENT' } };
      return { status: 0 };
    };

    assert.equal(switchToAbcInputSource('darwin', runCommand), true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].command, '/usr/bin/osascript');
    assert.deepEqual(calls[1].args.slice(0, 3), ['-l', 'JavaScript', '-e']);
    assert.match(calls[1].args[3], /com\.apple\.keylayout\.ABC/);
    assert.match(calls[1].args[3], /ObjC\.bindFunction\("TISSelectInputSource"/);
    assert.match(calls[1].args[3], /sources\.objectAtIndex\(0\)/);
  });

  it('does not switch input sources outside macOS', () => {
    let called = false;
    assert.equal(switchToAbcInputSource('linux', () => { called = true; }), false);
    assert.equal(called, false);
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

  it('keeps fork metadata canonical when inherited parent metadata follows it', () => {
    const filePath = writeSession('2026/04/13/rollout-fork.jsonl', [
      {
        timestamp: '2026-04-13T04:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'fork-child',
          forked_from_id: 'fork-parent',
          timestamp: '2026-04-13T04:00:00.000Z',
          cwd: '/Users/test/Desktop/fork-child',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-13T03:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'fork-parent',
          timestamp: '2026-04-13T03:00:00.000Z',
          cwd: '/Users/test/Desktop/fork-parent',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-13T04:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'edited branch prompt' },
      },
    ]);

    const session = loadSessionQuick(filePath);
    assert.equal(session.sessionId, 'fork-child');
    assert.equal(session.forkedFromId, 'fork-parent');
    assert.deepEqual(session.ancestorIds, ['fork-parent']);

    loadSessionDetail(session);
    assert.equal(session.sessionId, 'fork-child');
    assert.equal(session.forkedFromId, 'fork-parent');
    assert.equal(session.cwd, '/Users/test/Desktop/fork-child');
  });

  it('reads complete fork ancestry beyond the quick-scan byte limit', () => {
    const padding = 'x'.repeat(140 * 1024);
    const filePath = writeSession('2026/04/13/rollout-deep-fork.jsonl', [
      {
        type: 'session_meta',
        payload: {
          id: 'deep-child',
          forked_from_id: 'deep-parent',
          timestamp: '2026-04-13T05:00:00.000Z',
          cwd: '/Users/test/Desktop/deep-fork',
          source: 'cli',
          base_instructions: padding,
        },
      },
      {
        type: 'session_meta',
        payload: {
          id: 'deep-parent',
          forked_from_id: 'deep-root',
          timestamp: '2026-04-13T04:00:00.000Z',
          cwd: '/Users/test/Desktop/deep-fork',
          source: 'cli',
          base_instructions: padding,
        },
      },
      {
        type: 'event_msg',
        timestamp: '2026-04-13T05:00:01.000Z',
        payload: { type: 'user_message', message: 'deep fork prompt' },
      },
    ]);

    const session = loadSessionQuick(filePath);
    assert.deepEqual(session.ancestorIds, ['deep-parent', 'deep-root']);
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
    assert.equal(isInteractiveSession({ source: 'cli', originator: '', threadSource: 'subagent' }), false);
    assert.equal(isInteractiveSession({
      source: 'cli',
      originator: '',
      threadSource: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } },
    }), false);
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

describe('fork families', () => {
  function session(sessionId, forkedFromId, lastTs) {
    return {
      sessionId,
      forkedFromId: forkedFromId || '',
      firstTs: lastTs,
      lastTs,
      topic: sessionId,
      project: 'fork-project',
    };
  }

  it('keeps singletons as ordinary session rows', () => {
    const only = session('only', '', '2026-04-13T01:00:00.000Z');
    const families = buildSessionFamilies([only]);
    const rows = buildVisibleSessionRows(families, new Set());

    assert.equal(families.length, 1);
    assert.equal(families[0].hasForks, false);
    assert.deepEqual(rows.map(row => [row.kind, row.session.sessionId]), [['session', 'only']]);
  });

  it('aggregates linear and parallel forks and chooses the newest leaf', () => {
    const root = session('root', '', '2026-04-13T01:00:00.000Z');
    const branchA = session('branch-a', 'root', '2026-04-13T02:00:00.000Z');
    const branchB = session('branch-b', 'root', '2026-04-13T03:00:00.000Z');
    const grandchild = session('grandchild', 'branch-a', '2026-04-13T04:00:00.000Z');
    const families = buildSessionFamilies([grandchild, branchB, branchA, root]);
    const family = families[0];

    assert.equal(families.length, 1);
    assert.equal(family.familyId, 'root');
    assert.equal(family.defaultSession.sessionId, 'grandchild');
    assert.deepEqual(
      family.childrenById.get('root').map(member => member.sessionId),
      ['branch-a', 'branch-b'],
    );

    const collapsed = buildVisibleSessionRows(families, new Set());
    assert.deepEqual(collapsed.map(row => row.kind), ['family']);
    assert.equal(collapsed[0].session.sessionId, 'grandchild');

    const expanded = buildVisibleSessionRows(families, new Set(['root']));
    assert.deepEqual(
      expanded.map(row => `${row.kind}:${row.session.sessionId}`),
      [
        'family:grandchild',
        'session:root',
        'session:branch-a',
        'session:grandchild',
        'session:branch-b',
      ],
    );
    assert.equal(expanded.find(row => row.session.sessionId === 'grandchild').isDefault, true);
  });

  it('starts an orphaned fork as its own family and honors later parent activity', () => {
    const orphan = session('orphan', 'missing', '2026-04-13T02:00:00.000Z');
    const root = session('root-later', '', '2026-04-13T05:00:00.000Z');
    const child = session('child-earlier', 'root-later', '2026-04-13T04:00:00.000Z');
    const families = buildSessionFamilies([root, child, orphan]);
    const parentFamily = families.find(family => family.familyId === 'root-later');

    assert.equal(families.length, 2);
    assert.equal(parentFamily.defaultSession.sessionId, 'root-later');
  });

  it('keeps sibling forks grouped when their common parent is missing', () => {
    const branchA = session('orphan-a', 'deleted-parent', '2026-04-13T02:00:00.000Z');
    const branchB = session('orphan-b', 'deleted-parent', '2026-04-13T03:00:00.000Z');
    const families = buildSessionFamilies([branchB, branchA]);

    assert.equal(families.length, 1);
    assert.equal(families[0].familyId, 'deleted-parent');
    assert.equal(families[0].hasForks, true);
    assert.equal(families[0].defaultSession.sessionId, 'orphan-b');
    assert.deepEqual(
      buildVisibleSessionRows(families, new Set(['deleted-parent']))
        .filter(row => row.kind === 'session')
        .map(row => row.session.sessionId)
        .sort(),
      ['orphan-a', 'orphan-b'],
    );
  });

  it('reconnects descendants through inherited ancestry after an intermediate fork is deleted', () => {
    const root = session('surviving-root', '', '2026-04-13T01:00:00.000Z');
    const grandchild = session('surviving-grandchild', 'deleted-middle', '2026-04-13T03:00:00.000Z');
    grandchild.ancestorIds = ['deleted-middle', 'surviving-root'];
    const families = buildSessionFamilies([grandchild, root]);

    assert.equal(families.length, 1);
    assert.equal(families[0].root.sessionId, 'surviving-root');
    assert.deepEqual(
      families[0].childrenById.get('surviving-root').map(member => member.sessionId),
      ['surviving-grandchild'],
    );
  });

  it('groups descendants by their oldest shared ancestor when multiple branches were deleted', () => {
    const branchA = session('survivor-a', 'deleted-a', '2026-04-13T03:00:00.000Z');
    branchA.ancestorIds = ['deleted-a', 'deleted-root'];
    const branchB = session('survivor-b', 'deleted-b', '2026-04-13T04:00:00.000Z');
    branchB.ancestorIds = ['deleted-b', 'deleted-root'];
    const families = buildSessionFamilies([branchB, branchA]);

    assert.equal(families.length, 1);
    assert.equal(families[0].familyId, 'deleted-root');
    assert.deepEqual(families[0].members.map(member => member.sessionId).sort(), [
      'survivor-a',
      'survivor-b',
    ]);
  });

  it('derives the surviving orphan root from ancestry rather than activity order', () => {
    const ancestor = session('resumed-ancestor', 'deleted-parent', '2026-04-13T05:00:00.000Z');
    const child = session('older-child', 'resumed-ancestor', '2026-04-13T04:00:00.000Z');
    const family = buildSessionFamilies([ancestor, child])[0];

    assert.equal(family.root.sessionId, 'resumed-ancestor');
    assert.deepEqual(family.childrenById.get('resumed-ancestor').map(member => member.sessionId), [
      'older-child',
    ]);
  });

  it('orders a family by the session represented by its collapsed row', () => {
    const root = session('large-old-root', '', '2026-04-13T01:00:00.000Z');
    const singleton = session('medium-singleton', '', '2026-04-13T02:00:00.000Z');
    const latest = session('small-latest-fork', 'large-old-root', '2026-04-13T03:00:00.000Z');
    // Simulate a caller sorting by size: root first, singleton second, latest
    // third. The family row represents latest, so it belongs after singleton.
    const families = buildSessionFamilies([root, singleton, latest]);

    assert.deepEqual(families.map(family => family.defaultSession.sessionId), [
      'medium-singleton',
      'small-latest-fork',
    ]);
  });
});
