import { useState } from 'react'
import type { RoutineRoute } from '../../app/routes'
import { findRoutineProgram } from '../../features/routines/programs'
import { parseRoutineScope } from '../../features/routines/scope'
import type { RoutineProgram } from '../../features/routines/types'
import { RoutineEntryPage } from './RoutineEntryPage'
import { RoutinesIndexPage } from './RoutinesIndexPage'
import { RoutineTrainingPage } from './RoutineTrainingPage'

function RoutineTrainingRoute({ program }: { program: RoutineProgram }) {
  // Read once: the scope must stay the same object for the whole session.
  const [scope] = useState(() => parseRoutineScope(program, new URLSearchParams(window.location.search).get('form')))
  return <RoutineTrainingPage program={program} scope={scope} />
}

function routineDocumentTitle(route: RoutineRoute): string {
  const program = route.kind === 'index' ? undefined : findRoutineProgram(route.routineId)
  if (!program) return 'FormPilot · 功法跟练'
  return route.kind === 'train' ? `FormPilot · ${program.title}跟练` : `FormPilot · ${program.title}`
}

export function RoutineRoutePage({ route }: { route: RoutineRoute }) {
  document.title = routineDocumentTitle(route)
  if (route.kind === 'index') return <RoutinesIndexPage />
  const program = findRoutineProgram(route.routineId)
  if (!program) return <RoutinesIndexPage unknownRoutine />
  if (route.kind === 'entry') return <RoutineEntryPage program={program} />
  return <RoutineTrainingRoute program={program} />
}
