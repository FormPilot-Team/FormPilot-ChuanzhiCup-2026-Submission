import { createRoot } from 'react-dom/client'
import { CoachAgentLab } from './CoachAgentLab'
import { createCoachLabController } from './controller'
import './lab.css'

const host = document.getElementById('coach-agent-lab')
if (!host) throw new Error('Coach Lab root is missing')

// The storage getter stays lazy; loading the page never accesses real history.
const controller = createCoachLabController({ getLocalStorage: () => window.localStorage })
createRoot(host).render(<CoachAgentLab controller={controller} />)
