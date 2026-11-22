import { For, createSignal } from "solid-js"

import { CONTAINER_COLORS, CONTAINER_ICONS } from "../../../shared/constants"
import type { RenameTarget } from "../../../shared/protocol"
import { Button } from "../../common/Button/Button"
import { Field } from "../../common/Field/Field"

import "./RenamePopup.css"
import { Modal, ModalActions } from "../../common/Modal/Modal"

export const RenamePopup = (props: { target: RenameTarget }) => {
    const isContainer = props.target.kind === "container"
    const [name, setName] = createSignal(
        props.target.kind === "container"
            ? props.target.container.name
            : (props.target.tab.userLabel ?? ""),
    )
    const [color, setColor] = createSignal(
        props.target.kind === "container" ? props.target.container.color : CONTAINER_COLORS[0],
    )
    const [icon, setIcon] = createSignal(
        props.target.kind === "container" ? props.target.container.icon : "world",
    )

    const close = (): void => {
        window.arbor.closeRenameModal()
    }

    const commit = (): void => {
        const trimmed = name().trim()
        if (props.target.kind === "container") {
            if (trimmed.length > 0 && trimmed !== props.target.container.name) {
                void window.arbor.renameContainer({
                    containerId: props.target.container.id,
                    name: trimmed,
                })
            }
            if (color() !== props.target.container.color) {
                void window.arbor.setContainerColor({
                    containerId: props.target.container.id,
                    color: color(),
                })
            }
            if (icon() !== props.target.container.icon) {
                void window.arbor.setContainerIcon({
                    containerId: props.target.container.id,
                    icon: icon(),
                })
            }
        } else {
            void window.arbor.renameTab({
                tabId: props.target.tab.id,
                label: trimmed.length > 0 ? trimmed : null,
            })
        }
        close()
    }

    return (
        <Modal
            label={isContainer ? "Rename container" : "Rename tab"}
            size="sm"
            onCancel={close}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault()
                    commit()
                    return
                }
                if (event.key === "Escape") {
                    event.preventDefault()
                    close()
                }
            }}
        >
            <label class="rename-label">
                {isContainer ? "Container name" : "Tab label (blank clears)"}
            </label>
            <Field
                value={name()}
                ref={(el) => {
                    // Defer until the element is inserted and the window settles.
                    setTimeout(() => {
                        el.focus()
                        el.select()
                    }, 0)
                }}
                onInput={(event) => setName(event.currentTarget.value)}
            />
            {props.target.kind === "container" && (
                <>
                    <div class="rename-colors">
                        <For each={[...CONTAINER_COLORS]}>
                            {(swatch) => (
                                <Button
                                    class={{
                                        "rename-color": true,
                                        selected: color() === swatch,
                                    }}
                                    style={{ "background-color": swatch }}
                                    type="button"
                                    aria-label={`Color ${swatch}`}
                                    onClick={() => setColor(swatch)}
                                />
                            )}
                        </For>
                    </div>
                    <div class="rename-icons">
                        <For each={[...CONTAINER_ICONS]}>
                            {(option) => (
                                <Button
                                    icon={option}
                                    iconSize={18}
                                    square
                                    variant="stealth"
                                    class={{
                                        "rename-icon": true,
                                        selected: icon() === option,
                                    }}
                                    type="button"
                                    aria-label={`Icon ${option}`}
                                    title={option}
                                    onClick={() => setIcon(option)}
                                />
                            )}
                        </For>
                    </div>
                </>
            )}
            <ModalActions>
                {props.target.kind === "tab" && props.target.tab.userLabel !== null && (
                    <Button
                        variant="stealth"
                        class="rename-clear"
                        type="button"
                        onClick={() => {
                            if (props.target.kind === "tab") {
                                void window.arbor.renameTab({
                                    tabId: props.target.tab.id,
                                    label: null,
                                })
                                close()
                            }
                        }}
                    >
                        Clear label
                    </Button>
                )}
                <Button variant="stealth" type="button" onClick={() => close()}>
                    Cancel
                </Button>
                <Button variant="primary" type="button" onClick={() => commit()}>
                    Save
                </Button>
            </ModalActions>
        </Modal>
    )
}
