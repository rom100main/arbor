import { DEFAULT_SEARCH_TEMPLATE } from "../../shared/settings"

export interface SearchEngine {
    readonly name: string
    readonly template: string
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
    { name: "DuckDuckGo", template: DEFAULT_SEARCH_TEMPLATE },
    { name: "Google", template: "https://www.google.com/search?q=%s" },
    { name: "Brave", template: "https://search.brave.com/search?q=%s" },
    { name: "Kagi", template: "https://kagi.com/search?q=%s" },
    { name: "Startpage", template: "https://www.startpage.com/sp/search?query=%s" },
    { name: "Wikipedia", template: "https://en.wikipedia.org/w/index.php?search=%s" },
    { name: "Bing", template: "https://www.bing.com/search?q=%s" },
    { name: "Ecosia", template: "https://www.ecosia.org/search?q=%s" },
]
