import type { JSX } from "@solidjs/web"
import { Show } from "solid-js"

import { Button } from "../Button/Button"
import { Icon } from "../Icon/Icon"

import "./Field.css"

export interface FieldProps {
    value: string
    placeholder?: string
    ariaLabel?: string
    type?: "text" | "password"
    autocomplete?: string
    spellcheck?: boolean
    invalid?: boolean
    ref?: (el: HTMLInputElement) => void
    onInput?: (event: Event & { currentTarget: HTMLInputElement }) => void
    onChange?: (event: Event & { currentTarget: HTMLInputElement }) => void
    onKeyDown?: (event: KeyboardEvent) => void
    onFocus?: (event: FocusEvent & { currentTarget: HTMLInputElement }) => void
    onBlur?: (event: FocusEvent & { currentTarget: HTMLInputElement }) => void
}

export const Field = (props: FieldProps) => (
    <input
        ref={props.ref}
        class={{ "field-input": true, invalid: props.invalid }}
        type={props.type ?? "text"}
        aria-label={props.ariaLabel}
        placeholder={props.placeholder}
        spellcheck={props.spellcheck ?? false}
        autocomplete={props.autocomplete ?? "off"}
        value={props.value}
        onInput={props.onInput}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
    />
)

export interface SearchFieldProps {
    value: string
    placeholder?: string
    ariaLabel?: string
    onInput?: (event: Event & { currentTarget: HTMLInputElement }) => void
    onClear?: () => void
    ref?: (el: HTMLInputElement) => void
    autofocus?: boolean
}

export const SearchField = (props: SearchFieldProps) => (
    <label class="search-field">
        <Icon name="search" size={16} />
        <input
            ref={props.ref}
            class="search-field-input"
            type="text"
            aria-label={props.ariaLabel ?? "Search"}
            placeholder={props.placeholder}
            spellcheck={false}
            autocomplete="off"
            autofocus={props.autofocus}
            value={props.value}
            onInput={props.onInput}
        />
        <Show when={props.value.length > 0}>
            <Button icon="x" size="sm" ariaLabel="Clear search" onClick={() => props.onClear?.()} />
        </Show>
    </label>
)

export interface SelectFieldProps {
    value: string
    ariaLabel?: string
    onChange?: (event: Event & { currentTarget: HTMLSelectElement }) => void
    children?: JSX.Element
}

export const SelectField = (props: SelectFieldProps) => (
    <label class="select-field">
        <select aria-label={props.ariaLabel} value={props.value} onChange={props.onChange}>
            {props.children}
        </select>
        <span class="select-field-chevron" aria-hidden="true">
            <Icon name="chevron-down" size={12} />
        </span>
    </label>
)
