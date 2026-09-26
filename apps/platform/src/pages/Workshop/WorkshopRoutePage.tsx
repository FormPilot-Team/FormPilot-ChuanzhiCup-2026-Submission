import type { WorkshopRoute } from '../../app/routes'
import { ActionEditorPage } from './ActionEditorPage'
import { CustomActionTrainingPage } from './CustomActionTrainingPage'
import { WorkshopHomePage } from './WorkshopHomePage'

/** 动作工坊 routes: the library, a new action, editing one, and training one. */
export function WorkshopRoutePage({ route }: { route: WorkshopRoute }) {
  if (route.kind === 'new') return <ActionEditorPage />
  if (route.kind === 'edit') return <ActionEditorPage actionId={route.actionId} />
  if (route.kind === 'train') return <CustomActionTrainingPage actionId={route.actionId} />
  return <WorkshopHomePage />
}
