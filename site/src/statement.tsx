import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react'

/** One line set large on a dark card that closes a story, each word lighting up as it scrolls through. */
export function Statement({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.6'] })
  const words = text.split(' ')
  return (
    <div className="statement dark" ref={ref}>
      <div className="browser-glow" />
      <p aria-label={text}>
        {words.map((word, i) => <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>{word}</Word>)}
      </p>
    </div>
  )
}

function Word({ progress, range, children }: { progress: MotionValue<number>; range: [number, number]; children: string }) {
  const opacity = useTransform(progress, range, [0.18, 1])
  return <motion.span aria-hidden="true" style={{ opacity }}>{children} </motion.span>
}
