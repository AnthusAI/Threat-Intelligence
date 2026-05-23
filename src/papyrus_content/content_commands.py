from __future__ import annotations

from typing import Any

from .env import decode_jwt_claims, graphql_endpoint, graphql_jwt
from .graphql_authoring import PapyrusGraphQLAuthoringClient, create_authoring_client
from .options import normalize_string, parse_comma_list, parse_options


def _claim_values(claims: dict[str, Any], key: str) -> list[str]:
    value = claims.get(key)
    if isinstance(value, list):
        return [str(entry) for entry in value if entry]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _format_claim(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(entry) for entry in value)
    if value is None:
        return "none"
    return str(value)


def content_inspect(_flags: list[str]) -> None:
    endpoint = graphql_endpoint()
    token = graphql_jwt()
    claims = decode_jwt_claims(token)
    client = PapyrusGraphQLAuthoringClient(endpoint=endpoint, auth_token=token)
    client.inspect_reachability()

    groups = _claim_values(claims, "groups") + _claim_values(claims, "cognito:groups")
    roles = _claim_values(claims, "roles")
    scope = claims.get("scope") or claims.get("scp") or ""

    print(f"GraphQL endpoint: {endpoint}")
    print("Auth source: PAPYRUS_GRAPHQL_JWT")
    print(f"JWT issuer: {claims.get('iss') or 'unknown'}")
    print(f"JWT subject: {claims.get('sub') or 'unknown'}")
    print(f"JWT audience: {_format_claim(claims.get('aud'))}")
    exp = claims.get("exp")
    if isinstance(exp, (int, float)):
        from datetime import datetime, timezone

        print(f"JWT expires: {datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()}")
    else:
        print("JWT expires: unknown")
    print(f"JWT groups: {', '.join(groups) or 'none'}")
    print(f"JWT roles: {', '.join(roles) or 'none'}")
    print(f"JWT scope: {_format_claim(scope)}")
    print("GraphQL reachability: ok")


def content_schema_check(flags: list[str]) -> None:
    options = parse_options(flags)
    type_name = normalize_string(options.get("type")) or "Assignment"
    required_fields = parse_comma_list(options.get("fields") or options.get("field")) or []
    client, _ = create_authoring_client()
    fields = client.graphql_type_field_names(type_name)
    missing = [field for field in required_fields if field not in fields]
    print(f"schema-check\ttype\t{type_name}")
    print(f"schema-check\tfields\t{len(fields)}")
    if required_fields:
        print(f"schema-check\trequired\t{','.join(required_fields)}")
    if missing:
        print(f"schema-check\tmissing\t{','.join(missing)}")
        raise SystemExit(1)
    print("schema-check\tok\ttrue")


def content_list(subject: str | None, _flags: list[str]) -> None:
    if subject != "articles":
        raise ValueError("content list currently supports only: articles")
    client, _ = create_authoring_client()
    for article in client.list_published_articles():
        slug = article.get("slug") or article.get("id")
        headline = article.get("headline") or article.get("title") or article.get("id")
        print(f"{slug}\t{headline}")
