# Solid 2.0 + Effect for UI and core logic

The shell UI (sidebar, tab tree, toolbar, omnibox) is built with Solid 2.0.
Domain logic in the main process (tab tree, containers, session state) is written with the Effect library.
Rejected React despite its richer ecosystem, user preference for Solid's fine-grained reactivity and Effect's structured error handling outweighed library convenience.
