import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Reveal, Screenshot } from './ui'

// Bold lead, then a gray sentence, the way Apple captions its highlight tiles.
const TILES = [
  ['today', 'Start the day on Today.', 'Claude reads your sessions, pull requests and Linear issues and says where to start. What waits on your review sits right under it.'],
  ['week', 'Your standup, already written.', 'What shipped, what’s in progress and what’s next, from every session’s week, ready to paste into Slack.'],
  ['reminders', 'Come back to it later.', 'Every reminder by day, on sessions and on to-dos. One that came due waits at the top until you’re done with it.'],
  ['question', 'Answer without hunting.', 'When Claude asks something, the session moves to Needs You and its question waits in the pane.'],
  ['tools', 'Tell Claude to set the work up.', 'Ask for a session per bug, each in its own worktree, grouped. Claude starts them, and Undo takes it all back.'],
  ['browser', 'See what Claude sees.', 'Each session’s Claude drives a Chrome of its own, live in the pane. Click and type in it whenever you like.'],
  ['palette', 'Go anywhere with ⌘P.', 'Type a few letters to jump to a session or group, or to run any command.'],
  ['viewer', 'See what changed, right there.', 'Click a file in the info panel to read its diff, or the whole file, without leaving the session.'],
  ['find', 'Find it in the scrollback.', '⌘F highlights every match, and ↩ steps through them.'],
  ['ios', 'Every project, its own group.', 'The iOS app, the shop and the docs each keep their sessions and their layout.'],
  ['docs', 'Shells sit right beside Claude.', 'A dev server shows Running in green while Claude edits the pages it serves.'],
] as const

export function Highlights() {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const el = track.current!
    const onScroll = () => setIndex(Math.round(el.scrollLeft / (el.firstElementChild as HTMLElement).offsetWidth))
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const go = (i: number) => {
    const el = track.current!
    const tile = el.children[Math.max(0, Math.min(TILES.length - 1, i))] as HTMLElement
    el.scrollTo({ left: tile.offsetLeft - el.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: 'smooth' })
  }

  return (
    <section className="highlights" id="highlights">
      <Reveal><h2 className="title left">Get the highlights.</h2></Reveal>
      <div className="highlights-track" ref={track}>
        {/* The slot is what snaps: a snap point on the sliding card would move with it, and the row
            would re-snap to it mid-slide and jump. */}
        {TILES.map(([src, lead, text], i) => (
          <div key={src} className="highlight-slot">
            <motion.figure
              className="highlight"
              initial={{ opacity: 0, x: 60 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1], delay: i * 0.08 }}
            >
              <figcaption><b>{lead}</b> {text}</figcaption>
              <div className="highlight-shot">
                <Screenshot name={src} alt="" />
              </div>
            </motion.figure>
          </div>
        ))}
      </div>
      <div className="highlights-controls">
        <div className="dots">
          {TILES.map(([src], i) => (
            <button key={src} className={i === index ? 'on' : ''} aria-label={`Highlight ${i + 1}`} onClick={() => go(i)}>
              {i === index && <motion.span layoutId="dot" className="dot-fill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            </button>
          ))}
        </div>
        <div className="arrows">
          <button aria-label="Previous" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={20} /></button>
          <button aria-label="Next" disabled={index === TILES.length - 1} onClick={() => go(index + 1)}><ChevronRight size={20} /></button>
        </div>
      </div>
    </section>
  )
}
