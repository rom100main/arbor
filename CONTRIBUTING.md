# Contributing

We welcome contributions! Here's how you can get involved:

## Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Project Guidelines

- Use TypeScript with strict type checking
- Follow the existing code style (format with `npm run fmt`)
- Run the checks before committing (`npm run check`)
- Write clear, descriptive commit messages, use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) style

## Testing

Before submitting a pull request, please ensure that:

1. The project builds without errors (`npm run build`)
2. The checks pass (`npm run check`)
3. All tests pass (`npm test`)
4. The license check passes (`npm run licenses:check`)
5. The code follows the project guidelines
6. New functionality includes appropriate tests

## Development Setup

### Prerequisites

- Node.js
- npm
- Git

Recommeded:
- Vite+

### Installation

1. Install dependencies:
    ```bash
    npm ci
    ```

### Development Workflow

1. Start the development app:

    ```bash
    npm run dev
    ```

2. Make changes to the source code in the `src/` directory.

3. The project will be automatically compiled. `src/renderer/ui/Icon.tsx` is generated from `src/renderer/ui/icons.json` — edit the JSON and run `npm run build:icons`, never edit the generated file by hand.

## Architecture

1. **Store** (`src/main/state/`): The only place where state changes. The UI renders from a read-only snapshot.
2. **IPC** (`src/main/ipc/`): How the UI sends actions to the main process and receives the new state.
3. **Preload** (`src/preload/`): Bridges the UI and the main process through `window.arbor`.
4. **Renderer** (`src/renderer/`): The sidebar, toolbar, omnibox and popups the user sees.

See [Architecture](docs/architecture/README.md) for the full map.

## Our stance on AI

We allow PR made with AI, but you are responsible for your code. This implies that you have reread all your code and reaches a good quality. You should always understand what you have done. If you clearly did not read the code or it is fully vibe coded we allow ourselves to close the PR without reason.

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.
