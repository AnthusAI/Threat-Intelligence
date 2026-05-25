# Local Dev HTTP 431 Troubleshooting

Papyrus local development should run on `http://127.0.0.1:3000` to avoid
shared `localhost` cookie bloat from other local apps.

## Standard dev start

```bash
npm run dev:127
```

## Why this helps

`localhost` cookies are shared across ports and projects in many browsers. If
that cookie jar grows too large, requests can exceed the dev server header-size
limit and fail with `HTTP 431`.

## Quick diagnostic

```bash
curl -I -H "Cookie: x=$(python - <<'PY'
print('a' * 20000)
PY
)" http://127.0.0.1:3000/newsroom/assignments
```

If this returns `431`, the failure class is oversized request headers (usually
cookies), not route-specific application logic.
