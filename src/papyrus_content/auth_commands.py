from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from .options import normalize_non_negative_integer, normalize_string, parse_options


def refresh_jwt(flags: list[str]) -> None:
    options = parse_options(flags)
    ttl_seconds = normalize_non_negative_integer(options.get("ttl-seconds"), "--ttl-seconds") or 3600
    issuer = normalize_string(options.get("issuer")) or normalize_string(os.environ.get("PAPYRUS_JWT_ISSUER")) or "papyrus-cli"
    subject = normalize_string(options.get("subject")) or "papyrus-content-cli"
    audience = normalize_string(options.get("audience")) or normalize_string(os.environ.get("PAPYRUS_JWT_AUDIENCE")) or "papyrus-authoring"
    scope = (
        normalize_string(options.get("scope"))
        or normalize_string(os.environ.get("PAPYRUS_JWT_REQUIRED_SCOPE"))
        or normalize_string(os.environ.get("PAPYRUS_JWT_AUTHORING_VALUE"))
        or "papyrus:write"
    )
    groups_raw = normalize_string(options.get("groups")) or "editor"
    groups = [entry.strip() for entry in groups_raw.split(",") if entry.strip()] or ["editor"]
    token = _mint_jwt(
        secret=_resolve_secret(options),
        issuer=issuer,
        subject=subject,
        audience=audience,
        scope=scope,
        groups=groups,
        ttl_seconds=ttl_seconds,
    )

    write_env = normalize_string(options.get("write-env"))
    if write_env:
        _upsert_env_token(Path(write_env), token)

    output_format = (normalize_string(options.get("format")) or "plain").lower()
    if output_format == "shell":
        print(f"export PAPYRUS_GRAPHQL_JWT='{token}'")
        return
    if write_env:
        print(f"Updated PAPYRUS_GRAPHQL_JWT in {Path(write_env).resolve()}")
        return
    print(token)


def _resolve_secret(options: dict[str, Any]) -> str:
    explicit = normalize_string(options.get("secret"))
    if explicit:
        return explicit
    secret_env = normalize_string(options.get("secret-env"))
    if secret_env:
        value = normalize_string(os.environ.get(secret_env))
        if value:
            return value
    for env_name in ("PAPYRUS_SANDBOX_JWT_SECRET", "PAPYRUS_JWT_SECRET"):
        value = normalize_string(os.environ.get(env_name))
        if value:
            return value
    ssm_param = (
        normalize_string(options.get("ssm-param"))
        or normalize_string(os.environ.get("PAPYRUS_JWT_SECRET_SSM_PARAM"))
        or "/amplify/shared/PAPYRUS_JWT_SECRET"
    )
    command = ["aws", "ssm", "get-parameter", "--name", ssm_param, "--with-decryption", "--output", "json"]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(f"Failed to read JWT secret from SSM parameter {ssm_param}: {stderr}")
    payload = json.loads(result.stdout or "{}")
    secret = normalize_string(((payload.get("Parameter") or {}).get("Value")))
    if not secret:
        raise RuntimeError(f"SSM parameter {ssm_param} returned no value.")
    return secret


def _mint_jwt(
    *,
    secret: str,
    issuer: str,
    subject: str,
    audience: str,
    scope: str,
    groups: list[str],
    ttl_seconds: int,
) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": issuer,
        "sub": subject,
        "aud": audience,
        "iat": now,
        "nbf": now - 30,
        "exp": now + ttl_seconds,
        "scope": scope,
        "groups": groups,
    }
    unsigned = f"{_b64_json(header)}.{_b64_json(payload)}"
    signature = hmac.new(secret.encode("utf-8"), unsigned.encode("utf-8"), hashlib.sha256).digest()
    return f"{unsigned}.{_b64(signature)}"


def _b64_json(value: dict[str, Any]) -> str:
    return _b64(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")


def _upsert_env_token(path: Path, token: str) -> None:
    line = f"PAPYRUS_GRAPHQL_JWT={token}"
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    else:
        lines = []
    replaced = False
    output: list[str] = []
    for current in lines:
        if current.startswith("PAPYRUS_GRAPHQL_JWT="):
            output.append(line)
            replaced = True
        else:
            output.append(current)
    if not replaced:
        output.append(line)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(output) + "\n", encoding="utf-8")
