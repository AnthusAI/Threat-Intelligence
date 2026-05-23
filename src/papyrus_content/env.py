from __future__ import annotations

import base64
import json
import os
from pathlib import Path

PAPYRUS_ROOT = Path(__file__).resolve().parents[2]


def load_dotenv() -> None:
    for filename in (".env", ".env.local"):
        path = PAPYRUS_ROOT / filename
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ[key] = value


def amplify_outputs_path() -> Path:
    return PAPYRUS_ROOT / "amplify_outputs.json"


def load_amplify_outputs() -> dict:
    path = amplify_outputs_path()
    if not path.exists():
        raise ValueError("Missing amplify_outputs.json. Run `npm run sandbox` or deploy the Amplify backend first.")
    return json.loads(path.read_text(encoding="utf-8"))


def graphql_endpoint() -> str:
    explicit = os.environ.get("PAPYRUS_GRAPHQL_ENDPOINT", "").strip()
    if explicit:
        return explicit
    outputs = load_amplify_outputs()
    endpoint = outputs.get("data", {}).get("url") or outputs.get("aws_appsync_graphqlEndpoint")
    if not endpoint:
        raise ValueError("Could not determine GraphQL endpoint from amplify_outputs.json.")
    return str(endpoint)


def graphql_jwt() -> str:
    token = os.environ.get("PAPYRUS_GRAPHQL_JWT", "").strip()
    if not token:
        raise ValueError(
            "Missing PAPYRUS_GRAPHQL_JWT. Set a direct AppSync Lambda-authorizer authoring JWT before running content commands."
        )
    normalized = normalize_jwt(token)
    claims = decode_jwt_claims(normalized)
    if is_jwt_expired(claims):
        raise ValueError("PAPYRUS_GRAPHQL_JWT is expired. Run: npm run auth:refresh-jwt -- --write-env .env")
    return normalized


def normalize_jwt(token: str) -> str:
    return token.removeprefix("Bearer ").removeprefix("bearer ").strip()


def lambda_auth_header(token: str) -> str:
    return f"PapyrusJwt {normalize_jwt(token)}"


def is_jwt_expired(claims: dict) -> bool:
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)):
        return False
    import time

    return float(exp) <= time.time()


def decode_jwt_claims(token: str) -> dict:
    normalized = normalize_jwt(token)
    parts = normalized.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
        return json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return {}


def storage_bucket_from_amplify_outputs(filepath: str | Path | None = None) -> str | None:
    path = Path(filepath) if filepath else amplify_outputs_path()
    if not path.is_absolute():
        path = PAPYRUS_ROOT / path
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    storage = parsed.get("storage") or {}
    return storage.get("bucket_name") or storage.get("bucketName")
