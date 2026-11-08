FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home --uid 10001 desk
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
RUN mkdir -p /data/uploads && chown -R desk:desk /data /app
USER desk
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
