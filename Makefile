# One-word commands for the whole repo. `make dev` runs FastAPI on :8000 and Vite on :5173 (proxying /api).
.PHONY: install dev build test lint typecheck e2e format docker

install:
	npm install
	cd server && uv sync

dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd server && uv run uvicorn bettercad.main:app --reload --port 8000 2>&1 | sed -u 's/^/\x1b[35m[api]\x1b[0m /') & \
	(npm run dev 2>&1 | sed -u 's/^/\x1b[36m[web]\x1b[0m /') & \
	wait

build:
	npm run build

test:
	npm test
	cd server && uv run pytest --cov=bettercad

lint:
	npm run lint
	npm run format:check
	cd server && uv run ruff check . && uv run ruff format --check .

typecheck:
	npm run typecheck

e2e:
	npm run e2e

format:
	npm run format
	cd server && uv run ruff format .

docker:
	docker build -t bettercad .
