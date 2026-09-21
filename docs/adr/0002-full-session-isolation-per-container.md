# Full session isolation per container

Each Container gets its own Electron session partition (`persist:container-<id>`), giving it separate cookies, storage, and cache, Firefox Multi-Account Containers semantics. Cost: N live sessions and more memory; accepted because isolation is the core value of the feature.
