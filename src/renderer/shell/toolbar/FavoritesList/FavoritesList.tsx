import { Button } from "../../../common/Button/Button"

export const FavoritesListButton = () => {
    let button: HTMLButtonElement | undefined
    const toggle = (): void => {
        if (!button) return
        const rect = button.getBoundingClientRect()
        window.arbor.favoritesToggle({
            anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            mode: "list",
            favoriteId: null,
        })
    }
    return (
        <Button
            icon="bookmark"
            ariaLabel="Favorites"
            title="Favorites"
            ref={(el) => (button = el)}
            onClick={toggle}
        />
    )
}
