FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the full project
COPY . .

# Expose port (Railway injects $PORT at runtime)
EXPOSE 8000

# Start the backend (which also serves the pre-built React static files)
CMD ["sh", "-c", "cd /app/backend && python3 -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
