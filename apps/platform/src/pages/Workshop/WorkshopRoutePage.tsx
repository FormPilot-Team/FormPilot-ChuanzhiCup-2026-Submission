import type { WorkshopRoute } from '../../app/routes'
import { ActionEditorPage } from './ActionEditorPage'
import { WorkshopHomePage } from './WorkshopHomePage'

/** 动作工坊 routes: the library, a new action, editing one (custom-action training joins in its own module). */
export function WorkshopRoutePage({ route }: { route: WorkshopRoute }) {
  if (route.kind === 'new') return <ActionEditorPage />
  if (route.kind === 'edit') return <ActionEditorPage actionId={route.actionId} />
  return <WorkshopHomePage />
}
