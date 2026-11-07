# Tarjetas

Tarjetas tracks Argentine card statements, Coto receipts, spending reports and evidence-backed accounting. The existing reference application is in `web/`.

The rebuild targets a PostgreSQL-only Laravel API in `backend/` and an independently built React, TypeScript and Vite SPA in `frontend/`, with Sanctum cookie authentication and isolated finances for multiple users.

Start with [Continuing the rebuild on another computer](docs/rebuild/START-HERE.md). It identifies the feature branch, reading order, portable checks and implementation kickoff prompt. The complete [build specification](docs/rebuild/README.md) and [reference context](docs/project-context-prompt.md) are committed with the synthetic fixtures and expected outcomes.

This handoff prepares implementation. The Laravel backend and React frontend have not been scaffolded. Registration and account provisioning remain outside scope.

Historical reference-app documentation is in [CONTEXT.md](CONTEXT.md) and [BACKUP.md](BACKUP.md). The rebuild specifications take precedence for target architecture, ownership and recovery.
