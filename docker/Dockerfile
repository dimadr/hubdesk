# -- Stage 1: build frontend --
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# -- Stage 2: run backend + serve frontend --
FROM python:3.12-slim
WORKDIR /app

COPY backend/ ./
RUN pip install --no-cache-dir -e .

# Frontend dist goes to /frontend/dist (expected by main.py 3 dirs up)
COPY --from=frontend-build /build/dist /frontend/dist

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
