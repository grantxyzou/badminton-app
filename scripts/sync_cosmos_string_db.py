#!/usr/bin/env python3
"""
Cosmos DB sync script for BPM's badminton string database.

NOTE ON PLACEMENT — read before extending this.
This script writes to Cosmos DIRECTLY, which is not how the rest of this repo
gets reference data there. Everything else follows:

    scripts/data/<source>.json
      -> scripts/import-*.mjs          (author-time merge, output committed)
      -> scripts/data/equipment-catalog.json
      -> lib/catalogSeed.ts ensureCatalogSeeded()   (seeds Cosmos on first call)

That path is idempotent, reviewable in a diff, and needs no credentials on a
developer's machine. This script exists because it was specified as a direct
mirror of setup_cosmos_racket_db.py, which lives outside this repo. If strings
are ever meant to feed the equipment catalog and the Gear register, the
.mjs importer route is the one that matches this codebase — see
scripts/import-racket-db-v2.mjs for the shape.

What this does:
  1. Connects to your Cosmos DB account
  2. Creates the database (if it doesn't already exist)
  3. Creates the container "strings", partitioned by /brand
  4. Bulk-uploads every document from data/badminton_string_database.json
     (upsert, so it's safe to re-run)

Companion to setup_cosmos_racket_db.py, and deliberately the same shape:
same client setup, same create-if-not-exists calls, same upsert-not-insert
loop, same per-document error handling, same closing count query.

TWO DELIBERATE DIFFERENCES FROM THE RACKET SCRIPT
-------------------------------------------------
1. Partition key is /brand, not /partitionKey.
   Racket documents carry a literal "partitionKey" field (set to the brand).
   String documents do not — they have "brand" and no "partitionKey" — so
   partitioning on /brand uses the field that actually exists. Adding a
   redundant partitionKey field to the JSON would mean editing the data,
   which is out of scope and would duplicate a value already present.

2. azure.cosmos is imported INSIDE the upload path, not at module top.
   --dry-run has to work on a machine with no SDK installed and no
   credentials configured; a dry run that requires both is not a dry run.
   The real run imports it at the first point it is actually needed and
   fails with the same guidance if it is missing.

Prereqs (for a real run, not for --dry-run):
  pip install azure-cosmos --break-system-packages

Fill in the values below, or set them as environment variables instead
(COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE, COSMOS_CONTAINER) — env vars
are safer since you won't accidentally commit a key to source control.

Where to find these in the Azure Portal:
  - Endpoint & Key: your Cosmos DB account -> Settings -> Keys
  - Database/Container names: whatever you want to call them; this script
    creates them if they don't exist yet.

Usage:
  python3 sync_cosmos_string_db.py --dry-run   # report counts per brand, write nothing
  python3 sync_cosmos_string_db.py             # create + upsert
"""

import json
import os
import sys
from collections import Counter

# ---------------------------------------------------------------------------
# Configuration — fill these in, or export as env vars before running
# ---------------------------------------------------------------------------
COSMOS_ENDPOINT = os.environ.get("COSMOS_ENDPOINT", "https://<your-account>.documents.azure.com:443/")
COSMOS_KEY = os.environ.get("COSMOS_KEY", "<your-primary-key>")
DATABASE_NAME = os.environ.get("COSMOS_DATABASE", "BPM")
CONTAINER_NAME = os.environ.get("COSMOS_CONTAINER", "strings")

_HERE = os.path.dirname(os.path.abspath(__file__))
JSON_FILE = os.environ.get(
    "STRING_JSON_FILE", os.path.join(_HERE, "data", "badminton_string_database.json")
)

# Throughput for the container (RU/s). 400 is the minimum for a standalone
# (non-shared) container and is plenty for a dataset this size.
CONTAINER_THROUGHPUT = 400

# The document field Cosmos partitions on. Every document must have it or the
# upsert fails, so it is checked up front rather than 46 times inside the loop.
PARTITION_FIELD = "brand"


def load_strings():
    if not os.path.exists(JSON_FILE):
        sys.exit(
            "Could not find {}\n"
            "Keep this script beside a data/ folder containing "
            "badminton_string_database.json, or set STRING_JSON_FILE to its path.".format(JSON_FILE)
        )

    with open(JSON_FILE, "r") as f:
        strings = json.load(f)

    if not isinstance(strings, list):
        sys.exit("Expected {} to contain a JSON array of string documents.".format(JSON_FILE))

    return strings


