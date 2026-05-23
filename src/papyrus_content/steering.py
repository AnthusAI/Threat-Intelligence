from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from .env import PAPYRUS_ROOT

DEFAULT_STEERING_CONFIG = "corpora/papyrus-steering.yml"
VALID_CORPUS_ROLES = frozenset({"canonical", "source", "supporting", "archive"})


def resolve_steering_config_path(config_path: str | None = None) -> Path | None:
    configured = config_path or os.environ.get("PAPYRUS_STEERING_CONFIG") or DEFAULT_STEERING_CONFIG
    resolved = Path(configured)
    if not resolved.is_absolute():
        resolved = PAPYRUS_ROOT / resolved
    if not resolved.exists():
        if config_path or os.environ.get("PAPYRUS_STEERING_CONFIG"):
            raise ValueError(f"Steering config was not found: {configured}")
        return None
    return resolved


def load_steering_config(config_path: str | None = None) -> dict[str, Any] | None:
    resolved = resolve_steering_config_path(config_path)
    if resolved is None:
        return None
    parsed = yaml.safe_load(resolved.read_text(encoding="utf-8"))
    return normalize_steering_config(parsed, str(resolved))


def require_steering_config(config_path: str | None = None) -> dict[str, Any]:
    config = load_steering_config(config_path)
    if config is None:
        raise ValueError(f"Steering config was not found: {DEFAULT_STEERING_CONFIG}")
    return config


def normalize_steering_config(raw_config: Any, config_path: str) -> dict[str, Any]:
    if not isinstance(raw_config, dict):
        raise ValueError("Steering config must be a YAML object.")
    if raw_config.get("schemaVersion") != 1:
        raise ValueError("Steering config schemaVersion must be 1.")

    canonical_topic_set = raw_config.get("canonicalTopicSet") or {}
    canonical_corpus_key = _required_string(canonical_topic_set.get("corpusKey"), "canonicalTopicSet.corpusKey")
    canonical_classifier_id = _required_string(
        canonical_topic_set.get("classifierId"),
        "canonicalTopicSet.classifierId",
    )
    corpora = raw_config.get("corpora")
    if not isinstance(corpora, list) or not corpora:
        raise ValueError("Steering config corpora must include at least one corpus.")

    seen_keys: set[str] = set()
    normalized_corpora = [
        normalize_corpus_config(corpus, index, seen_keys) for index, corpus in enumerate(corpora)
    ]
    if not any(corpus["key"] == canonical_corpus_key for corpus in normalized_corpora):
        raise ValueError(f"canonicalTopicSet.corpusKey does not match a configured corpus: {canonical_corpus_key}")

    publication = raw_config.get("publication") or {}
    return {
        "configPath": config_path,
        "schemaVersion": 1,
        "publication": {"name": _optional_string(publication.get("name")) or "Papyrus"},
        "canonicalTopicSet": {
            "corpusKey": canonical_corpus_key,
            "classifierId": canonical_classifier_id,
        },
        "corpora": normalized_corpora,
    }


def normalize_corpus_config(corpus: Any, index: int, seen_keys: set[str]) -> dict[str, Any]:
    if not isinstance(corpus, dict):
        raise ValueError(f"corpora[{index}] must be an object.")
    key = _required_string(corpus.get("key"), f"corpora[{index}].key")
    if key in seen_keys:
        raise ValueError(f"Duplicate corpus key in steering config: {key}")
    seen_keys.add(key)

    role = _optional_string(corpus.get("role")) or "source"
    if role not in VALID_CORPUS_ROLES:
        raise ValueError(f"Unsupported role for corpus {key}: {role}")

    local_classifiers = []
    for classifier_index, classifier in enumerate(corpus.get("localClassifiers") or []):
        classifier_id = _required_string(
            (classifier or {}).get("classifierId"),
            f"corpora[{index}].localClassifiers[{classifier_index}].classifierId",
        )
        local_classifiers.append(
            {
                "classifierId": classifier_id,
                "label": _optional_string((classifier or {}).get("label")) or classifier_id,
            }
        )

    canonical_projection = None
    projection = corpus.get("canonicalProjection")
    if isinstance(projection, dict):
        canonical_projection = {
            "authorityCorpusKey": _required_string(
                projection.get("authorityCorpusKey"),
                f"corpora[{index}].canonicalProjection.authorityCorpusKey",
            ),
            "classifierId": _required_string(
                projection.get("classifierId"),
                f"corpora[{index}].canonicalProjection.classifierId",
            ),
        }

    return {
        "key": key,
        "name": _optional_string(corpus.get("name")) or key,
        "path": _optional_string(corpus.get("path")),
        "s3Prefix": _optional_string(corpus.get("s3Prefix")),
        "role": role,
        "localClassifiers": local_classifiers,
        "canonicalProjection": canonical_projection,
    }


def find_corpus_config(config: dict[str, Any], corpus_key: str) -> dict[str, Any] | None:
    return next((corpus for corpus in config.get("corpora", []) if corpus.get("key") == corpus_key), None)


def require_corpus_config(config: dict[str, Any], corpus_key: str, field_name: str = "corpus key") -> dict[str, Any]:
    corpus = find_corpus_config(config, corpus_key)
    if corpus is None:
        raise ValueError(f"Unknown {field_name}: {corpus_key}")
    return corpus


def resolve_classifier_for_corpus(config: dict[str, Any], corpus: dict[str, Any], explicit_classifier: str | None) -> str:
    if explicit_classifier:
        return explicit_classifier
    if corpus.get("key") == config["canonicalTopicSet"]["corpusKey"]:
        return config["canonicalTopicSet"]["classifierId"]
    local_classifiers = corpus.get("localClassifiers") or []
    if len(local_classifiers) == 1:
        return local_classifiers[0]["classifierId"]
    raise ValueError(
        f"--classifier is required for corpus {corpus['key']}; config does not identify exactly one classifier."
    )


def selected_corpus_configs(config: dict[str, Any], corpus_key: str | None) -> list[dict[str, Any]]:
    if corpus_key:
        return [require_corpus_config(config, corpus_key, "--corpus-key")]
    return list(config.get("corpora") or [])


def _required_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required.")
    return value.strip()


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()
