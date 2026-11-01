/**
 * What the user is asked when an extension wants something, and what Arbor remembers of the answer.
 * The answers live in the store's consent ledger, keyed by extension id
 * (or by source path for an unpacked extension, whose id is only known once it is loaded).
 */

import path from "node:path"

import { Cache, Duration, Effect, Exit, Schema, Semaphore } from "effect"

import type { ExtensionGrant, PermissionPromptRequest } from "../../shared/protocol"
import { readJsonLenient } from "../persistence/json-file"
import { BrowserStore } from "../state/store"
import { parseManifest, type ParsedManifest } from "./manifest"
import {
    emptyGrant,
    isRequestCovered,
    manifestGranted,
    mergeGrant,
    optionalScope,
    toPromptRequest,
    type PermissionScope,
} from "./permissions"
import { PermissionPrompts } from "./prompts"

/** `chrome.permissions.request` asked for something its manifest never declared. Chrome refuses it too. */
export class UndeclaredPermission extends Schema.TaggedError<UndeclaredPermission>()(
    "UndeclaredPermission",
    { extensionId: Schema.String },
) {
    override get message(): string {
        return `Extension ${this.extensionId} asked for a permission its manifest does not declare`
    }
}

/** A loaded extension, as `chrome.permissions.request` sees it. */
export interface ExtensionInfo {
    readonly id: string
    readonly name: string
    /** The source folder of an unpacked extension. */
    readonly path?: string
    readonly manifest: unknown
}

/**
 * What the Web Store passes before an install.
 * `manifest` stays `unknown`: the package's manifest type is not in its public exports.
 */
export interface StoreInstallDetails {
    readonly id: string
    readonly localizedName: string
    readonly manifest: unknown
    readonly icon?: { readonly toDataURL?: () => string }
}

export interface Consent {
    /**
     * `chrome.permissions.request`: an extension asks for more permissions while running.
     * - Already granted (by its manifest, or by an earlier Allow): `true`, without asking.
     * - Not in its manifest at all: `UndeclaredPermission`, like Chrome.
     * - Otherwise ask the user. An Allow is saved, so it is not asked again; a Deny is not.
     */
    readonly permissionsRequest: (
        extension: ExtensionInfo,
        request: PermissionScope,
    ) => Effect.Effect<boolean, UndeclaredPermission>
    /** A Web Store install: ask with the manifest's permissions, and record an Allow. */
    readonly installConsent: (details: StoreInstallDetails) => Effect.Effect<"allow" | "deny">
    /** A dev-only unpacked extension, by source folder. Asked once per run, however many sessions load it. */
    readonly unpackedConsent: (extensionPath: string) => Effect.Effect<boolean>
}

/** The manifest's permissions plus everything the user has accepted for this extension. */
const grantedScope = (
    ledger: Record<string, ExtensionGrant>,
    extension: { readonly id: string; readonly path?: string; readonly manifest: ParsedManifest },
): ExtensionGrant =>
    mergeGrant(
        manifestGranted(extension.manifest),
        mergeGrant(
            ledger[extension.id] ?? emptyGrant(),
            (extension.path ? ledger[extension.path] : undefined) ?? emptyGrant(),
        ),
    )

const readUnpackedManifest = (extensionPath: string): ParsedManifest =>
    parseManifest(readJsonLenient(path.join(extensionPath, "manifest.json")))

export const makeConsent: Effect.Effect<Consent, never, BrowserStore | PermissionPrompts> =
    Effect.gen(function* () {
        const store = yield* BrowserStore
        const prompts = yield* PermissionPrompts

        // One modal at a time: the next ask waits for the current one to be answered.
        const one = yield* Semaphore.make(1)
        const ask = (request: PermissionPromptRequest): Effect.Effect<boolean> =>
            one.withPermit(prompts.show(request))

        const permissionsRequest = (
            extension: ExtensionInfo,
            request: PermissionScope,
        ): Effect.Effect<boolean, UndeclaredPermission> =>
            Effect.gen(function* () {
                const manifest = parseManifest(extension.manifest)
                const ledger = yield* store.extensionConsent
                const held = grantedScope(ledger, { ...extension, manifest })
                if (isRequestCovered(request, held)) return true
                // The library already refuses undeclared API names; this covers origins.
                if (!isRequestCovered(request, optionalScope(manifest))) {
                    return yield* new UndeclaredPermission({ extensionId: extension.id })
                }
                const allowed = yield* ask(toPromptRequest(extension.id, extension.name, request))
                if (!allowed) return false
                // Read again: the ledger may have changed while the modal was open.
                const prior = (yield* store.extensionConsent)[extension.id] ?? emptyGrant()
                yield* store.setExtensionConsent(extension.id, mergeGrant(prior, request))
                return true
            })

        const installConsent = (details: StoreInstallDetails): Effect.Effect<"allow" | "deny"> =>
            Effect.gen(function* () {
                const manifest = parseManifest(details.manifest)
                const scope = manifestGranted(manifest)
                const allowed = yield* ask({
                    kind: "install",
                    id: details.id,
                    name: details.localizedName || manifest.name || details.id,
                    permissions: scope.permissions,
                    origins: scope.origins,
                    icon: details.icon?.toDataURL?.() ?? null,
                })
                if (!allowed) return "deny"
                yield* store.setExtensionConsent(details.id, scope)
                return "allow"
            })

        const askUnpacked = (extensionPath: string): Effect.Effect<boolean> =>
            Effect.gen(function* () {
                const ledger = yield* store.extensionConsent
                if (ledger[extensionPath]) return true
                const manifest = readUnpackedManifest(extensionPath)
                const scope = manifestGranted(manifest)
                const allowed = yield* ask({
                    kind: "install",
                    id: extensionPath,
                    name: manifest.name || path.basename(extensionPath),
                    permissions: scope.permissions,
                    origins: scope.origins,
                    icon: null,
                })
                if (allowed) yield* store.setExtensionConsent(extensionPath, scope)
                return allowed
            })

        // Every session loads the unpacked extensions, so asks for one folder share one prompt.
        // A Deny is kept for the run. An Allow is not: the ledger holds it, and an uninstall clears it.
        const unpacked = yield* Cache.makeWith(askUnpacked, {
            capacity: 64,
            timeToLive: (exit) =>
                Exit.isSuccess(exit) && !exit.value ? Duration.infinity : Duration.zero,
        })

        return {
            permissionsRequest,
            installConsent,
            unpackedConsent: (extensionPath) => Cache.get(unpacked, extensionPath),
        }
    })
