"""One-time data migration: give each published Threat Intelligence post front matter in the CMS.

The standard front end reads title, description and date from an item's front matter, not from the legacy deck
column. This saves and publishes each post again with front matter derived from those columns (the columns themselves
are kept, so the Amplify reader still renders and rollback stays one step) and adds the old /posts/<slug> and
/articles/<slug> addresses as aliases so they redirect to the new page.

    PAPYRUS_GRAPHQL_AUTH=iam PAPYRUS_GRAPHQL_ENDPOINT=... python bin/front_matter_migration.py [--apply]
"""
from __future__ import annotations

import sys

import yaml

from papyrus_content.publishing import ItemFields, publish_item, save_item


def front_matter_for(item: dict) -> str:
    data = {"title": item.get("headline") or item["title"]}
    if item.get("deck"):
        data["description"] = item["deck"]
    data["date"] = (item.get("publishedAt") or "")[:10]
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=10_000)


def aliases_for(item: dict) -> list[str]:
    slug = item["slug"]
    old = [f"/posts/{slug}", f"/posts/{slug}/", f"/articles/{slug}", f"/articles/{slug}/"]
    return sorted({*(item.get("aliases") or []), *old})


LEGACY_COLUMNS = ("body", "pullQuotes", "editorial", "editionDate", "layout")


def legacy_columns_of(item: dict) -> dict:
    """The Pretext-era columns a save from front matter would otherwise reset; kept so the old reader still renders."""
    return {key: item[key] for key in LEGACY_COLUMNS if item.get(key) is not None}


def migrate(client, *, apply: bool, actor: str = "front-matter-migration") -> list[str]:
    done = []
    for item in sorted(client.list_records("Item"), key=lambda row: row["slug"]):
        if item.get("type") != "article" or item.get("status") != "published":
            continue
        fields = ItemFields(type=item["type"], slug=item["slug"], section=item.get("section"),
                            front_matter_yaml=front_matter_for(item), body_markus=item.get("bodyMarkus") or "",
                            aliases=aliases_for(item), id=item["id"], overrides=legacy_columns_of(item))
        done.append(item["slug"])
        if apply:
            save_item(client, fields, actor=actor)
            publish_item(client, item["id"], actor=actor)
    return done


if __name__ == "__main__":
    from papyrus_content.graphql_authoring import create_authoring_client

    client, _claims = create_authoring_client(None)
    slugs = migrate(client, apply="--apply" in sys.argv)
    print(("migrated" if "--apply" in sys.argv else "would migrate"), len(slugs), "posts")
