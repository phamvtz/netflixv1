# Claude Hooks

## PostToolUse.sh

```bash
#!/bin/bash
FILE="$1"
TIMESTAMP=$(date '+%H:%M:%S')
echo "[$TIMESTAMP] Modified: $FILE"
if [[ "$FILE" == *.js ]]; then
  node --check "$FILE" 2>&1 || echo "SYNTAX ERROR in $FILE"
fi
if [[ "$FILE" == *routes/*.js ]]; then
  echo "REMINDER: Test endpoint $FILE"
fi
```

## SessionStart.sh

```bash
#!/bin/bash
echo "=== Cấu trúc project ==="
find . -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*' | sort | head -30
echo ""
echo "=== Git log ==="
git log --oneline -5 2>/dev/null
echo ""
echo "=== .env check ==="
[ -f ".env" ] && echo ".env OK" || echo "CANH BAO: khong co .env"
echo ""
echo "Doc CLAUDE.md truoc khi bat dau"
```
