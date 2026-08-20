#!/usr/bin/env python3
"""
Cosmos DB setup script for BPM's racket database.

BROUGHT IN FROM OUTSIDE THIS REPO — read before extending.
This is the sibling of sync_cosmos_string_db.py and is kept beside it so the
pair does not live in two places. Like that script, it writes to Cosmos
DIRECTLY, which is NOT how reference data reaches Cosmos here. The route this
codebase actually uses is:

    scripts/data/<source>.json
      -> scripts/import-*.mjs        (author-time merge, output committed)
      -> scripts/data/equipment-catalog.json
      -> lib/catalogSeed.ts ensureCatalogSeeded()

That path is idempotent, reviewable as a diff, and needs no credentials on a
developer's machine. Prefer it. These two Python scripts exist because they
were authored against a standalone Cosmos account.

ONE CHANGE ON THE WAY IN: JSON_FILE. The original resolved
"racket_database.json" beside itself; this repo stores that same file (byte
for byte) as data/racket_database.source.json, so a verbatim copy would have
arrived broken. The default points at the v1 source it was written for —
data/racket-database-v2.json is the current 60-racket set and also carries a
partitionKey field, so RACKET_JSON_FILE can point at either.

NOTE: unlike its string sibling this script has no --dry-run, so it cannot be
executed without the SDK and live credentials. It was syntax-checked on the
way in, not run.

What this does:
  1. Connects to your Cosmos DB account
  2. Creates the database (if it doesn't already exist)
  3. Creates the container "rackets", partitioned by /partitionKey (= brand)
  4. Bulk-uploads every document from racket_database.json (upsert, so it's safe to re-run)

Prereqs:
  pip install azure-cosmos --break-system-packages

Fill in the four values below, or set them as environment variables instead
(COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE, COSMOS_CONTAINER) — env vars
are safer since you won't accidentally commit a key to source control.

Where to find these in the Azure Portal:
  - Endpoint & Key: your Cosmos DB account -> Settings -> Keys
  - Database/Container names: whatever you want to call them; this script
    creates them if they don't exist yet.
"""

import json
import os
import sys

from azure.cosmos import CosmosClient, PartitionKey, exceptions

# ---------------------------------------------------------------------------
# Configuration — fill these in, or export as env vars before running
# ---------------------------------------------------------------------------
COSMOS_ENDPOINT = os.environ.get("COSMOS_ENDPOINT", "https://<your-account>.documents.azure.com:443/")
COSMOS_KEY = os.environ.get("COSMOS_KEY", "<your-primary-key>")
DATABASE_NAME = os.environ.get("COSMOS_DATABASE", "BPM")
CONTAINER_NAME = os.environ.get("COSMOS_CONTAINER", "rackets")
JSON_FILE = os.environ.get(
    "RACKET_JSON_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "racket_database.source.json"),
)

# Throughput for the container (RU/s). 400 is the minimum for a standalone
# (non-shared) container and is plenty for a dataset this size.
CONTAINER_THROUGHPUT = 400


def main():
    if "<your-account>" in COSMOS_ENDPOINT or "<your-primary-key>" in COSMOS_KEY:
        sys.exit(
            "Set COSMOS_ENDPOINT and COSMOS_KEY (either edit the constants at the "
            "top of this script, or export them as environment variables) before running."
        )

    if not os.path.exists(JSON_FILE):
        sys.exit(
            f"Could not find {JSON_FILE} — keep this script beside a data/ folder "
            f"containing racket_database.source.json, or set RACKET_JSON_FILE to its path."
        )

    print(f"Connecting to {COSMOS_ENDPOINT} ...")
    client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)

    print(f"Creating (or reusing) database '{DATABASE_NAME}' ...")
    database = client.create_database_if_not_exists(id=DATABASE_NAME)

    print(f"Creating (or reusing) container '{CONTAINER_NAME}' (partition key: /partitionKey) ...")
    container = database.create_container_if_not_exists(
        id=CONTAINER_NAME,
        partition_key=PartitionKey(path="/partitionKey"),
        offer_throughput=CONTAINER_THROUGHPUT,
    )

    with open(JSON_FILE, "r") as f:
        rackets = json.load(f)

    print(f"Uploading {len(rackets)} racket documents ...")
    succeeded, failed = 0, 0
    for doc in rackets:
        try:
            # upsert = safe to re-run this script after editing the JSON;
            # it overwrites existing docs with matching id + partitionKey
            # instead of erroring on duplicates.
            container.upsert_item(doc)
            succeeded += 1
        except exceptions.CosmosHttpResponseError as e:
            failed += 1
            print(f"  Failed to upload '{doc.get('id')}': {e.message}")

    print(f"Done. {succeeded} uploaded, {failed} failed.")

    # Quick sanity check: count documents now in the container
    count_query = "SELECT VALUE COUNT(1) FROM c"
    total = list(container.query_items(query=count_query, enable_cross_partition_query=True))[0]
    print(f"Container '{CONTAINER_NAME}' now holds {total} documents.")


if __name__ == "__main__":
    main()
