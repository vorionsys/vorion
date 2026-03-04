#!/bin/bash
# Auto-collect compliance evidence

EVIDENCE_DIR="./compliance/evidence"

echo "📋 Compliance Evidence Collector Started"
echo "=========================================="

while true; do
    mkdir -p "$EVIDENCE_DIR"

    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    echo ""
    echo "📋 Collecting Evidence - $TIMESTAMP"

    # Collect code review evidence
    if [ -d ".git" ]; then
        git log --pretty=format:"%h - %an, %ar : %s" --since="1 month ago" > "$EVIDENCE_DIR/code-reviews-$TIMESTAMP.txt" 2>/dev/null
        echo "   ✅ Code reviews collected"
    fi

    # Collect test coverage evidence
    if [ -f "coverage/coverage-summary.json" ]; then
        cp coverage/coverage-summary.json "$EVIDENCE_DIR/coverage-$TIMESTAMP.json"
        echo "   ✅ Test coverage collected"
    fi

    # Collect security scan evidence
    if [ -f "logs/security-validation.log" ]; then
        tail -100 logs/security-validation.log > "$EVIDENCE_DIR/security-latest-$TIMESTAMP.log"
        echo "   ✅ Security logs collected"
    fi

    # Collect dependency audit evidence
    if command -v npm &> /dev/null; then
        npm audit --json > "$EVIDENCE_DIR/npm-audit-$TIMESTAMP.json" 2>/dev/null || true
        echo "   ✅ NPM audit collected"
    fi

    # Clean old evidence (keep last 7 days)
    find "$EVIDENCE_DIR" -type f -mtime +7 -delete 2>/dev/null

    echo "   📁 Evidence saved to: $EVIDENCE_DIR"
    echo "   ⏳ Next collection in 1 hour..."

    sleep 3600
done
