from __future__ import annotations

import os
import re
from dataclasses import dataclass


TOKEN_RE = re.compile(r"\w+|[^\w\s]", re.UNICODE)
DEFAULT_TIKTOKEN_ENCODING = "o200k_base"
REGEX_FALLBACK_ENCODING = "regex-word-punctuation"


@dataclass(frozen=True)
class TokenCounter:
    """Lambda-safe token counter abstraction.

    Prefer tiktoken so context budgets track model-token behavior. Keep the
    regex approximation as an explicit fallback for local environments and
    deployment failures where the native wheel cannot load.
    """

    tokenizer_model: str = ""
    encoding_name: str = DEFAULT_TIKTOKEN_ENCODING
    use_tiktoken: bool = True
    chars_per_token_fallback: int = 4

    def with_model(self, tokenizer_model: str | None = None) -> "TokenCounter":
        model = (tokenizer_model or os.environ.get("PAPYRUS_TOKENIZER_MODEL") or "").strip()
        return TokenCounter(
            tokenizer_model=model,
            encoding_name=self.encoding_name,
            use_tiktoken=self.use_tiktoken,
            chars_per_token_fallback=self.chars_per_token_fallback,
        )

    def metadata(self) -> dict[str, str | bool]:
        encoding = self._encoding()
        if encoding is not None:
            metadata: dict[str, str | bool] = {
                "provider": "tiktoken",
                "encoding": str(getattr(encoding, "name", self.encoding_name)),
            }
            if self.tokenizer_model:
                metadata["model"] = self.tokenizer_model
            return metadata
        return {
            "provider": "regex",
            "encoding": REGEX_FALLBACK_ENCODING,
            "fallback": True,
        }

    def count(self, text: str) -> int:
        if not text:
            return 0
        encoding = self._encoding()
        if encoding is not None:
            return len(encoding.encode(text))
        return self._regex_count(text)

    def truncate(self, text: str, max_tokens: int) -> str:
        if max_tokens <= 0 or not text:
            return ""
        encoding = self._encoding()
        if encoding is not None:
            token_ids = encoding.encode(text)
            if len(token_ids) <= max_tokens:
                return text
            return encoding.decode(token_ids[:max_tokens]).rstrip()
        return self._regex_truncate(text, max_tokens)

    def _encoding(self):
        if not self.use_tiktoken:
            return None
        try:
            import tiktoken  # type: ignore
        except Exception:
            return None
        try:
            if self.tokenizer_model:
                return tiktoken.encoding_for_model(self.tokenizer_model)
            return tiktoken.get_encoding(self.encoding_name)
        except Exception:
            try:
                return tiktoken.get_encoding(self.encoding_name)
            except Exception:
                return None

    def _regex_count(self, text: str) -> int:
        tokens = TOKEN_RE.findall(text)
        if tokens:
            return len(tokens)
        return max(1, len(text) // self.chars_per_token_fallback)

    def _regex_truncate(self, text: str, max_tokens: int) -> str:
        matches = list(TOKEN_RE.finditer(text))
        if not matches:
            return text[: max_tokens * self.chars_per_token_fallback].rstrip()
        if len(matches) <= max_tokens:
            return text
        cut = matches[max_tokens - 1].end()
        return text[:cut].rstrip()
