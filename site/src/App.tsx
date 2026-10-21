import { MotionConfig } from 'motion/react'
import { Hero, Nav } from './hero'
import { GroupsStory, StatusStory, ToolsStory } from './stories'
import { InfoStory } from './info-story'
import { MonitorsStory } from './monitor-story'
import { BrowserStory } from './browser-story'
import { Closing, Features, Footer, Shortcuts, ThemesStory } from './more'
import { Highlights } from './highlights'

export function App() {
  return (
    // Follows Reduce Motion: transforms are skipped, fades stay.
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <Hero />
        <Highlights />
        <GroupsStory />
        <StatusStory />
        <ToolsStory />
        <MonitorsStory />
        <InfoStory />
        <BrowserStory />
        <ThemesStory />
        <Features />
        <Shortcuts />
        <Closing />
      </main>
      <Footer />
    </MotionConfig>
  )
}
