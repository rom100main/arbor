// GENERATED - do not edit by hand. Source: src/renderer/common/Icon/icons.json.
// Regenerate with `vp run build:icons` (also auto-runs in `vp dev` / `vp build`).
import type { JSX } from "@solidjs/web"
import abc from "@tabler/icons/outline/abc.svg?raw"
import alertTriangle from "@tabler/icons/outline/alert-triangle.svg?raw"
import arrowLeft from "@tabler/icons/outline/arrow-left.svg?raw"
import arrowRight from "@tabler/icons/outline/arrow-right.svg?raw"
import book from "@tabler/icons/outline/book.svg?raw"
import bookmark from "@tabler/icons/outline/bookmark.svg?raw"
import briefcase from "@tabler/icons/outline/briefcase.svg?raw"
import chevronDown from "@tabler/icons/outline/chevron-down.svg?raw"
import chevronRight from "@tabler/icons/outline/chevron-right.svg?raw"
import chevronUp from "@tabler/icons/outline/chevron-up.svg?raw"
import clock from "@tabler/icons/outline/clock.svg?raw"
import code from "@tabler/icons/outline/code.svg?raw"
import copy from "@tabler/icons/outline/copy.svg?raw"
import deviceDesktop from "@tabler/icons/outline/device-desktop.svg?raw"
import download from "@tabler/icons/outline/download.svg?raw"
import fileDownload from "@tabler/icons/outline/file-download.svg?raw"
import folder from "@tabler/icons/outline/folder.svg?raw"
import folderOpen from "@tabler/icons/outline/folder-open.svg?raw"
import history from "@tabler/icons/outline/history.svg?raw"
import historyOff from "@tabler/icons/outline/history-off.svg?raw"
import home from "@tabler/icons/outline/home.svg?raw"
import layoutBottombar from "@tabler/icons/outline/layout-bottombar.svg?raw"
import layoutBottombarInactive from "@tabler/icons/outline/layout-bottombar-inactive.svg?raw"
import layoutSidebar from "@tabler/icons/outline/layout-sidebar.svg?raw"
import layoutSidebarInactive from "@tabler/icons/outline/layout-sidebar-inactive.svg?raw"
import layoutSidebarLeftCollapse from "@tabler/icons/outline/layout-sidebar-left-collapse.svg?raw"
import letterCase from "@tabler/icons/outline/letter-case.svg?raw"
import link from "@tabler/icons/outline/link.svg?raw"
import mail from "@tabler/icons/outline/mail.svg?raw"
import moon from "@tabler/icons/outline/moon.svg?raw"
import movie from "@tabler/icons/outline/movie.svg?raw"
import music from "@tabler/icons/outline/music.svg?raw"
import news from "@tabler/icons/outline/news.svg?raw"
import pencil from "@tabler/icons/outline/pencil.svg?raw"
import photo from "@tabler/icons/outline/photo.svg?raw"
import plus from "@tabler/icons/outline/plus.svg?raw"
import puzzle from "@tabler/icons/outline/puzzle.svg?raw"
import regex from "@tabler/icons/outline/regex.svg?raw"
import reload from "@tabler/icons/outline/reload.svg?raw"
import search from "@tabler/icons/outline/search.svg?raw"
import settings from "@tabler/icons/outline/settings.svg?raw"
import shield from "@tabler/icons/outline/shield.svg?raw"
import shieldOff from "@tabler/icons/outline/shield-off.svg?raw"
import shoppingCart from "@tabler/icons/outline/shopping-cart.svg?raw"
import star from "@tabler/icons/outline/star.svg?raw"
import sun from "@tabler/icons/outline/sun.svg?raw"
import trash from "@tabler/icons/outline/trash.svg?raw"
import world from "@tabler/icons/outline/world.svg?raw"
import x from "@tabler/icons/outline/x.svg?raw"
import { Show, createMemo, type Component } from "solid-js"

const icons = {
    abc,
    "alert-triangle": alertTriangle,
    "arrow-left": arrowLeft,
    "arrow-right": arrowRight,
    book,
    bookmark,
    briefcase,
    "chevron-down": chevronDown,
    "chevron-right": chevronRight,
    "chevron-up": chevronUp,
    clock,
    code,
    copy,
    "device-desktop": deviceDesktop,
    download,
    "file-download": fileDownload,
    folder,
    "folder-open": folderOpen,
    history,
    "history-off": historyOff,
    home,
    "layout-bottombar": layoutBottombar,
    "layout-bottombar-inactive": layoutBottombarInactive,
    "layout-sidebar": layoutSidebar,
    "layout-sidebar-inactive": layoutSidebarInactive,
    "layout-sidebar-left-collapse": layoutSidebarLeftCollapse,
    "letter-case": letterCase,
    link,
    mail,
    moon,
    movie,
    music,
    news,
    pencil,
    photo,
    plus,
    puzzle,
    regex,
    reload,
    search,
    settings,
    shield,
    "shield-off": shieldOff,
    "shopping-cart": shoppingCart,
    star,
    sun,
    trash,
    world,
    x,
} as const

export type IconName = keyof typeof icons

export interface IconProps {
    name: IconName
    size?: number
    stroke?: number
    class?: string
    style?: JSX.CSSProperties
}

export const Icon: Component<IconProps> = (props) => {
    const svg = createMemo(() => {
        const raw = icons[props.name]
        const size = props.size ?? 16
        const stroke = props.stroke ?? 2
        return raw
            .replace('width="24"', `width="${size}"`)
            .replace('height="24"', `height="${size}"`)
            .replace('stroke-width="2"', `stroke-width="${stroke}"`)
    })

    return (
        <Show when={svg()}>
            <span
                class={props.class}
                style={{ display: "inline-flex", ...props.style }}
                innerHTML={svg()}
            />
        </Show>
    )
}
