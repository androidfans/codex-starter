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
  findLatestCodexStateDatabase,
  loadCodexThreadNamesResult,
  loadCodexThreadNames,
  applyCodexThreadNames,
  getSessionDisplayTitle,
  getForkReason,
  buildSessionSearchText,
  indexSessionsInBackground,
  updateSessionCacheRecord,
  flushSessionCache,
  isInteractiveSession,
  loadAllSessions,
  attachSessionRolloutFiles,
  refreshAttachedRolloutBounds,
  filterSessionList,
  buildSessionFamilies,
  buildVisibleSessionRows,
  getFamilyTitleForRow,
  rowTargetsFamilyTitle,
  reconcileFamilyMetaAfterDelete,
  formatTimestamp,
  formatFamilySpan,
  formatFileSize,
  esc,
  truncateDisplayText,
  getFamilyForkCount,
  getVersionLabelText,
  loadMeta,
  saveMeta,
  getSessionMeta,
  getDefaultLaunchMode,
  setDefaultLaunchMode,
  getLaunchMode,
  buildCodexCommand,
  switchToAbcInputSource,
  createInputSourceActivator,
  detectCLI,
  getShellCommand,
  CODEX_DIR,
  SESSIONS_DIR,
  META_FILE,
  CACHE_FILE,
  DIAGNOSTIC_LOG_FILE,
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
    assert.equal(CACHE_FILE, path.join(tmpHome, '.codex', 'codex-starter-cache.json'));
    assert.equal(
      DIAGNOSTIC_LOG_FILE,
      path.join(tmpHome, '.codex', 'codex-starter-diagnostics.jsonl'),
    );
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

  it('truncates long and wide titles by terminal display width', () => {
    assert.equal(truncateDisplayText('你好世界', 5), '你好…');
    assert.equal(truncateDisplayText('👨‍👩‍👧‍👦abc', 3), '👨‍👩‍👧‍👦…');
    assert.equal(truncateDisplayText('a'.repeat(10000), 10), 'a'.repeat(9) + '…');
    assert.equal(
      getForkReason({ topic: 'a'.repeat(119) + '😀tail' }),
      'a'.repeat(119) + '😀',
    );
  });

  it('escapes literal braces with blessed-compatible tags', () => {
    assert.equal(esc('docs/{spec,history}.md'), 'docs/{open}spec,history{close}.md');
    assert.equal(
      esc('{red-fg}unsafe{/}'),
      '{open}red-fg{close}unsafe{open}/{close}',
    );
  });

  it('loads and persists meta', () => {
    saveMeta({ sessions: { abc: { customTitle: 'Pinned' } } });
    const meta = loadMeta();
    assert.equal(getSessionMeta(meta, 'abc').customTitle, 'Pinned');
    assert.deepEqual(getSessionMeta(meta, 'missing'), {});
  });

  it('loads AI-generated thread names from the newest Codex state database', () => {
    const olderDatabase = path.join(CODEX_DIR, 'state_3.sqlite');
    const newestDatabase = path.join(CODEX_DIR, 'state_5.sqlite');
    fs.writeFileSync(olderDatabase, '');
    fs.writeFileSync(newestDatabase, '');
    const calls = [];

    const names = loadCodexThreadNames({
      runCommand(command, args, options) {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout: JSON.stringify([
            { id: 'thread-a', name: ' Fix login redirect ' },
            { id: 'thread-empty', name: ' ' },
          ]),
        };
      },
    });

    assert.equal(findLatestCodexStateDatabase(), newestDatabase);
    assert.equal(calls[0].command, 'sqlite3');
    assert.ok(calls[0].args.includes(newestDatabase));
    assert.deepEqual(calls[0].args.slice(0, 3), [
      '-cmd',
      'PRAGMA query_only=ON;',
      '-json',
    ]);
    assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(names.get('thread-a'), 'Fix login redirect');
    assert.equal(names.has('thread-empty'), false);

    fs.unlinkSync(olderDatabase);
    fs.unlinkSync(newestDatabase);
  });

  it('distinguishes a failed AI-title query from a valid empty result', () => {
    const database = path.join(CODEX_DIR, 'state_5.sqlite');
    fs.writeFileSync(database, '');

    const failed = loadCodexThreadNamesResult({
      runCommand() {
        return { status: 5, stderr: 'database is locked', stdout: '' };
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.names.size, 0);

    const empty = loadCodexThreadNamesResult({
      runCommand() {
        return { status: 0, stdout: '[]' };
      },
    });
    assert.equal(empty.ok, true);
    assert.equal(empty.names.size, 0);

    fs.unlinkSync(database);
    const missing = loadCodexThreadNamesResult();
    assert.equal(missing.ok, true);
    assert.equal(missing.names.size, 0);

    const diagnostics = fs.readFileSync(DIAGNOSTIC_LOG_FILE, 'utf-8')
      .trim().split('\n').map(line => JSON.parse(line))
      .filter(entry => entry.event === 'thread_names_read');
    assert.ok(diagnostics.some(entry => entry.reason === 'sqlite_command_failed'));
    assert.ok(diagnostics.some(entry => entry.reason === 'success' && entry.titleCount === 0));
    assert.ok(diagnostics.some(entry => entry.reason === 'database_not_found'));
  });

  it('prefers manual titles, then Codex AI titles, then the first prompt', () => {
    const sessions = [
      { sessionId: 'a', topic: 'raw prompt' },
      { sessionId: 'b', topic: 'other prompt', customTitle: 'Manual title' },
    ];
    applyCodexThreadNames(sessions, new Map([
      ['a', 'Generated title'],
      ['b', 'Ignored generated title'],
    ]));

    assert.equal(getSessionDisplayTitle(sessions[0]), 'Generated title');
    assert.equal(getSessionDisplayTitle(sessions[1]), 'Manual title');
    assert.equal(getSessionDisplayTitle({ topic: 'Fallback prompt' }), 'Fallback prompt');
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

  it('debounces repeated input-source activation', () => {
    let currentTime = 1000;
    let switchCount = 0;
    const activate = createInputSourceActivator(
      () => { switchCount++; return true; },
      () => currentTime,
    );

    assert.equal(activate(), true);
    currentTime = 1100;
    assert.equal(activate(), false);
    currentTime = 1250;
    assert.equal(activate(), true);
    assert.equal(switchCount, 2);
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

  it.skip('legacy same-session fragments without physical history links', () => {
    const firstPath = writeSession('2026/04/10/rollout-2026-04-10T01-00-00-sess-resumed.jsonl', [
      {
        timestamp: '2026-04-10T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-resumed',
          timestamp: '2026-04-10T01:00:00.000Z',
          cwd: '/Users/test/Desktop/project-resumed',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-10T01:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'original request' },
      },
      {
        timestamp: '2026-04-10T01:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'first response' },
      },
      {
        timestamp: '2026-04-10T01:10:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'late original follow-up' },
      },
      { type: 'custom-title', customTitle: '' },
    ]);
    const continuedPath = writeSession('2026/04/11/rollout-2026-04-11T01-00-00-sess-resumed.jsonl', [
      {
        timestamp: '2026-04-11T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-resumed',
          timestamp: '2026-04-11T01:00:00.000Z',
          cwd: '/Users/test/Desktop/project-resumed',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-10T01:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'original request' },
      },
      {
        timestamp: '2026-04-10T01:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'first response' },
      },
      {
        timestamp: '2026-04-10T01:05:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'continued request' },
      },
      {
        timestamp: '2026-04-10T01:06:00.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'continued response' },
      },
      { type: 'custom-title', customTitle: 'stale title' },
    ]);

    try {
      const sessions = loadAllSessions({ useCache: false, threadNames: new Map() });
      const fragments = sessions.filter(session => session.sessionId === 'sess-resumed');
      assert.equal(fragments.length, 2);
      assert.equal(fragments[0].filePath, firstPath,
        'the fragment with the latest activity remains representative');
      assert.deepEqual(fragments[0].rolloutFilePaths, [firstPath, continuedPath]);
      assert.equal(fragments[0].rolloutFirstTs, '2026-04-10T01:00:00.000Z');
      assert.equal(fragments[0].rolloutLastTs, '2026-04-10T01:10:00.000Z');
      assert.equal(fragments[0].firstTs, '2026-04-10T01:00:00.000Z');
      assert.equal(fragments[1].firstTs, '2026-04-11T01:00:00.000Z',
        'physical rollouts keep distinct timestamps for sorting and list mode');
      for (const fragment of fragments) updateSessionCacheRecord(sessions, fragment);
      flushSessionCache(sessions);
      const cachedFiles = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')).files;
      assert.equal(cachedFiles[firstPath].session.firstTs, '2026-04-10T01:00:00.000Z');
      assert.equal(cachedFiles[continuedPath].session.firstTs, '2026-04-11T01:00:00.000Z');

      const originalReadFileSync = fs.readFileSync;
      fs.readFileSync = function(target, ...args) {
        if (target === firstPath || target === continuedPath) {
          throw new Error('detail loading must stream rollout fragments');
        }
        return originalReadFileSync.call(this, target, ...args);
      };
      try {
        loadSessionDetail(fragments[0]);
      } finally {
        fs.readFileSync = originalReadFileSync;
      }
      assert.deepEqual(fragments[0].userMessages, [
        'original request',
        'continued request',
        'late original follow-up',
      ]);
      assert.deepEqual(fragments[0].assistantSnippets, ['first response', 'continued response']);
      assert.equal(fragments[0].topic, 'original request');
      assert.equal(fragments[0].totalMessages, 5);
      assert.equal(fragments[0].customTitle, '');
      assert.equal(fragments[0].firstTs, '2026-04-10T01:00:00.000Z');
      assert.equal(fragments[0].duration, '10m');

      fragments[1]._rolloutFileLastTs = '2026-04-12T01:00:00.000Z';
      refreshAttachedRolloutBounds(fragments[1]);
      assert.equal(fragments[0].lastTs, '2026-04-12T01:00:00.000Z',
        'loaded details receive bounds discovered while another fragment is indexed');

      fragments[0]._detailLoaded = false;
      loadSessionDetail(fragments[0]);
      assert.equal(fragments[0].lastTs, '2026-04-12T01:00:00.000Z',
        'detail loading preserves a fresher timestamp found by background indexing');

      const survivor = fragments[1];
      const survivorFileFirstTs = survivor._rolloutFileFirstTs;
      const survivorFileLastTs = survivor._rolloutFileLastTs;
      survivor._detailLoaded = true;
      survivor.userMessages = ['stale merged detail'];
      survivor.firstTs = fragments[0].rolloutFirstTs;
      survivor.lastTs = '2026-04-12T01:00:00.000Z';
      attachSessionRolloutFiles(sessions.filter(candidate => candidate !== fragments[0]));
      assert.deepEqual(survivor.rolloutFilePaths, [continuedPath]);
      assert.equal(survivor.rolloutFirstTs, '2026-04-11T01:00:00.000Z');
      assert.equal(survivor.firstTs, survivorFileFirstTs);
      assert.equal(survivor.lastTs, survivorFileLastTs);
      assert.equal(survivor._detailLoaded, false);
      assert.equal(survivor.userMessages, undefined);
    } finally {
      fs.unlinkSync(firstPath);
      fs.unlinkSync(continuedPath);
    }
  });

  it('keeps current unlinked physical rollouts separate', () => {
    const sessionId = '99999999-9999-7999-8999-999999999999';
    const continuationId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
    const firstPath = writeSession(`2026/04/12/rollout-current-${sessionId}.jsonl`, [
      {
        timestamp: '2026-04-12T00:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: '2026-04-12T00:00:00.000Z',
          cwd: '/Users/test/Desktop/current-unlinked',
          source: 'vscode',
          history_mode: 'paginated',
        },
      },
      {
        timestamp: '2026-04-12T00:01:00.000Z',
        ordinal: 1,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'first current fragment' },
      },
    ]);
    const continuationPath = writeSession(
      `2026/04/12/rollout-current-${sessionId}_${continuationId}.jsonl`,
      [
        {
          timestamp: '2026-04-12T00:02:00.000Z',
          ordinal: 0,
          type: 'session_meta',
          payload: {
            id: sessionId,
            timestamp: '2026-04-12T00:02:00.000Z',
            cwd: '/Users/test/Desktop/current-unlinked',
            source: 'vscode',
            history_mode: 'paginated',
          },
        },
        {
          timestamp: '2026-04-12T00:03:00.000Z',
          ordinal: 1,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'second current fragment' },
        },
      ],
    );

    try {
      const sessions = loadAllSessions({ useCache: false, threadNames: new Map() });
      const session = sessions.find(candidate => (
        candidate.sessionId === sessionId && candidate.filePath === continuationPath
      ));
      loadSessionDetail(session);
      assert.deepEqual(session.userMessages, ['second current fragment']);
      assert.equal(session.firstTs, '2026-04-12T00:02:00.000Z');
      assert.equal(session.lastTs, '2026-04-12T00:03:00.000Z');

      const firstFragment = sessions.find(candidate => candidate.filePath === firstPath);
      firstFragment._rolloutFileLastTs = '2026-04-13T00:00:00.000Z';
      refreshAttachedRolloutBounds(firstFragment);
      assert.equal(session.firstTs, '2026-04-12T00:02:00.000Z');
      assert.equal(session.lastTs, '2026-04-12T00:03:00.000Z');
    } finally {
      fs.unlinkSync(firstPath);
      fs.unlinkSync(continuationPath);
    }
  });

  it.skip('fork ancestry without physical history links', () => {
    const rootPath = writeSession('2026/04/14/rollout-2026-04-14T08-00-00-fork-root.jsonl', [
      {
        timestamp: '2026-04-14T00:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: 'fork-history-root',
          timestamp: '2026-04-14T00:00:00.000Z',
          cwd: '/Users/test/Desktop/fork-history',
          source: 'vscode',
        },
      },
      {
        timestamp: '2026-04-14T00:08:00.000Z',
        ordinal: 8,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'early root request' },
      },
      {
        timestamp: '2026-04-14T00:09:00.000Z',
        ordinal: 9,
        type: 'response_item',
        payload: { type: 'function_call', name: 'root_tool', arguments: '{}' },
      },
      {
        timestamp: '2026-04-14T00:10:00.000Z',
        ordinal: 10,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'root request' },
      },
      {
        timestamp: '2026-04-14T00:11:00.000Z',
        ordinal: 11,
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'root response' },
      },
      {
        timestamp: '2026-04-14T00:30:00.000Z',
        ordinal: 12,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'root request after parent fork' },
      },
    ]);
    const rootResumePath = writeSession(
      '2026/04/14/rollout-2026-04-14T11-00-00-fork-root-resume.jsonl',
      [
        {
          timestamp: '2026-04-14T03:00:00.000Z',
          ordinal: 10,
          type: 'session_meta',
          payload: {
            id: 'fork-history-root',
            timestamp: '2026-04-14T03:00:00.000Z',
            cwd: '/Users/test/Desktop/fork-history',
            source: 'vscode',
          },
        },
        {
          timestamp: '2026-04-14T00:10:00.000Z',
          ordinal: 10,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'root request' },
        },
        {
          timestamp: '2026-04-14T00:11:00.000Z',
          ordinal: 11,
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'root response' },
        },
        {
          timestamp: '2026-04-14T03:01:00.000Z',
          ordinal: 20,
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'root response after all forks' },
        },
      ],
    );
    const parentPath = writeSession('2026/04/14/rollout-2026-04-14T09-00-00-fork-parent.jsonl', [
      {
        timestamp: '2026-04-14T01:00:00.000Z',
        ordinal: 12,
        type: 'session_meta',
        payload: {
          id: 'fork-history-parent',
          forked_from_id: 'fork-history-root',
          forked_from_ordinal_exclusive: 12,
          timestamp: '2026-04-14T01:00:00.000Z',
          cwd: '/Users/test/Desktop/fork-history',
          source: 'vscode',
        },
      },
      {
        timestamp: '2026-04-14T01:09:00.000Z',
        ordinal: 13,
        type: 'response_item',
        payload: { type: 'function_call', name: 'parent_tool', arguments: '{}' },
      },
      {
        timestamp: '2026-04-14T01:10:00.000Z',
        ordinal: 14,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'parent request' },
      },
      {
        timestamp: '2026-04-14T01:11:00.000Z',
        ordinal: 15,
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'parent response' },
      },
      {
        timestamp: '2026-04-14T01:30:00.000Z',
        ordinal: 16,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'parent request after child fork' },
      },
    ]);
    const childPath = writeSession('2026/04/14/rollout-2026-04-14T10-00-00-fork-child.jsonl', [
      {
        timestamp: '2026-04-14T02:00:00.000Z',
        ordinal: 16,
        type: 'session_meta',
        payload: {
          id: 'fork-history-child',
          forked_from_id: 'fork-history-parent',
          forked_from_ordinal_exclusive: 16,
          timestamp: '2026-04-14T02:00:00.000Z',
          cwd: '/Users/test/Desktop/fork-history',
          source: 'vscode',
        },
      },
      {
        timestamp: '2026-04-14T02:09:00.000Z',
        ordinal: 17,
        type: 'response_item',
        payload: { type: 'function_call', name: 'child_tool', arguments: '{}' },
      },
      {
        timestamp: '2026-04-14T02:10:00.000Z',
        ordinal: 18,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'child request' },
      },
      {
        timestamp: '2026-04-14T02:11:00.000Z',
        ordinal: 19,
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'child response' },
      },
    ]);
    const childResumePath = writeSession(
      '2026/04/14/rollout-2026-04-14T11-30-00-fork-child-resume.jsonl',
      [
        {
          timestamp: '2026-04-14T03:30:00.000Z',
          ordinal: 20,
          type: 'session_meta',
          payload: {
            id: 'fork-history-child',
            forked_from_id: 'fork-history-parent',
            timestamp: '2026-04-14T03:30:00.000Z',
            cwd: '/Users/test/Desktop/fork-history',
            source: 'vscode',
          },
        },
        {
          timestamp: '2026-04-14T03:31:00.000Z',
          ordinal: 21,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'child continuation' },
        },
      ],
    );
    const editedChildPath = writeSession(
      '2026/04/14/rollout-2026-04-14T12-00-00-fork-edited-child.jsonl',
      [
        {
          timestamp: '2026-04-14T04:00:00.000Z',
          ordinal: 10,
          type: 'session_meta',
          payload: {
            id: 'fork-history-edited-child',
            forked_from_id: 'fork-history-parent',
            forked_from_ordinal_exclusive: 10,
            timestamp: '2026-04-14T04:00:00.000Z',
            cwd: '/Users/test/Desktop/fork-history',
            source: 'vscode',
          },
        },
        {
          timestamp: '2026-04-14T04:01:00.000Z',
          ordinal: 11,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'edited child request' },
        },
      ],
    );

    try {
      const sessions = loadAllSessions({ useCache: false, threadNames: new Map() });
      const child = sessions.find(session => session.sessionId === 'fork-history-child');
      assert.ok(child);
      assert.deepEqual(
        child._inheritedRolloutGroups.map(group => ({
          sessionId: group.sessionId,
          beforeOrdinal: group.beforeOrdinal,
          beforeTimestamp: group.beforeTimestamp,
        })),
        [
          {
            sessionId: 'fork-history-root',
            beforeOrdinal: 12,
            beforeTimestamp: '2026-04-14T01:00:00.000Z',
          },
          {
            sessionId: 'fork-history-parent',
            beforeOrdinal: 16,
            beforeTimestamp: '2026-04-14T02:00:00.000Z',
          },
        ],
      );

      loadSessionDetail(child);
      assert.deepEqual(child.userMessages, [
        'early root request',
        'root request',
        'parent request',
        'child request',
        'child continuation',
      ]);
      assert.deepEqual(child.assistantSnippets, [
        'root response',
        'parent response',
        'child response',
      ]);
      assert.equal(child.totalMessages, 8);
      assert.equal(child.topic, 'child request', 'the first fork-local prompt wins over continuation');
      assert.deepEqual(child.toolsUsed, ['root_tool', 'parent_tool', 'child_tool']);
      assert.equal(child.firstTs, '2026-04-14T02:00:00.000Z');

      const editedChild = sessions.find(session => (
        session.sessionId === 'fork-history-edited-child'
      ));
      assert.deepEqual(
        editedChild._inheritedRolloutGroups.map(group => group.beforeOrdinal),
        [10, 10],
        'an earlier descendant edit caps every ancestor edge',
      );
      loadSessionDetail(editedChild);
      assert.deepEqual(editedChild.userMessages, [
        'early root request',
        'edited child request',
      ]);
      assert.deepEqual(editedChild.toolsUsed, ['root_tool']);

      const sessionsWithoutOriginalChild = sessions.filter(session => (
        session.filePath !== childPath
      ));
      attachSessionRolloutFiles(sessionsWithoutOriginalChild);
      assert.equal(child._inheritedRolloutGroups.at(-1).beforeOrdinal, 16,
        'the fork ordinal survives deletion of the original physical rollout');
      child._detailLoaded = false;
      loadSessionDetail(child);
      assert.ok(!child.userMessages.includes('parent request after child fork'));

      const sessionsWithoutParent = sessionsWithoutOriginalChild.filter(session => (
        session.sessionId !== 'fork-history-parent'
      ));
      attachSessionRolloutFiles(sessionsWithoutParent);
      assert.equal(child._detailLoaded, false);
      assert.deepEqual(child._inheritedRolloutGroups, []);
      loadSessionDetail(child);
      assert.deepEqual(child.userMessages, ['child continuation']);
      assert.deepEqual(child.assistantSnippets, []);
    } finally {
      fs.unlinkSync(rootPath);
      fs.unlinkSync(rootResumePath);
      fs.unlinkSync(parentPath);
      fs.unlinkSync(childPath);
      fs.unlinkSync(childResumePath);
      fs.unlinkSync(editedChildPath);
    }
  });

  it('reads current fork rollouts with embedded ancestor history', () => {
    const parentPath = writeSession('2026/04/15/rollout-legacy-parent.jsonl', [
      {
        timestamp: '2026-04-15T00:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: 'legacy-fork-parent',
          timestamp: '2026-04-15T00:00:00.000Z',
          cwd: '/Users/test/Desktop/legacy-fork',
          source: 'cli',
          history_mode: 'paginated',
        },
      },
      {
        timestamp: '2026-04-15T00:01:00.000Z',
        ordinal: 1,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'embedded parent request' },
      },
    ]);
    const childPath = writeSession('2026/04/15/rollout-legacy-child.jsonl', [
      {
        timestamp: '2026-04-15T01:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: 'legacy-fork-child',
          forked_from_id: 'legacy-fork-parent',
          timestamp: '2026-04-15T01:00:00.000Z',
          cwd: '/Users/test/Desktop/legacy-fork',
          source: 'cli',
          history_mode: 'paginated',
        },
      },
      {
        timestamp: '2026-04-15T00:00:00.000Z',
        ordinal: 1,
        type: 'session_meta',
        payload: {
          id: 'legacy-fork-parent',
          timestamp: '2026-04-15T00:00:00.000Z',
          cwd: '/Users/test/Desktop/legacy-fork',
          source: 'cli',
          history_mode: 'paginated',
        },
      },
      {
        timestamp: '2026-04-15T01:00:01.000Z',
        ordinal: 2,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'embedded parent request' },
      },
      {
        timestamp: '2026-04-15T01:01:00.000Z',
        ordinal: 3,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'legacy child request' },
      },
    ]);
    const continuationPath = writeSession('2026/04/15/rollout-legacy-child-continuation.jsonl', [
      {
        timestamp: '2026-04-15T02:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'legacy-fork-child',
          forked_from_id: 'legacy-fork-parent',
          timestamp: '2026-04-15T02:00:00.000Z',
          cwd: '/Users/test/Desktop/legacy-fork',
          source: 'cli',
        },
      },
      {
        timestamp: '2026-04-15T02:01:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'legacy child continuation' },
      },
    ]);

    try {
      const sessions = loadAllSessions({ useCache: false, threadNames: new Map() });
      const child = sessions.find(session => session.filePath === childPath);
      assert.equal(child.hasEmbeddedForkHistory, true);
      assert.equal(child._hasEmbeddedForkHistory, true);
      assert.deepEqual(child._inheritedRolloutGroups, []);
      loadSessionDetail(child);
      assert.deepEqual(child.userMessages, [
        'embedded parent request',
        'legacy child request',
      ]);
    } finally {
      fs.unlinkSync(parentPath);
      fs.unlinkSync(childPath);
      fs.unlinkSync(continuationPath);
    }
  });

  it('follows the physical parent history chain instead of sibling resumes', () => {
    const parentId = '11111111-1111-7111-8111-111111111111';
    const chosenThreadId = '22222222-2222-7222-8222-222222222222';
    const siblingThreadId = '33333333-3333-7333-8333-333333333333';
    const childId = '44444444-4444-7444-8444-444444444444';
    const childContinuationThreadId = '55555555-5555-7555-8555-555555555555';
    const parentPath = writeSession(`2026/04/16/rollout-2026-04-16T08-00-00-${parentId}.jsonl`, [
      {
        timestamp: '2026-04-16T00:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: parentId,
          timestamp: '2026-04-16T00:00:00.000Z',
          cwd: '/Users/test/Desktop/physical-fork',
          source: 'vscode',
        },
      },
      {
        timestamp: '2026-04-16T00:01:00.000Z',
        ordinal: 1,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'physical parent request' },
      },
      {
        timestamp: '2026-04-18T00:02:00.000Z',
        ordinal: 2,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'abandoned parent suffix' },
      },
    ]);
    const chosenPath = writeSession(
      `2026/04/16/rollout-2026-04-16T09-00-00-${parentId}_${chosenThreadId}.jsonl`,
      [
        {
          timestamp: '2026-04-16T01:00:00.000Z',
          ordinal: 2,
          type: 'session_meta',
          payload: {
            id: parentId,
            timestamp: '2026-04-16T01:00:00.000Z',
            cwd: '/Users/test/Desktop/physical-fork',
            source: 'vscode',
            history_base: { thread_id: parentId, end_ordinal_exclusive: 2 },
          },
        },
        {
          timestamp: '2026-04-16T01:01:00.000Z',
          ordinal: 3,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'chosen parent continuation' },
        },
      ],
    );
    const siblingPath = writeSession(
      `2026/04/16/rollout-2026-04-16T10-00-00-${parentId}_${siblingThreadId}.jsonl`,
      [
        {
          timestamp: '2026-04-16T02:00:00.000Z',
          ordinal: 2,
          type: 'session_meta',
          payload: {
            id: parentId,
            timestamp: '2026-04-16T02:00:00.000Z',
            cwd: '/Users/test/Desktop/physical-fork',
            source: 'vscode',
            history_base: { thread_id: parentId, end_ordinal_exclusive: 2 },
          },
        },
        {
          timestamp: '2026-04-16T02:01:00.000Z',
          ordinal: 3,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'unrelated sibling continuation' },
        },
      ],
    );
    const childPath = writeSession(`2026/04/16/rollout-2026-04-16T11-00-00-${childId}.jsonl`, [
      {
        timestamp: '2026-04-16T03:00:00.000Z',
        ordinal: 4,
        type: 'session_meta',
        payload: {
          id: childId,
          forked_from_id: parentId,
          forked_from_ordinal_exclusive: 4,
          timestamp: '2026-04-16T03:00:00.000Z',
          cwd: '/Users/test/Desktop/physical-fork',
          source: 'vscode',
          history_base: { thread_id: chosenThreadId, end_ordinal_exclusive: 4 },
        },
      },
      {
        timestamp: '2026-04-16T03:01:00.000Z',
        ordinal: 5,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'physical child request' },
      },
    ]);
    const childContinuationPath = writeSession(
      `2026/04/16/rollout-2026-04-16T12-00-00-${childId}_${childContinuationThreadId}.jsonl`,
      [
        {
          timestamp: '2026-04-16T04:00:00.000Z',
          ordinal: 6,
          type: 'session_meta',
          payload: {
            id: childId,
            forked_from_id: parentId,
            timestamp: '2026-04-16T04:00:00.000Z',
            cwd: '/Users/test/Desktop/physical-fork',
            source: 'vscode',
            history_base: { thread_id: childId, end_ordinal_exclusive: 6 },
          },
        },
        {
          timestamp: '2026-04-16T04:01:00.000Z',
          ordinal: 7,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'physical child continuation' },
        },
      ],
    );

    try {
      const sessions = loadAllSessions({ threadNames: new Map() });
      const child = sessions.find(session => session.sessionId === childId);
      assert.deepEqual(child._inheritedRolloutGroups[0].filePaths, [parentPath, chosenPath]);
      loadSessionDetail(child);
      assert.deepEqual(child.userMessages, [
        'physical parent request',
        'chosen parent continuation',
        'physical child request',
        'physical child continuation',
      ]);
      assert.ok(!child.userMessages.includes('unrelated sibling continuation'));
      assert.ok(!child.userMessages.includes('abandoned parent suffix'));
      assert.equal(child.lastTs, '2026-04-16T04:01:00.000Z');

      const childContinuation = sessions.find(session => (
        session.filePath === childContinuationPath
      ));
      childContinuation._rolloutFileLastTs = '2026-04-16T05:00:00.000Z';
      refreshAttachedRolloutBounds(childContinuation);
      assert.equal(child.lastTs, '2026-04-16T05:00:00.000Z',
        'fresh indexing on the unbounded terminal rollout advances Last active');
      child._detailLoaded = false;
      loadSessionDetail(child);
      assert.equal(child.lastTs, '2026-04-16T05:00:00.000Z',
        'detail loading does not regress a fresher terminal rollout timestamp');

      fs.unlinkSync(childPath);
      const reloadedSessions = loadAllSessions({ threadNames: new Map() });
      const reloadedChild = reloadedSessions.find(session => session.sessionId === childId);
      assert.equal(reloadedChild.forkedFromOrdinalExclusive, 4);
      assert.equal(reloadedChild.parentHistoryThreadId, chosenThreadId);
      loadSessionDetail(reloadedChild);
      assert.deepEqual(reloadedChild.userMessages, [
        'physical parent request',
        'chosen parent continuation',
        'physical child continuation',
      ]);
      assert.ok(!reloadedChild.userMessages.includes('unrelated sibling continuation'));

      fs.unlinkSync(chosenPath);
      const missingParentSessions = loadAllSessions({ threadNames: new Map() });
      const childWithMissingParent = missingParentSessions.find(session => (
        session.sessionId === childId
      ));
      loadSessionDetail(childWithMissingParent);
      assert.deepEqual(childWithMissingParent.userMessages, ['physical child continuation']);
      assert.ok(!childWithMissingParent.userMessages.includes('unrelated sibling continuation'));
    } finally {
      fs.unlinkSync(parentPath);
      if (fs.existsSync(chosenPath)) fs.unlinkSync(chosenPath);
      fs.unlinkSync(siblingPath);
      if (fs.existsSync(childPath)) fs.unlinkSync(childPath);
      fs.unlinkSync(childContinuationPath);
    }
  });

  it('uses an exact physical base when an intermediate session is missing', () => {
    const rootId = '66666666-6666-7666-8666-666666666666';
    const missingParentId = '77777777-7777-7777-8777-777777777777';
    const childId = '88888888-8888-7888-8888-888888888888';
    const rootPath = writeSession(`2026/04/17/rollout-2026-04-17T08-00-00-${rootId}.jsonl`, [
      {
        timestamp: '2026-04-17T00:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: rootId,
          timestamp: '2026-04-17T00:00:00.000Z',
          cwd: '/Users/test/Desktop/missing-intermediate',
          source: 'vscode',
        },
      },
      {
        timestamp: '2026-04-17T00:01:00.000Z',
        ordinal: 1,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'surviving grandparent request' },
      },
    ]);
    const childPath = writeSession(`2026/04/17/rollout-2026-04-17T09-00-00-${childId}.jsonl`, [
      {
        timestamp: '2026-04-17T01:00:00.000Z',
        ordinal: 2,
        type: 'session_meta',
        payload: {
          id: childId,
          forked_from_id: missingParentId,
          forked_from_ordinal_exclusive: 2,
          timestamp: '2026-04-17T01:00:00.000Z',
          cwd: '/Users/test/Desktop/missing-intermediate',
          source: 'vscode',
          history_base: { thread_id: rootId, end_ordinal_exclusive: 2 },
        },
      },
      {
        timestamp: '2026-04-17T01:01:00.000Z',
        ordinal: 3,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'child after missing intermediate' },
      },
    ]);

    try {
      const sessions = loadAllSessions({ useCache: false, threadNames: new Map() });
      const child = sessions.find(session => session.sessionId === childId);
      loadSessionDetail(child);
      assert.deepEqual(child.userMessages, [
        'surviving grandparent request',
        'child after missing intermediate',
      ]);
    } finally {
      fs.unlinkSync(rootPath);
      fs.unlinkSync(childPath);
    }
  });

  it('keeps hidden empty rollouts as physical graph connectors', () => {
    const sessionId = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
    const connectorId = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
    const latestId = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
    const rootPath = writeSession(`2026/04/18/rollout-graph-${sessionId}.jsonl`, [
      {
        timestamp: '2026-04-18T00:00:00.000Z',
        ordinal: 0,
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: '2026-04-18T00:00:00.000Z',
          cwd: '/Users/test/Desktop/graph-connectors',
          source: 'vscode',
          history_mode: 'paginated',
        },
      },
      {
        timestamp: '2026-04-18T00:01:00.000Z',
        ordinal: 1,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'before empty connector' },
      },
    ]);
    const connectorPath = writeSession(
      `2026/04/18/rollout-graph-${sessionId}_${connectorId}.jsonl`,
      [{
        timestamp: '2026-04-18T00:02:00.000Z',
        ordinal: 2,
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: '2026-04-18T00:02:00.000Z',
          cwd: '/Users/test/Desktop/graph-connectors',
          source: 'vscode',
          history_mode: 'paginated',
          history_base: { thread_id: sessionId, end_ordinal_exclusive: 2 },
        },
      }],
    );
    const latestPath = writeSession(
      `2026/04/18/rollout-graph-${sessionId}_${latestId}.jsonl`,
      [
        {
          timestamp: '2026-04-18T00:03:00.000Z',
          ordinal: 3,
          type: 'session_meta',
          payload: {
            id: sessionId,
            timestamp: '2026-04-18T00:03:00.000Z',
            cwd: '/Users/test/Desktop/graph-connectors',
            source: 'vscode',
            history_mode: 'paginated',
            history_base: { thread_id: connectorId, end_ordinal_exclusive: 3 },
          },
        },
        {
          timestamp: '2026-04-18T00:04:00.000Z',
          ordinal: 4,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'after empty connector' },
        },
      ],
    );

    try {
      const sessions = loadAllSessions({ threadNames: new Map() });
      const connector = sessions.find(session => session.filePath === connectorPath);
      connector._excludeFromList = true;
      updateSessionCacheRecord(sessions, connector);
      sessions.splice(sessions.indexOf(connector), 1);
      attachSessionRolloutFiles(sessions);
      flushSessionCache(sessions);

      const latest = sessions.find(session => session.filePath === latestPath);
      loadSessionDetail(latest);
      assert.deepEqual(latest.userMessages, [
        'before empty connector',
        'after empty connector',
      ]);

      const originalOpenSync = fs.openSync;
      let connectorOpens = 0;
      fs.openSync = function(target, ...args) {
        if (target === connectorPath) connectorOpens++;
        return originalOpenSync.call(this, target, ...args);
      };
      let reloaded;
      try {
        reloaded = loadAllSessions({ threadNames: new Map() });
      } finally {
        fs.openSync = originalOpenSync;
      }
      assert.equal(connectorOpens, 0,
        'a hidden cached connector is restored without reparsing its rollout');
      assert.ok(!reloaded.some(session => session.filePath === connectorPath));
      const reloadedLatest = reloaded.find(session => session.filePath === latestPath);
      loadSessionDetail(reloadedLatest);
      assert.deepEqual(reloadedLatest.userMessages, [
        'before empty connector',
        'after empty connector',
      ]);
    } finally {
      fs.unlinkSync(rootPath);
      fs.unlinkSync(connectorPath);
      fs.unlinkSync(latestPath);
    }
  });

  it('preserves a legitimate repeated first turn in a timestamp-less resume', () => {
    const firstPath = writeSession('2026/04/08/rollout-2026-04-08T01-00-00-repeat.jsonl', [
      { type: 'event_msg', payload: { type: 'user_message', message: 'retry' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'old answer' } },
    ]);
    const resumedPath = writeSession('2026/04/09/rollout-2026-04-09T01-00-00-repeat.jsonl', [
      { type: 'event_msg', payload: { type: 'user_message', message: 'retry' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'old answer' } },
    ]);
    const session = {
      sessionId: 'repeat',
      filePath: resumedPath,
      rolloutFilePaths: [firstPath, resumedPath],
      estimatedMessages: 0,
    };

    try {
      loadSessionDetail(session);
      assert.deepEqual(session.userMessages, ['retry', 'retry']);
      assert.deepEqual(session.assistantSnippets, ['old answer', 'old answer']);
    } finally {
      fs.unlinkSync(firstPath);
      fs.unlinkSync(resumedPath);
    }
  });

  it('preserves same-timestamp repeated turns within one rollout', () => {
    const timestamp = '2026-04-09T01:00:00.000Z';
    const filePath = writeSession('2026/04/09/rollout-same-timestamp-repeat.jsonl', [
      { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'retry' } },
      { timestamp, type: 'event_msg', payload: { type: 'agent_message', message: 'same answer' } },
      { timestamp, type: 'event_msg', payload: { type: 'turn_aborted' } },
      { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'retry' } },
      { timestamp, type: 'event_msg', payload: { type: 'agent_message', message: 'same answer' } },
    ]);
    const session = {
      sessionId: 'same-timestamp-repeat',
      filePath,
      rolloutFilePaths: [filePath],
      estimatedMessages: 0,
    };

    try {
      loadSessionDetail(session);
      assert.deepEqual(session.userMessages, ['retry', 'retry']);
      assert.deepEqual(session.assistantSnippets, ['same answer', 'same answer']);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('deduplicates local mirrored records before cross-rollout ordering', () => {
    const firstPath = writeSession('2026/04/09/rollout-2026-04-09T01-00-00-mirrored-order.jsonl', [
      {
        timestamp: '2026-04-09T01:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'mirrored prompt' }],
        },
      },
      {
        timestamp: '2026-04-09T01:10:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'mirrored prompt' },
      },
    ]);
    const secondPath = writeSession('2026/04/09/rollout-2026-04-09T01-05-00-middle.jsonl', [
      {
        timestamp: '2026-04-09T01:05:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'middle prompt' },
      },
    ]);
    const session = {
      sessionId: 'mirrored-order',
      filePath: secondPath,
      rolloutFilePaths: [firstPath, secondPath],
      estimatedMessages: 0,
    };

    try {
      loadSessionDetail(session);
      assert.deepEqual(session.userMessages, ['middle prompt', 'mirrored prompt']);
    } finally {
      fs.unlinkSync(firstPath);
      fs.unlinkSync(secondPath);
    }
  });

  it('deduplicates mirrored message records without removing repeated turns', () => {
    const filePath = writeSession('2026/04/13/rollout-mirrored-messages.jsonl', [
      {
        timestamp: '2026-04-13T02:31:02.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-mirrored-messages',
          timestamp: '2026-04-13T02:31:02.000Z',
          cwd: '/Users/test/Desktop/project-mirrored',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'run the checks' }],
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'run the checks' },
      },
      {
        type: 'event_msg',
        payload: { type: 'agent_message', phase: 'commentary', message: 'Running checks.' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'Running checks.' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'run the checks' }],
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: 'run the checks' },
      },
      {
        type: 'event_msg',
        payload: { type: 'agent_message', phase: 'final_answer', message: 'Checks passed.' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'Checks passed.' }],
        },
      },
    ]);

    const session = loadSessionQuick(filePath);
    assert.equal(session.estimatedMessages, 4);

    loadSessionDetail(session);
    assert.deepEqual(session.userMessages, ['run the checks', 'run the checks']);
    assert.deepEqual(session.assistantSnippets, ['Running checks.', 'Checks passed.']);
    assert.equal(session.totalMessages, 4);
  });

  it('matches image prompts and keeps interrupted repeated turns separate', () => {
    const prompt = '[Image #1]\n\nwhere should I click?';
    const filePath = writeSession('2026/04/13/rollout-image-messages.jsonl', [
      {
        timestamp: '2026-04-13T02:31:02.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-image-messages',
          timestamp: '2026-04-13T02:31:02.000Z',
          cwd: '/Users/test/Desktop/project-images',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '<image name=[Image #1] path="/tmp/image.png">' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc' },
            { type: 'input_text', text: '</image>' },
            { type: 'input_text', text: prompt },
          ],
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'user_message', message: prompt },
      },
      { type: 'event_msg', payload: { type: 'task_complete' } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      },
      { type: 'event_msg', payload: { type: 'turn_aborted' } },
    ]);

    const session = loadSessionQuick(filePath);
    assert.equal(session.topic, '[Image #1] where should I click?');
    assert.equal(session.estimatedMessages, 2);

    loadSessionDetail(session);
    assert.deepEqual(session.userMessages, [prompt, prompt]);
    assert.deepEqual(session.assistantSnippets, []);
    assert.equal(session.totalMessages, 2);
  });

  it('keeps fork metadata canonical when inherited parent metadata follows it', () => {
    const filePath = writeSession('2026/04/13/rollout-fork.jsonl', [
      {
        timestamp: '2026-04-13T04:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'fork-child',
          forked_from_id: 'fork-parent',
          history_base: {
            thread_id: 'fork-parent',
            end_ordinal_exclusive: 42,
          },
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
    assert.equal(session.forkedFromOrdinalExclusive, 42);
    assert.equal(session.hasEmbeddedForkHistory, true);
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

  it('classifies canonical session metadata beyond the first-line read limit', () => {
    const filePath = writeSession('2026/04/13/rollout-large-canonical-meta.jsonl', [
      {
        timestamp: '2026-04-13T05:30:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-large-canonical-meta',
          timestamp: '2026-04-13T05:30:00.000Z',
          cwd: '/Users/test/Desktop/large-canonical-meta',
          source: 'cli',
          originator: 'codex-tui',
          base_instructions: 'x'.repeat(600 * 1024),
        },
      },
      { type: 'event_msg', payload: { type: 'user_message', message: 'large metadata prompt' } },
    ]);

    assert.equal(loadSessionQuick(filePath).sessionId, 'sess-large-canonical-meta');
    assert.ok(loadAllSessions().some(session => session.sessionId === 'sess-large-canonical-meta'));
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
    assert.equal(sessions[0].estimatedMessages, 6);
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

  it('searches Codex AI-generated titles', () => {
    const sessions = [{
      sessionId: 'alpha',
      project: 'project-alpha',
      topic: 'raw first prompt',
      aiTitle: 'Diagnose checkout latency',
    }];

    assert.deepEqual(filterSessionList(sessions, 'checkout latency'), sessions);
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

  it('defers a topic beyond the quick-read window without reading the whole file', async () => {
    const filePath = writeSession('2026/04/13/rollout-late-topic.jsonl', [
      {
        timestamp: '2026-04-13T06:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-late-topic',
          timestamp: '2026-04-13T06:00:00.000Z',
          cwd: '/Users/test/Desktop/project-late-topic',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `<environment_context>${'x'.repeat(300 * 1024)}` }],
        },
      },
      {
        timestamp: '2026-04-13T06:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'topic discovered asynchronously' },
      },
      {
        timestamp: '2026-04-13T08:00:00.000Z',
        type: 'response_item',
        payload: { type: 'custom_tool_call_output', output: 'x'.repeat(32 * 1024) },
      },
    ]);

    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function(target, ...args) {
      if (target === filePath) throw new Error('quick loading must not read the whole rollout');
      return originalReadFileSync.call(this, target, ...args);
    };
    let session;
    try {
      session = loadSessionQuick(filePath);
    } finally {
      fs.readFileSync = originalReadFileSync;
    }

    assert.equal(session.topic, '(loading topic…)');
    const scheduled = [];
    indexSessionsInBackground([session], { schedule: callback => scheduled.push(callback) });
    await scheduled.shift()();
    assert.equal(session.topic, 'topic discovered asynchronously');
    assert.equal(session._topicPending, false);
    assert.equal(session.estimatedMessages, 1);
    assert.equal(session.lastTs, '2026-04-13T08:00:00.000Z');
    assert.equal(session.duration, '2h 0m');
  });

  it('resolves pending topics and excludes empty sessions before list output', async () => {
    writeSession('2026/04/13/rollout-list-late-topic.jsonl', [
      {
        timestamp: '2026-04-13T06:30:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-list-late-topic',
          timestamp: '2026-04-13T06:30:00.000Z',
          cwd: '/Users/test/Desktop/project-list',
          source: 'cli',
        },
      },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>${'x'.repeat(300 * 1024)}` }] } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'resolved list topic' } },
    ]);
    writeSession('2026/04/13/rollout-list-empty.jsonl', [
      {
        timestamp: '2026-04-13T06:31:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-list-empty',
          timestamp: '2026-04-13T06:31:00.000Z',
          cwd: '/Users/test/Desktop/project-list-empty',
          source: 'cli',
        },
      },
    ]);

    const originalLog = console.log;
    const output = [];
    console.log = value => output.push(String(value));
    try {
      await mod.runListMode(1000);
    } finally {
      console.log = originalLog;
    }

    const text = output.join('\n');
    assert.match(text, /resolved list topic/);
    assert.doesNotMatch(text, /loading topic/);
    assert.doesNotMatch(text, /project-list-empty/);
  });

  it('filters non-interactive rollouts after reading only their canonical metadata', () => {
    const filePath = writeSession('2026/04/13/rollout-prefiltered-exec.jsonl', [
      {
        timestamp: '2026-04-13T07:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-prefiltered-exec',
          timestamp: '2026-04-13T07:00:00.000Z',
          cwd: '/Users/test/Desktop/project-prefilter',
          source: 'exec',
          originator: 'codex_exec',
        },
      },
      { type: 'response_item', payload: { output: 'x'.repeat(300 * 1024) } },
    ]);

    const originalOpenSync = fs.openSync;
    let sessionOpens = 0;
    fs.openSync = function(target, ...args) {
      if (target === filePath) sessionOpens++;
      return originalOpenSync.call(this, target, ...args);
    };
    let sessions;
    try {
      sessions = loadAllSessions();
    } finally {
      fs.openSync = originalOpenSync;
    }

    assert.equal(sessionOpens, 1);
    assert.ok(!sessions.some(session => session.sessionId === 'sess-prefiltered-exec'));
    assert.equal(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')).files[filePath].included, false);
  });

  it('reuses unchanged cached summaries and invalidates changed files', () => {
    const filePath = writeSession('2026/04/13/rollout-cached.jsonl', [
      {
        timestamp: '2026-04-13T08:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-cached',
          timestamp: '2026-04-13T08:00:00.000Z',
          cwd: '/Users/test/Desktop/project-cache',
          source: 'cli',
          originator: 'codex-tui',
        },
      },
      {
        timestamp: '2026-04-13T08:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'cached session topic' },
      },
    ]);
    loadAllSessions();

    const originalOpenSync = fs.openSync;
    let sessionOpens = 0;
    fs.openSync = function(target, ...args) {
      if (target === filePath) sessionOpens++;
      return originalOpenSync.call(this, target, ...args);
    };
    try {
      const cachedSessions = loadAllSessions();
      assert.ok(cachedSessions.some(session => session.sessionId === 'sess-cached'));
      assert.equal(sessionOpens, 0);

      fs.appendFileSync(filePath, `\n${JSON.stringify({
        timestamp: '2026-04-13T08:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'cache invalidated' },
      })}`);
      loadAllSessions();
      assert.ok(sessionOpens > 0);
    } finally {
      fs.openSync = originalOpenSync;
    }
  });

  it('does not attach indexed data to a newer rollout fingerprint', async () => {
    const filePath = writeSession('2026/04/13/rollout-index-race.jsonl', [
      {
        timestamp: '2026-04-13T08:30:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-index-race',
          timestamp: '2026-04-13T08:30:00.000Z',
          cwd: '/Users/test/Desktop/project-cache',
          source: 'cli',
        },
      },
      { type: 'event_msg', payload: { type: 'user_message', message: 'original indexed text' } },
    ]);
    const sessions = loadAllSessions();
    const session = sessions.find(candidate => candidate.sessionId === 'sess-index-race');
    const originalSize = fs.statSync(filePath).size;
    fs.appendFileSync(filePath, `\n${JSON.stringify({
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'appended during indexing' },
    })}`);

    const scheduled = [];
    indexSessionsInBackground([session], { schedule: callback => scheduled.push(callback) });
    await scheduled.shift()();
    updateSessionCacheRecord(sessions, session);
    flushSessionCache(sessions);

    const staleRecord = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')).files[filePath];
    assert.equal(staleRecord.size, originalSize);
    loadAllSessions();
    const refreshedRecord = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')).files[filePath];
    assert.equal(refreshedRecord.size, fs.statSync(filePath).size);
  });

  it('rebuilds a corrupt cache and prunes deleted rollouts', () => {
    const filePath = writeSession('2026/04/13/rollout-cache-prune.jsonl', [
      {
        timestamp: '2026-04-13T09:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'sess-cache-prune',
          timestamp: '2026-04-13T09:00:00.000Z',
          cwd: '/Users/test/Desktop/project-cache',
          source: 'cli',
        },
      },
      { type: 'event_msg', payload: { type: 'user_message', message: 'prune me' } },
    ]);
    loadAllSessions();
    assert.ok(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')).files[filePath]);

    fs.unlinkSync(filePath);
    fs.writeFileSync(CACHE_FILE, '{broken cache');
    assert.doesNotThrow(() => loadAllSessions());
    const rebuilt = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    assert.equal(rebuilt.version, 4);
    assert.equal(rebuilt.files[filePath], undefined);
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

  function forkTreeFixture() {
    const atHour = hour => new Date(Date.UTC(2026, 8, 10, hour)).toISOString();
    const sessions = [session('demo-root', '', atHour(0))];
    let parentId = 'demo-root';
    for (let index = 1; index <= 18; index++) {
      const id = `demo-trunk-${String(index).padStart(2, '0')}`;
      sessions.push(session(id, parentId, atHour(index)));
      parentId = id;
    }

    const activeReason = 'Flatten linear chains and indent only at real branches';
    const active1 = session('demo-active-01', parentId, atHour(19));
    const active2 = session('demo-active-02', active1.sessionId, atHour(20));
    const active3 = session('demo-active-03', active2.sessionId, atHour(23));
    active1.topic = activeReason;
    active2.topic = activeReason;
    active3.topic = activeReason;
    const alternative1 = session('demo-alt-01', parentId, atHour(21));
    const alternative2 = session('demo-alt-02', alternative1.sessionId, atHour(22));
    sessions.push(active1, active2, active3, alternative1, alternative2);
    return sessions;
  }

  it('keeps singletons as ordinary session rows', () => {
    const only = session('only', '', '2026-04-13T01:00:00.000Z');
    const families = buildSessionFamilies([only]);
    const rows = buildVisibleSessionRows(families, new Set());

    assert.equal(families.length, 1);
    assert.equal(families[0].hasForks, false);
    assert.deepEqual(rows.map(row => [row.kind, row.session.sessionId]), [['session', 'only']]);
  });

  it('keeps a family title editable after only one version survives', () => {
    const only = session('only', '', '2026-04-13T01:00:00.000Z');
    const row = buildVisibleSessionRows(buildSessionFamilies([only]), new Set())[0];
    const meta = { families: { only: { customTitle: 'stable family title' } } };

    assert.equal(getFamilyTitleForRow(meta, row), 'stable family title');
    assert.equal(rowTargetsFamilyTitle(meta, row), true);

    row.family.hasForks = true;
    assert.equal(getFamilyTitleForRow(meta, row), '');
    assert.equal(rowTargetsFamilyTitle(meta, row), false);
  });

  it('moves and removes family metadata as ancestor versions are deleted', () => {
    const root = session('root', '', '2026-04-13T01:00:00.000Z');
    const middle = session('middle', 'root', '2026-04-13T02:00:00.000Z');
    const leaf = session('leaf', 'middle', '2026-04-13T03:00:00.000Z');
    const meta = { families: { root: { customTitle: 'stable family title' } } };

    let sessions = [root, middle, leaf];
    let family = buildSessionFamilies(sessions)[0];
    sessions = [middle, leaf];
    reconcileFamilyMetaAfterDelete(meta, family, sessions);
    assert.equal(meta.families.root.customTitle, 'stable family title');

    family = buildSessionFamilies(sessions)[0];
    sessions = [leaf];
    reconcileFamilyMetaAfterDelete(meta, family, sessions);
    assert.equal(meta.families.middle.customTitle, 'stable family title');
    assert.equal(meta.families.root, undefined);

    family = buildSessionFamilies(sessions)[0];
    reconcileFamilyMetaAfterDelete(meta, family, []);
    assert.equal(meta.families, undefined);
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

  it('keeps linear depth flat and indents only after a real branch', () => {
    const demoSessions = forkTreeFixture();
    const families = buildSessionFamilies(demoSessions);
    const family = families[0];
    const collapsed = buildVisibleSessionRows(families, new Set());
    const compact = buildVisibleSessionRows(families, new Set([family.familyId]));
    const trunkChain = compact.find(row => row.kind === 'chain');
    const expanded = buildVisibleSessionRows(
      families,
      new Set([family.familyId]),
      new Set([trunkChain.chainId]),
    );
    const sessionRows = expanded.filter(row => row.kind === 'session');
    const trunkRows = sessionRows.filter(row => (
      row.session.sessionId === 'demo-root' || row.session.sessionId.startsWith('demo-trunk-')
    ));
    const branchRows = sessionRows.filter(row => (
      row.session.sessionId.startsWith('demo-active-') || row.session.sessionId.startsWith('demo-alt-')
    ));

    assert.equal(demoSessions.length, 24, 'one original plus 23 forks');
    assert.deepEqual(collapsed.map(row => row.kind), ['family']);
    assert.equal(trunkChain.chainCount, 19);
    assert.equal(trunkChain.branchCount, 2);
    assert.equal(compact.filter(row => row.kind === 'session').length, 5,
      'the long trunk folds while short branches remain immediately readable');
    assert.equal(sessionRows.length, 24);
    assert.equal(new Set(trunkRows.map(row => row.treePrefix.length)).size, 1,
      'all 19 nodes in the linear trunk consume the same horizontal width');
    assert.deepEqual(new Set(trunkRows.map(row => row.branchDepth)), new Set([1]));
    assert.deepEqual(new Set(branchRows.map(row => row.branchDepth)), new Set([2]));
    assert.equal(sessionRows.find(row => row.session.sessionId === 'demo-trunk-18').branchCount, 2);
    assert.deepEqual(
      ['demo-active-01', 'demo-alt-01'].map(sessionId => {
        const row = sessionRows.find(candidate => candidate.session.sessionId === sessionId);
        return [row.branchOrdinal, row.branchSiblingCount];
      }),
      [[1, 2], [2, 2]],
      'each immediate child branch gets an unambiguous ordinal',
    );
    assert.ok(
      sessionRows.find(row => row.session.sessionId === 'demo-alt-02').treePrefix.endsWith('│ '),
      'a flattened continuation uses a rail, never a sibling-like corner',
    );
    assert.equal(sessionRows.find(row => row.session.sessionId === 'demo-active-03').isDefault, true);
    assert.equal(
      getForkReason(demoSessions.find(session => session.sessionId === 'demo-active-01')),
      'Flatten linear chains and indent only at real branches',
    );
  });

  it('starts an orphaned fork as its own family and honors later parent activity', () => {
    const orphan = session('orphan', 'missing', '2026-04-13T02:00:00.000Z');
    const root = session('root-later', '', '2026-04-13T05:00:00.000Z');
    const child = session('child-earlier', 'root-later', '2026-04-13T04:00:00.000Z');
    const families = buildSessionFamilies([root, child, orphan]);
    const parentFamily = families.find(family => family.familyId === 'root-later');

    assert.equal(families.length, 2);
    assert.equal(parentFamily.defaultSession.sessionId, 'root-later');
    const rootRow = buildVisibleSessionRows(
      [parentFamily],
      new Set([parentFamily.familyId]),
    ).find(row => row.kind === 'session' && row.session.sessionId === 'root-later');
    assert.equal(getVersionLabelText(rootRow), '◇ Original ● Latest');
  });

  it('keeps sibling forks grouped when their common parent is missing', () => {
    const branchA = session('orphan-a', 'deleted-parent', '2026-04-13T02:00:00.000Z');
    const branchB = session('orphan-b', 'deleted-parent', '2026-04-14T03:00:00.000Z');
    const families = buildSessionFamilies([branchB, branchA]);

    assert.equal(families.length, 1);
    assert.equal(families[0].familyId, 'deleted-parent');
    assert.equal(families[0].hasForks, true);
    assert.equal(families[0].defaultSession.sessionId, 'orphan-b');
    assert.equal(getFamilyForkCount(families[0]), 2);
    assert.equal(
      formatFamilySpan(families[0]),
      `${formatTimestamp(branchA.firstTs)} → ${formatTimestamp(branchB.firstTs)}`,
    );
    assert.deepEqual(
      buildVisibleSessionRows(families, new Set(['deleted-parent']))
        .filter(row => row.kind === 'session')
        .map(row => row.session.sessionId)
        .sort(),
      ['orphan-a', 'orphan-b'],
    );
    assert.deepEqual(
      buildVisibleSessionRows(families, new Set(['deleted-parent']))
        .filter(row => row.kind === 'session')
        .map(row => [row.branchOrdinal, row.branchSiblingCount, row.isRoot]),
      [[1, 2, false], [2, 2, false]],
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
