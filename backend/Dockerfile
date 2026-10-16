FROM python:3.12-slim

WORKDIR /app

# Instala bibliotecas de sistema essenciais para processamento numérico
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app /app/app

ENV PYTHONPATH=/app
ENV DATA_DIR=/app/data
ENV LIBRARY_PATH=/library

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
