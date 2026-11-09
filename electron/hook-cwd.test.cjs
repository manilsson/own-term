// Run with `node --test electron/*.test.cjs`.
const test = require('node:test')
const assert = require('node:assert/strict')
const { claudeFolder } = require('./hook-cwd.cjs')

test('the folder Claude is in comes through', () => {
  assert.equal(claudeFolder({ cwd: '/Users/demo/project/.claude/worktrees/fix-login' }), '/Users/demo/project/.claude/worktrees/fix-login')
})

test('it is normalized, without a trailing slash', () => {
  assert.equal(claudeFolder({ cwd: '/Users/demo/project/./src/../' }), '/Users/demo/project')
})

test("a subagent's folder is left out", () => {
  assert.equal(claudeFolder({ cwd: '/Users/demo/project/.claude/worktrees/agent-1', agent_id: 'a1' }), undefined)
})

test('anything but an absolute path is left out', () => {
  for (const cwd of [undefined, null, 42, '', 'relative/path', '~/project', `/${'x'.repeat(5000)}`, '/bad\0path']) {
    assert.equal(claudeFolder({ cwd }), undefined, String(cwd).slice(0, 20))
  }
})
