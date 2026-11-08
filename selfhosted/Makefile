.PHONY: init up down test build deploy logs status backup smoke
init:
	python3 scripts/init.py
up:
	docker compose up -d --build --wait
build:
	docker compose build
status:
	docker compose ps
logs:
	docker compose logs --tail=100 -f
down:
	docker compose down
test:
	cd backend && python -m pytest -q
	cd web && npm test && npm run build
deploy:
	bash scripts/deploy.sh
backup:
	bash scripts/backup.sh
smoke:
	bash scripts/smoke-test.sh