def check_documents(strings):
    """Pre-flight checks that would otherwise surface as opaque upsert failures.

    Missing 'brand' is fatal for a /brand-partitioned container, and a
    duplicate id would mean a silent overwrite rather than an error, since
    upsert is by design idempotent. Better to say so before writing anything.
    """
    problems = []

    missing_pk = [d.get("id", "<no id>") for d in strings if not d.get(PARTITION_FIELD)]
    if missing_pk:
        problems.append(
            "{} document(s) have no '{}' and cannot be partitioned: {}".format(
                len(missing_pk), PARTITION_FIELD, ", ".join(missing_pk[:5])
            )
        )

    missing_id = [d.get("model", "<no model>") for d in strings if not d.get("id")]
    if missing_id:
        problems.append(
            "{} document(s) have no 'id': {}".format(len(missing_id), ", ".join(missing_id[:5]))
        )

    dupes = [i for i, n in Counter(d.get("id") for d in strings).items() if n > 1 and i]
    if dupes:
        problems.append(
            "{} duplicate id(s) — upsert would silently collapse these: {}".format(
                len(dupes), ", ".join(dupes[:5])
            )
        )

    return problems


def report(strings):
    """Counts per brand — the dry-run payload."""
    by_brand = Counter(d.get(PARTITION_FIELD) or "<missing>" for d in strings)
    print("Source: {}".format(JSON_FILE))
    print("Target: database '{}', container '{}' (partition key: /{})".format(
        DATABASE_NAME, CONTAINER_NAME, PARTITION_FIELD))
    print("")
    print("{} string documents across {} brands:".format(len(strings), len(by_brand)))
    for brand, count in sorted(by_brand.items(), key=lambda kv: (-kv[1], kv[0])):
        print("  {:<12} {:>3}".format(brand, count))


def main():
    dry_run = "--dry-run" in sys.argv[1:]

    strings = load_strings()
    report(strings)

    problems = check_documents(strings)
    if problems:
        print("")
        for p in problems:
            print("  PROBLEM: {}".format(p))

    if dry_run:
        print("")
        print("Dry run — nothing was written.")
        # A data problem is still an exit code, so a dry run can gate a real
        # run in a script or a CI step.
        sys.exit(1 if problems else 0)

    if problems:
        sys.exit("Refusing to upload with the problems listed above.")

    if "<your-account>" in COSMOS_ENDPOINT or "<your-primary-key>" in COSMOS_KEY:
        sys.exit(
            "Set COSMOS_ENDPOINT and COSMOS_KEY (either edit the constants at the "
            "top of this script, or export them as environment variables) before running."
        )

    # Imported here rather than at module top so --dry-run works without the
    # SDK installed. See the note in the module docstring.
    try:
        from azure.cosmos import CosmosClient, PartitionKey, exceptions
    except ImportError:
        sys.exit("azure-cosmos is not installed. Run: pip install azure-cosmos --break-system-packages")

    print("")
    print("Connecting to {} ...".format(COSMOS_ENDPOINT))
    client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)

    print("Creating (or reusing) database '{}' ...".format(DATABASE_NAME))
    database = client.create_database_if_not_exists(id=DATABASE_NAME)

    print("Creating (or reusing) container '{}' (partition key: /{}) ...".format(
        CONTAINER_NAME, PARTITION_FIELD))
    container = database.create_container_if_not_exists(
        id=CONTAINER_NAME,
        partition_key=PartitionKey(path="/" + PARTITION_FIELD),
        offer_throughput=CONTAINER_THROUGHPUT,
    )

    print("Uploading {} string documents ...".format(len(strings)))
    succeeded, failed = 0, 0
    for doc in strings:
        try:
            # upsert = safe to re-run this script after editing the JSON;
            # it overwrites existing docs with matching id + partition key
            # instead of erroring on duplicates.
            container.upsert_item(doc)
            succeeded += 1
        except exceptions.CosmosHttpResponseError as e:
            failed += 1
            print("  Failed to upload '{}': {}".format(doc.get("id"), e.message))

    print("Done. {} uploaded, {} failed.".format(succeeded, failed))

    # Quick sanity check: count documents now in the container
    count_query = "SELECT VALUE COUNT(1) FROM c"
    total = list(container.query_items(query=count_query, enable_cross_partition_query=True))[0]
    print("Container '{}' now holds {} documents.".format(CONTAINER_NAME, total))


if __name__ == "__main__":
    main()
