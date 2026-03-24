#!/bin/bash
export PATH="/home/moritz/.nvm/versions/node/v24.14.0/bin:$PATH"

# Start the service if it's not already running
systemctl --user start gantt-app

# Wait for Vite to be ready (up to 15 seconds)
for i in $(seq 1 30); do
  sleep 0.5
  if nc -z localhost 5173 2>/dev/null; then
    google-chrome "http://localhost:5173"
    exit 0
  fi
done

notify-send "Gantt App" "Server failed to start."
