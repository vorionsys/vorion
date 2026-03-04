#!/bin/bash
while true; do
  clear
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║         VorionSDK Development Progress Monitor               ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "📊 Latest Status:"
  if ls progress/iter-*-status.json 2>/dev/null | tail -1; then
    echo "   $(ls -lt progress/iter-*-status.json 2>/dev/null | head -1 | awk '{print $9}')"
  else
    echo "   Waiting for first checkpoint..."
  fi
  echo ""
  echo "🧪 Latest Test Results:"
  if ls progress/iter-*-tests.json 2>/dev/null | tail -1; then
    echo "   $(ls -lt progress/iter-*-tests.json 2>/dev/null | head -1 | awk '{print $9}')"
  else
    echo "   Waiting for first test run..."
  fi
  echo ""
  echo "📝 Orchestration Logs (last 10 lines):"
  if [ -f "logs/orchestration.log" ]; then
    tail -10 logs/orchestration.log
  else
    echo "   Log file not created yet..."
  fi
  echo ""
  echo "⏰ Last updated: $(date '+%H:%M:%S')"
  sleep 30
done
