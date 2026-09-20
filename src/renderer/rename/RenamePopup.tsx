import { For, createSignal } from "solid-js"

import { CONTAINER_COLORS, CONTAINER_ICONS, type RenameTarget } from "../../shared/protocol"
import { Icon } from "../ui/Icon"

import "./RenamePopup.css"

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
                void window.arbor.renameContainer(props.target.container.id, trimmed)
            }
            if (color() !== props.target.container.color) {
                void window.arbor.setContainerColor(props.target.container.id, color())
            }
            if (icon() !== props.target.container.icon) {
                void window.arbor.setContainerIcon(props.target.container.id, icon())
            }
        } else {
            void window.arbor.renameTab(props.target.tab.id, trimmed.length > 0 ? trimmed : null)
        }
        close()
    }

    return (
        <div class="rename-overlay" onMouseDown={() => close()}>
            <div
                class="rename-popup"
                onMouseDown={(event) => event.stopPropagation()}
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
                <input
                    class="rename-input"
                    type="text"
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
                                    <button
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
                                    <button
                                        class={{
                                            "rename-icon": true,
                                            selected: icon() === option,
                                        }}
                                        type="button"
                                        aria-label={`Icon ${option}`}
                                        title={option}
                                        onClick={() => setIcon(option)}
                                    >
                                        <Icon name={option} size={15} />
                                    </button>
                                )}
                            </For>
                        </div>
                    </>
                )}
                <div class="rename-actions">
                    {props.target.kind === "tab" && props.target.tab.userLabel !== null && (
                        <button
                            class="clear"
                            type="button"
                            onClick={() => {
                                if (props.target.kind === "tab") {
                                    void window.arbor.renameTab(props.target.tab.id, null)
                                    close()
                                }
                            }}
                        >
                            Clear label
                        </button>
                    )}
                    <button type="button" onClick={() => close()}>
                        Cancel
                    </button>
                    <button class="primary" type="button" onClick={() => commit()}>
                        Save
                    </button>
                </div>
            </div>
        </div>
    )
}
