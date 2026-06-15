# Stage 1: build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend + frontend dist
FROM python:3.12-slim
WORKDIR /app
COPY backend/ .
RUN pip install --no-cache-dir -e .
COPY --from=frontend-build /build/frontend/dist /frontend/dist
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
