import { addGroup, announce, getState, moveSession, removeGroup, updateGroup, updateSession, viewIds, type Session } from './store'
import { groupRemoved, refreshGroupView } from './workspace'

const where = (s: Session) => {
  const branch = getState().git[s.id]?.branch
  return `${s.cwd.replace(window.deck.homeDir, '~')}${branch ? `, ${branch}` : ''}`
}

function describe(session: Session, prompt: string) {
  const { groups, sessions } = getState()
  const others = sessions.filter(s => s.id !== session.id)
  return [
    `Request: ${prompt.slice(0, 1500)}`,
    `Folder: ${where(session)}`,
    '',
    'Groups:',
    ...groups.map(g => {
      const members = others.filter(s => s.groupId === g.id).map(s => `"${s.name}" (${where(s)})`)
      return `- id ${g.id}, "${g.name}": ${members.join('; ') || 'no sessions'}`
    }),
    '',
    'Sessions in no group:',
    ...others.filter(s => s.groupId === null).map(s => `- id ${s.id}, "${s.name}" (${where(s)})`),
  ].join('\n')
}

/**
 * Lets Claude put a new ungrouped session in a group once it knows what the session is for: an
 * existing group, or a new one shared with other ungrouped sessions on the same work.
 */
export async function sortIntoGroup(id: string, prompt: string) {
  const session = getState().sessions.find(s => s.id === id)
  if (!getState().autoGroup || !session || session.sorted || session.groupId || session.demo || /^\/\S*$/.test(prompt.trim())) return
  updateSession(id, { sorted: true })
  const answer = await window.deck.suggestGroup(describe(session, prompt))

  // Someone may have grouped it, or deleted things, while Claude was thinking.
  const { groups, sessions } = getState()
  if (!answer || sessions.find(s => s.id === id)?.groupId !== null) return
  const name = () => getState().sessions.find(s => s.id === id)?.name ?? session.name

  const group = groups.find(g => g.id === answer.group)
  if (group) {
    moveSession(id, group.id)
    refreshGroupView()
    announce(`Moved “${name()}” to ${group.name}`, () => {
      // Only if it's still where Claude put it; the user may have moved it since.
      if (getState().sessions.find(s => s.id === id)?.groupId !== group.id) return
      moveSession(id, null)
      refreshGroupView()
    })
    return
  }

  // The answer is a model's JSON, so its shape is checked rather than trusted.
  const title = typeof answer.newGroup === 'string' ? answer.newGroup.trim().slice(0, 40) : ''
  const others = Array.isArray(answer.with) ? answer.with.filter((x): x is string => typeof x === 'string') : []
  const companions = others.filter(x => x !== id && sessions.find(s => s.id === x)?.groupId === null)
  if (title && companions.length > 0) {
    const members = [id, ...companions]
    const groupId = addGroup()
    // Claude chose this name; left as auto-named, the group would be renamed from its sessions straight away.
    updateGroup(groupId, { name: title, autoName: false })
    members.forEach(m => moveSession(m, groupId))
    announce(`Grouped ${members.length} sessions as ${title}`, () => {
      const shown = viewIds(getState(), { kind: 'group', id: groupId })
      removeGroup(groupId)
      groupRemoved(groupId, shown)
    })
  }
}
