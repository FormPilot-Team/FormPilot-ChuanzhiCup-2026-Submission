import { createRoot } from 'react-dom/client'
import { CoachSprint } from './CoachSprint'
import './sprint.css'

const host = document.getElementById('coach-sprint')
if (!host) throw new Error('Coach Sprint root is missing')
createRoot(host).render(<CoachSprint />)
