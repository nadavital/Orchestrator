import { automationEligibilityForSession } from './automationEligibility'
import { createAutomationScheduler } from './automationScheduler'
import { automationManager } from './automations'
import { sessionManager } from './sessions'

export const automationScheduler = createAutomationScheduler({
  manager: automationManager,
  isEligible: (automation) => automationEligibilityForSession(automation, (sessionId) => sessionManager.get(sessionId)),
  execute: async ({ automation, run }) => {
    await sessionManager.sendMessage(
      automation.target.sessionId,
      automation.prompt,
      undefined,
      [],
      {
        permissionSnapshot: automation.permissionSnapshot ?? null,
        onProviderRunComplete: (result) => {
          automationManager.finishRun(run.id, result.ok ? 'SUCCEEDED' : 'FAILED', result.error ?? null)
        }
      }
    )
    return { deferCompletion: true }
  }
})
