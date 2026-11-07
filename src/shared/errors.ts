import { Schema } from "effect"

import { ContainerId, TabId } from "./protocol"

export class UnknownTab extends Schema.TaggedError<UnknownTab>()("UnknownTab", { tabId: TabId }) {
    override get message(): string {
        return `Unknown tab: ${this.tabId}`
    }
}

export class UnknownContainer extends Schema.TaggedError<UnknownContainer>()("UnknownContainer", {
    containerId: ContainerId,
}) {
    override get message(): string {
        return `Unknown container: ${this.containerId}`
    }
}

export class LastTab extends Schema.TaggedError<LastTab>()("LastTab", {}) {
    override get message(): string {
        return "Cannot close the last tab of the last container"
    }
}

export class InvalidMove extends Schema.TaggedError<InvalidMove>()("InvalidMove", {
    reason: Schema.Literals(["into-own-subtree", "across-containers"]),
}) {
    override get message(): string {
        return this.reason === "into-own-subtree"
            ? "Cannot move a tab into its own subtree"
            : "Use moveToContainer for cross-container moves"
    }
}

export class EmptyContainer extends Schema.TaggedError<EmptyContainer>()("EmptyContainer", {
    containerId: ContainerId,
}) {
    override get message(): string {
        return `Container ${this.containerId} has no tabs`
    }
}

export class NoContainer extends Schema.TaggedError<NoContainer>()("NoContainer", {}) {
    override get message(): string {
        return "No container to put the tab in"
    }
}

export class NothingToReopen extends Schema.TaggedError<NothingToReopen>()("NothingToReopen", {}) {
    override get message(): string {
        return "No closed tab to reopen"
    }
}

export const DomainError = Schema.Union([
    UnknownTab,
    UnknownContainer,
    LastTab,
    InvalidMove,
    EmptyContainer,
    NoContainer,
    NothingToReopen,
])
export type DomainError = typeof DomainError.Type

/** A settings patch the store refused. `message` says why, and the settings page shows it. */
export class SettingsRejected extends Schema.TaggedError<SettingsRejected>()("SettingsRejected", {
    message: Schema.String,
}) {}

export class NoActionPopup extends Schema.TaggedError<NoActionPopup>()("NoActionPopup", {
    extensionId: Schema.String,
}) {
    override get message(): string {
        return `Extension ${this.extensionId} has no action popup`
    }
}
