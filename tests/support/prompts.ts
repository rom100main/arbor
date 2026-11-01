import { Effect } from "effect"

import type { PermissionPromptsService } from "../../src/main/extension/prompts"
import type { PermissionPromptRequest } from "../../src/shared/protocol"

/**
 * `PermissionPrompts` without windows: each `show` takes the next answer and records its request.
 * An answer can be an effect, to hold the modal open until the test lets it go.
 */
export const scriptedPrompts = (answers: Array<boolean | Effect.Effect<boolean>>) => {
    const shown: PermissionPromptRequest[] = []
    const service: PermissionPromptsService = {
        show: (request) =>
            Effect.suspend(() => {
                shown.push(request)
                const answer = answers.shift()
                if (answer === undefined) return Effect.die(new Error("Unexpected prompt"))
                return typeof answer === "boolean" ? Effect.succeed(answer) : answer
            }),
        respond: () => Effect.void,
    }
    return { service, shown }
}
